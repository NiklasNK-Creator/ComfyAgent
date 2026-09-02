import json
import os
import asyncio
import time
from functools import partial
from aiohttp import web
from server import PromptServer

from settings_manager import load_settings, save_settings
from session_manager import session_mgr
from agent_core import run_agent_chat, fetch_openrouter_free_models, fetch_all_models
from agent_tools import IntrospectionTools, OptimizationAndFixTools, CustomNodeInstaller, ImageMetadataTools

# Sentinel value used for masked credentials in the API response
_MASKED = "__COMFYAGENT_MASKED__"
_models_cache = {}
_models_cache_ttl = 30
_action_result_cache = {}

def setup_routes(routes):

    # ---- Settings ----------------------------------------------------------

    @routes.get("/comfyagent/settings")
    async def get_settings_handler(request):
        settings = load_settings()
        safe = dict(settings)
        # Mask secret fields with a deterministic sentinel the frontend can check
        for key in ("api_key", "civitai_key", "github_token"):
            if safe.get(key):
                safe[key] = _MASKED
        return web.json_response(safe)

    @routes.post("/comfyagent/settings")
    async def post_settings_handler(request):
        try:
            data = await request.json()
            curr = load_settings()
            for k, v in data.items():
                # Only update if value is not the masked sentinel
                if v != _MASKED:
                    curr[k] = v
            save_settings(curr)
            return web.json_response({"status": "ok"})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=400)

    # ---- Sessions ----------------------------------------------------------

    @routes.get("/comfyagent/sessions")
    async def list_sessions_handler(request):
        sessions = session_mgr.list_sessions()
        active = session_mgr.get_active_session()
        return web.json_response({"sessions": sessions, "active": active, "task": session_mgr.get_task()})

    @routes.get("/comfyagent/task")
    async def get_task_handler(request):
        return web.json_response({"task": session_mgr.get_task()})

    @routes.post("/comfyagent/task/clear")
    async def clear_task_handler(request):
        session_mgr.set_task(None)
        return web.json_response({"status": "ok"})

    @routes.post("/comfyagent/credentials/grant")
    async def credential_grant_handler(request):
        data = await request.json()
        credential = data.get("credential", "")
        if credential not in {"api_key", "civitai_key", "github_token"}:
            return web.json_response({"error": "Unknown credential"}, status=400)
        settings = load_settings()
        if not settings.get(credential):
            return web.json_response({"error": "Credential is not configured"}, status=400)
        session_mgr.grant_credential(credential, data.get("purpose", ""), data.get("endpoint_or_target", ""))
        return web.json_response({"status": "granted", "credential": credential, "secret_exposed": False})

    @routes.post("/comfyagent/sessions/switch")
    async def switch_session_handler(request):
        data = await request.json()
        sid = data.get("session_id")
        if session_mgr.switch_session(sid):
            return web.json_response({"status": "ok", "active": session_mgr.get_active_session()})
        return web.json_response({"error": "Session not found"}, status=404)

    @routes.post("/comfyagent/sessions/new")
    async def new_session_handler(request):
        data = {}
        if request.content_length and request.content_length > 0:
            data = await request.json()
        name = data.get("name")
        sid = session_mgr.create_session(name)
        return web.json_response({"status": "ok", "session_id": sid, "active": session_mgr.get_active_session()})

    @routes.post("/comfyagent/sessions/delete")
    async def delete_session_handler(request):
        data = await request.json()
        sid = data.get("session_id")
        session_mgr.delete_session(sid)
        return web.json_response({"status": "ok", "active": session_mgr.get_active_session()})

    @routes.get("/comfyagent/sessions/export/{session_id}")
    async def export_session_handler(request):
        sid = request.match_info.get("session_id")
        sess = session_mgr.sessions.get(sid)
        if not sess:
            return web.json_response({"error": "Session not found"}, status=404)
        return web.json_response(sess)

    @routes.post("/comfyagent/sessions/revert")
    async def revert_session_handler(request):
        data = await request.json()
        msg_id = data.get("msg_id")
        count = data.get("count")
        if msg_id:
            ok = session_mgr.revert_to_message(msg_id)
        elif count:
            ok = session_mgr.revert_last(int(count))
        else:
            # revert last assistant+tool turn
            ok = session_mgr.revert_last(2)
        if ok:
            return web.json_response({"status": "ok", "active": session_mgr.get_active_session()})
        return web.json_response({"error": "Revert failed - message not found"}, status=404)

    @routes.post("/comfyagent/sessions/answer")
    async def answer_question_handler(request):
        """Resume after user answered an ask_user question."""
        data = await request.json()
        answer = data.get("answer", "")
        canvas_context = data.get("canvas_context")
        loop = asyncio.get_running_loop()
        res = await loop.run_in_executor(
            None,
            partial(run_agent_chat, session_mgr, f"[User answered question]: {answer}", canvas_context)
        )
        return web.json_response(res)

    @routes.post("/comfyagent/action_result")
    async def action_result_handler(request):
        """Return an approved frontend action result to the agent for continuation."""
        try:
            data = await request.json()
            action = data.get("action", "")
            result = data.get("result", {})
            canvas_context = data.get("canvas_context")
            action_id = data.get("action_id") or f"{action}:{json.dumps(result, sort_keys=True, default=str)}"
            if action_id in _action_result_cache:
                return web.json_response(_action_result_cache[action_id])
            message = (
                f"[ACTION RESULT]\nAction: {action}\n"
                f"Result: {json.dumps(result, ensure_ascii=True)}\n"
                "This action has now completed on the active canvas. Re-read the live state and continue the plan only if required."
            )
            loop = asyncio.get_running_loop()
            response = await loop.run_in_executor(
                None,
                partial(run_agent_chat, session_mgr, message, canvas_context)
            )
            _action_result_cache[action_id] = response
            return web.json_response(response)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    # ---- Chat (non-blocking) -----------------------------------------------

    @routes.post("/comfyagent/chat")
    async def chat_handler(request):
        try:
            data = await request.json()
            message = data.get("message", "")
            canvas_context = data.get("canvas_context", None)
            attachments = data.get("attachments", None)
            # Run blocking LLM call in a thread to avoid freezing the event loop
            loop = asyncio.get_running_loop()
            res = await loop.run_in_executor(
                None,
                partial(run_agent_chat, session_mgr, message, canvas_context, attachments)
            )
            return web.json_response(res)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    @routes.post("/comfyagent/chat/stream")
    async def chat_stream_handler(request):
        """SSE streaming for live thinking — forwards LLM tokens as they arrive."""
        import aiohttp
        try:
            data = await request.json()
            message = data.get("message", "")
            canvas_context = data.get("canvas_context")
            attachments = data.get("attachments")
            settings = load_settings()
            yolo_mode = settings.get("yolo_mode", False) is True
            endpoint = settings.get("api_endpoint", "https://openrouter.ai/api/v1").rstrip("/")
            api_key = settings.get("api_key", "").strip()
            model_id = settings.get("model_id", "auto")
            from agent_core import fetch_openrouter_free_models, _is_openrouter_endpoint, OPENROUTER_MAX_TOKENS, OPENROUTER_TEMPERATURE, OPENROUTER_MAX_HISTORY_MESSAGES, OPENROUTER_MAX_CONTENT_CHARS, _build_system_prompt, TOOL_DEFINITIONS, MAX_TOOL_ROUNDS, _robust_tool_args_parse, execute_tool_call

            if model_id == "auto":
                # For stream, fetch free model synchronously in thread
                loop = asyncio.get_running_loop()
                model_id = await loop.run_in_executor(None, partial(fetch_openrouter_free_models, endpoint))

            # Save user message
            session_mgr.add_message("user", message, attachments=attachments)
            is_or = _is_openrouter_endpoint(endpoint)

            # Prepare SSE response to frontend
            resp = web.StreamResponse(status=200, reason="OK", headers={
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            })
            await resp.prepare(request)

            pending_approvals = []
            tool_trace = []
            final_text = ""

            # Stream up to MAX_TOOL_ROUNDS turns (each turn streams content + may call tools)
            for _round in range(MAX_TOOL_ROUNDS):
                active_sess = session_mgr.get_active_session()
                system_prompt = _build_system_prompt(canvas_context, active_sess, endpoint)
                if is_or:
                    recent = session_mgr.get_recent_model_messages(OPENROUTER_MAX_HISTORY_MESSAGES, active_sess)
                    formatted = [{"role": "system", "content": system_prompt}]
                    for m in recent:
                        c = m.get("content") or ""
                        if len(c) > OPENROUTER_MAX_CONTENT_CHARS:
                            c = c[:OPENROUTER_MAX_CONTENT_CHARS] + "\n...[trimmed]"
                        entry = {"role": m["role"], "content": c}
                        if "tool_calls" in m: entry["tool_calls"] = m["tool_calls"]
                        if "tool_call_id" in m: entry["tool_call_id"] = m["tool_call_id"]
                        formatted.append(entry)
                else:
                    formatted = [{"role": "system", "content": system_prompt}]
                    for m in session_mgr.get_model_messages(active_sess):
                        entry = {"role": m["role"], "content": m.get("content") or ""}
                        if "tool_calls" in m: entry["tool_calls"] = m["tool_calls"]
                        if "tool_call_id" in m: entry["tool_call_id"] = m["tool_call_id"]
                        formatted.append(entry)

                payload = {"model": model_id, "messages": formatted, "tools": TOOL_DEFINITIONS, "tool_choice": "auto", "stream": True, "stream_options": {"include_usage": False}}
                if is_or:
                    payload["max_tokens"] = OPENROUTER_MAX_TOKENS
                    payload["temperature"] = OPENROUTER_TEMPERATURE
                hdrs = {"Content-Type": "application/json", "HTTP-Referer": "https://github.com/ComfyUI/ComfyUI", "X-Title": "ComfyAgent"}
                if api_key:
                    hdrs["Authorization"] = f"Bearer {api_key}"
                url = f"{endpoint}/chat/completions"
                if endpoint.rstrip("/").endswith("/chat/completions"):
                    url = endpoint

                # Stream from LLM
                content_accum = ""
                tool_calls_accum = {}  # idx -> {id, function: {name, arguments}}
                finish_reason = None
                try:
                    async with aiohttp.ClientSession() as sess:
                        async with sess.post(url, json=payload, headers=hdrs, timeout=aiohttp.ClientTimeout(total=90)) as llm_resp:
                            if llm_resp.status != 200:
                                err_body = await llm_resp.text()
                                await resp.write(f"data: {json.dumps({'type':'error','error': f'LLM {llm_resp.status}: {err_body[:800]}'})}\n\n".encode())
                                break
                            async for raw_line in llm_resp.content:
                                line = raw_line.decode("utf-8", errors="ignore").strip()
                                if not line:
                                    continue
                                if line.startswith("data:"):
                                    line = line[5:].strip()
                                if not line or line == "[DONE]":
                                    continue
                                try:
                                    j = json.loads(line)
                                except:
                                    continue
                                # Normalize
                                from agent_core import _normalize_provider_response, _content_to_text
                                try:
                                    j = _normalize_provider_response(j)
                                except:
                                    pass
                                choices = j.get("choices", [])
                                if not choices:
                                    continue
                                delta = choices[0].get("delta", choices[0].get("message", {}))
                                if not isinstance(delta, dict):
                                    continue
                                # Content token
                                delta_content = delta.get("content")
                                if delta_content is None:
                                    delta_content = delta.get("text", "")
                                # Handle content as list
                                if isinstance(delta_content, list):
                                    delta_content = "".join(str(p.get("text","") if isinstance(p, dict) else str(p)) for p in delta_content)
                                if delta_content:
                                    content_accum += str(delta_content)
                                    await resp.write(f"data: {json.dumps({'type':'token','text': str(delta_content)})}\n\n".encode())
                                # Reasoning / thinking token (some models use reasoning_content)
                                for rk in ("reasoning_content", "reasoning", "thinking"):
                                    if rk in delta and delta[rk]:
                                        rc = delta[rk]
                                        if isinstance(rc, list):
                                            rc = "".join(str(p.get("text","") if isinstance(p, dict) else str(p)) for p in rc)
                                        await resp.write(f"data: {json.dumps({'type':'thinking','text': str(rc)})}\n\n".encode())
                                # Tool calls delta
                                d_tool_calls = delta.get("tool_calls")
                                if isinstance(d_tool_calls, list):
                                    for tc in d_tool_calls:
                                        idx = tc.get("index", 0)
                                        if idx not in tool_calls_accum:
                                            tool_calls_accum[idx] = {"id": tc.get("id",""), "function": {"name": "", "arguments": ""}}
                                        if tc.get("id"):
                                            tool_calls_accum[idx]["id"] = tc["id"]
                                        fn = tc.get("function", {})
                                        if fn.get("name"):
                                            tool_calls_accum[idx]["function"]["name"] = fn["name"]
                                        if fn.get("arguments"):
                                            tool_calls_accum[idx]["function"]["arguments"] += fn["arguments"]
                                        # Notify frontend live that a tool is being prepared
                                        if fn.get("name"):
                                            await resp.write(f"data: {json.dumps({'type':'tool','tool': fn['name']})}\n\n".encode())
                                if "finish_reason" in choices[0] and choices[0]["finish_reason"]:
                                    finish_reason = choices[0]["finish_reason"]
                except asyncio.CancelledError:
                    break
                except Exception as e:
                    await resp.write(f"data: {json.dumps({'type':'error','error': str(e)[:800]})}\n\n".encode())
                    break

                # If we got tool calls, execute them
                if tool_calls_accum:
                    tool_calls_list = []
                    for idx in sorted(tool_calls_accum.keys()):
                        tc = tool_calls_accum[idx]
                        # Ensure id
                        if not tc.get("id"):
                            tc["id"] = f"call_{idx}"
                        tool_calls_list.append({"id": tc["id"], "type": "function", "function": tc["function"]})
                    # Save assistant tool call message
                    session_mgr.add_message("assistant", content_accum, tool_calls=tool_calls_list, tool_trace=tool_trace)
                    # Send tool badges live
                    for tc in tool_calls_list:
                        await resp.write(f"data: {json.dumps({'type':'tool','tool': tc['function']['name']})}\n\n".encode())
                    # Execute
                    for tc in tool_calls_list:
                        fn_name = tc["function"]["name"]
                        fn_args = _robust_tool_args_parse(tc["function"].get("arguments", "{}"))
                        out_text = execute_tool_call(fn_name, fn_args, canvas_context, session_mgr)
                        session_mgr.add_message("tool", out_text, tool_call_id=tc["id"])
                        trace_entry = {"tool": fn_name, "args": fn_args, "output": out_text[:800]}
                        try:
                            out_data = json.loads(out_text)
                            if out_data.get("status") == "pending_user_approval":
                                pending_approvals.append(out_data)
                                trace_entry["pending"] = not yolo_mode
                        except: pass
                        tool_trace.append(trace_entry)
                        await resp.write(f"data: {json.dumps({'type':'tool_result','tool': fn_name, 'output': out_text[:600]})}\n\n".encode())
                    # If approvals, stop and hand off to UI - don't auto-continue loop without user
                    if pending_approvals:
                        await resp.write(f"data: {json.dumps({'type':'pending','pending_approvals': pending_approvals, 'pending_approval': pending_approvals[-1], 'tool_trace': tool_trace})}\n\n".encode())
                        # Also save a placeholder assistant message for the approvals? No, wait for user
                        break
                    # Continue loop to get LLM's follow-up after tool results (will stream next turn)
                    continue
                else:
                    # No tool calls — final answer
                    final_text = content_accum
                    session_mgr.add_message("assistant", final_text, tool_trace=tool_trace)
                    await resp.write(f"data: {json.dumps({'type':'done','response': final_text, 'model': model_id, 'tool_trace': tool_trace, 'pending_approvals': pending_approvals, 'pending_approval': pending_approvals[-1] if pending_approvals else None})}\n\n".encode())
                    break

            await resp.write(b"data: [DONE]\n\n")
            await resp.write_eof()
            return resp
        except Exception as e:
            try:
                resp = web.StreamResponse(status=200, headers={"Content-Type":"text/event-stream"})
                await resp.prepare(request)
                await resp.write(f"data: {json.dumps({'type':'error','error': str(e)[:1000]})}\n\n".encode())
                await resp.write(b"data: [DONE]\n\n")
                await resp.write_eof()
                return resp
            except:
                return web.json_response({"error": str(e)}, status=500)

    # ---- Install (non-blocking) --------------------------------------------

    @routes.post("/comfyagent/install")
    async def install_node_handler(request):
        try:
            data = await request.json()
            url = data.get("github_url", "")
            # Basic URL validation
            if not url.startswith("https://github.com/"):
                return web.json_response(
                    {"error": "Only https://github.com/ URLs are allowed."}, status=400
                )
            loop = asyncio.get_running_loop()
            res = await loop.run_in_executor(
                None,
                partial(CustomNodeInstaller.install_via_github, url)
            )
            return web.json_response(res)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    # ---- Restart -----------------------------------------------------------

    @routes.post("/comfyagent/restart")
    async def restart_handler(request):
        loop = asyncio.get_running_loop()
        loop.call_later(1.5, OptimizationAndFixTools.trigger_backend_restart)
        return web.json_response({"status": "restarting", "message": "Backend server is restarting in 1.5 seconds..."})

    # ---- Node Details (non-blocking) ---------------------------------------

    @routes.post("/comfyagent/node_details")
    async def node_details_handler(request):
        data = await request.json()
        node_name = data.get("node_name", "")
        res = IntrospectionTools.get_node_details(node_name)
        return web.json_response(res)

    # ---- Models (non-blocking) ---------------------------------------------

    @routes.get("/comfyagent/models")
    async def models_handler(request):
        settings = load_settings()
        endpoint = settings.get("api_endpoint", "https://openrouter.ai/api/v1")
        cached = _models_cache.get(endpoint)
        if cached and time.time() - cached["time"] < _models_cache_ttl:
            return web.json_response(cached["data"])
        loop = asyncio.get_running_loop()
        # Fetch both best free (OpenRouter) and full list (works for custom endpoints)
        best_free = await loop.run_in_executor(
            None,
            partial(fetch_openrouter_free_models, endpoint)
        )
        all_models = await loop.run_in_executor(
            None,
            partial(fetch_all_models, endpoint)
        )
        response = {
            "current_model": settings.get("model_id"),
            "recommended_free": best_free,
            "all_models": all_models.get("models", [])[:80],
            "models_count": all_models.get("count", 0),
            "endpoint": endpoint,
            "error": all_models.get("error")
        }
        _models_cache[endpoint] = {"time": time.time(), "data": response}
        return web.json_response(response)

    # ---- Workflow Queue (actual ComfyUI prompt queue) ----------------------

    @routes.post("/comfyagent/queue_prompt")
    async def queue_prompt_handler(request):
        """Queue the active workflow as a prompt via the ComfyUI internal API."""
        try:
            data = await request.json()
            workflow_json = data.get("workflow", None)
            if not workflow_json:
                return web.json_response({"error": "No workflow provided."}, status=400)
            # Forward to ComfyUI's own /prompt endpoint internally
            prompt_payload = {"prompt": workflow_json}
            # Use PromptServer's internal prompt queue
            import execution
            valid = execution.validate_prompt(workflow_json)
            if valid[0]:
                # Queue it
                extra_data = {}
                prompt_id = PromptServer.instance.last_prompt_id = str(
                    __import__("uuid").uuid4()
                )
                PromptServer.instance.prompt_queue.put(
                    (0, prompt_id, workflow_json, extra_data, [])
                )
                return web.json_response({"status": "queued", "prompt_id": prompt_id})
            else:
                return web.json_response({"status": "validation_error", "errors": valid[1]}, status=400)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    @routes.get("/comfyagent/execution/{prompt_id}")
    async def execution_status_handler(request):
        """Return ComfyUI history/log output for a queued prompt."""
        prompt_id = request.match_info.get("prompt_id")
        try:
            import execution
            history = getattr(execution, "PromptQueue", None)
            # ComfyUI's public history is exposed by PromptServer prompt server
            # in current builds; use prompt queue history fallback when present.
            prompt_server = PromptServer.instance
            history_store = getattr(prompt_server, "prompt_queue", None)
            result = {"prompt_id": prompt_id, "status": "running", "logs": []}
            # Try server history implementations across ComfyUI versions.
            if hasattr(prompt_server, "get_history"):
                value = prompt_server.get_history(prompt_id)
                result["history"] = value
                result["status"] = "completed" if value else "running"
            elif history_store and hasattr(history_store, "get_history").__class__:
                result["status"] = "running"
            return web.json_response(result)
        except Exception as e:
            return web.json_response({"prompt_id": prompt_id, "status": "error", "logs": [str(e)]})

    @routes.post("/comfyagent/annotate_outputs")
    async def annotate_outputs_handler(request):
        try:
            data = await request.json()
            result = ImageMetadataTools.annotate_recent_outputs(
                prompt_id=data.get("prompt_id"),
                workflow_nodes=data.get("workflow_nodes", [])
            )
            return web.json_response(result)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)


# Register routes on ComfyUI server instance
try:
    # ComfyUI exposes a RouteTableDef on PromptServer. Registering on the
    # aiohttp Application directly does not work in current ComfyUI builds.
    setup_routes(PromptServer.instance.routes)
    print("[ComfyAgent] API routes registered successfully.")
except Exception as e:
    print(f"[ComfyAgent] Route setup deferred or warning: {e}")
