import json
import urllib.request
import urllib.error

from settings_manager import load_settings
from agent_tools import IntrospectionTools, ModelFolderTools, FileInspectionTools, WebResearchTools, CustomNodeInstaller, OptimizationAndFixTools, CanvasIntrospectionTools

MAX_TOOL_ROUNDS = 5  # Guard against infinite tool-call recursion

# OpenRouter-specific limits: user has 800 credits, default 65536 max_tokens fails with 402
OPENROUTER_MAX_TOKENS = 800
OPENROUTER_TEMPERATURE = 0.7
# Chunked sending only for OpenRouter: keep prompt small, send history incrementally
OPENROUTER_MAX_HISTORY_MESSAGES = 12
OPENROUTER_MAX_CONTENT_CHARS = 6000  # per message
OPENROUTER_MAX_CANVAS_NODES_IN_PROMPT = 20  # don't dump huge workflow into system prompt

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "create_task_plan",
            "description": "Create a persistent plan for a multi-step user task before acting. Use stages, dependencies, required information, and a clear next step.",
            "parameters": {
                "type": "object",
                "properties": {
                    "goal": {"type": "string"},
                    "stages": {"type": "array", "items": {"type": "string"}},
                    "required_information": {"type": "array", "items": {"type": "string"}},
                    "next_step": {"type": "string"}
                },
                "required": ["goal", "stages", "required_information", "next_step"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_task_plan",
            "description": "Update persistent task state after a verified action. Mark stages complete, record failures, and define the next stage.",
            "parameters": {
                "type": "object",
                "properties": {
                    "current_stage": {"type": "string"},
                    "completed_stages": {"type": "array", "items": {"type": "string"}},
                    "remaining_stages": {"type": "array", "items": {"type": "string"}},
                    "blocked_reason": {"type": "string"},
                    "next_step": {"type": "string"}
                },
                "required": ["current_stage", "completed_stages", "remaining_stages", "next_step"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "request_credential_use",
            "description": "Request permission to use a configured credential for a specific operation. Never exposes the secret value to the model. Use only when an operation truly requires it.",
            "parameters": {
                "type": "object",
                "properties": {
                    "credential": {"type": "string", "enum": ["api_key", "civitai_key", "github_token"]},
                    "purpose": {"type": "string", "description": "Exact operation the credential will be used for"},
                    "endpoint_or_target": {"type": "string", "description": "Service or target receiving the credential"}
                },
                "required": ["credential", "purpose", "endpoint_or_target"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "inspect_node_subgraph",
            "description": "Inspect the actual internal graph of a group/subgraph node by ID. Returns nested nodes, widgets, links, groups, inputs, outputs, and execution-relevant details. Use this before explaining what a group or subgraph does. If the internal graph is unavailable, explicitly report that instead of guessing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "node_id": {"type": "string", "description": "Exact outer group/subgraph node ID"},
                    "canvas_context": {"type": "string", "description": "Optional JSON string containing live canvas context"}
                },
                "required": ["node_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "batch_connect_nodes",
            "description": "Connect multiple verified node links in one approved batch. Use this instead of separate connect_nodes calls when wiring a workflow. Requires exact current node IDs and slot names/indices.",
            "parameters": {
                "type": "object",
                "properties": {
                    "connections": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "from_node_id": {"type": "string"},
                                "from_slot": {"type": "string"},
                                "to_node_id": {"type": "string"},
                                "to_slot": {"type": "string"}
                            },
                            "required": ["from_node_id", "from_slot", "to_node_id", "to_slot"]
                        }
                    },
                    "reason": {"type": "string"}
                },
                "required": ["connections", "reason"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "select_nodes_and_create_subgraph",
            "description": "Select exact existing node IDs and create a named subgraph/group from them on the active canvas. Requires user approval. Uses native nested-subgraph API when available; otherwise creates a visual group and reports that it is not a true nested subgraph.",
            "parameters": {
                "type": "object",
                "properties": {
                    "node_ids": {"type": "array", "items": {"type": "string"}, "description": "Exact node IDs to include"},
                    "name": {"type": "string", "description": "UI name for the subgraph/group"},
                    "reason": {"type": "string", "description": "Why these nodes should be grouped"}
                },
                "required": ["node_ids", "name", "reason"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_model_folders",
            "description": "List actual files in ComfyUI model folders. Always use this before choosing a checkpoint, VAE, LoRA, CLIP, ControlNet, upscale model, UNET, or diffusion model. Never invent filenames.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "inspect_file_path",
            "description": "Read-only inspect an allowed ComfyUI/custom-node/model path. Returns existence, type, size, and directory items. Use for debugging paths and files; never claim to watch continuously.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path under a ComfyUI model/custom_nodes directory"},
                    "recursive": {"type": "boolean", "description": "Whether to inspect nested directories"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "find_node_candidates",
            "description": "Search the live registered ComfyUI node classes for exact candidates matching a vague request such as 'LNR node', 'upscale', or 'loader'. Use this before add_node_to_canvas whenever the requested node name is not an exact class name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "User's vague node search term"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "agent_checkpoint",
            "description": "Mandatory self-check during multi-step tasks. Review completed steps, remaining steps, essential workflow connections, missing information, and whether to continue or pause for the user. Call this before claiming completion or after a mutation sequence.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_summary": {"type": "string", "description": "Short description of the current task"},
                    "completed": {"type": "array", "items": {"type": "string"}, "description": "Steps that are verified complete"},
                    "remaining": {"type": "array", "items": {"type": "string"}, "description": "Steps still required"},
                    "essential_connections": {"type": "array", "items": {"type": "string"}, "description": "Connections that must exist for the requested workflow"},
                    "missing_information": {"type": "array", "items": {"type": "string"}, "description": "Information needed from the user"},
                    "decision": {"type": "string", "enum": ["continue", "ask_user", "stop"], "description": "Whether to continue, ask a question, or stop"},
                    "question": {"type": "string", "description": "Question for the user if decision is ask_user"}
                },
                "required": ["task_summary", "completed", "remaining", "essential_connections", "missing_information", "decision"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "validate_workflow",
            "description": "Validate the current live workflow before claiming it is complete. Checks actual node IDs, links, required inputs, disconnected nodes, missing model/widget values, and output nodes.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_node_details",
            "description": "Get parameters, inputs, outputs and types for a specific ComfyUI node class name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "node_name": {
                        "type": "string",
                        "description": "Exact node class name (e.g. KSampler, LoadImage, CheckpointLoaderSimple)"
                    }
                },
                "required": ["node_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_installed_custom_nodes",
            "description": "List all installed custom node packages in ComfyUI.",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_custom_nodes_web",
            "description": "Search web and ComfyUI Manager database for node plugins or custom node recommendations.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search keyword (e.g., ControlNet, AnimateDiff, Upscale)"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "request_install_custom_node",
            "description": "Propose installing a missing custom node from GitHub repository URL. The system will present a confirmation dialog to the user. NEVER install without user consent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "github_url": {
                        "type": "string",
                        "description": "GitHub repository URL to clone"
                    },
                    "reason": {
                        "type": "string",
                        "description": "Why this node is needed for the current workflow"
                    }
                },
                "required": ["github_url", "reason"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "backup_and_fix_custom_node",
            "description": "Create a zip backup of custom_nodes folder, then inspect a custom node folder for crash bugs, missing imports, or optimization issues. ALWAYS creates backup before any inspection.",
            "parameters": {
                "type": "object",
                "properties": {
                    "folder_name": {
                        "type": "string",
                        "description": "Name of the custom node directory to inspect and fix"
                    }
                },
                "required": ["folder_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_node_to_canvas",
            "description": "Request adding a ComfyUI node to the active canvas tab. This only creates an approval request; the frontend must ask the user before changing the workflow.",
            "parameters": {
                "type": "object",
                "properties": {
                    "node_name": {
                        "type": "string",
                        "description": "Exact registered ComfyUI node class name, for example KSampler"
                    },
                    "reason": {
                        "type": "string",
                        "description": "Why this node should be added"
                    }
                },
                "required": ["node_name", "reason"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "trigger_workflow_execution",
            "description": "Queue a test prompt execution of the current active workflow on the ComfyUI backend. Returns the prompt_id for tracking. The user will be asked for confirmation in the UI before execution starts.",
            "parameters": {
                "type": "object",
                "properties": {
                    "workflow_json": {
                        "type": "string",
                        "description": "Optional workflow JSON override. If empty, the current active canvas workflow is used."
                    },
                    "test_run": {
                        "type": "boolean",
                        "description": "Run as a test and return execution status/logs instead of silently queueing"
                    },
                    "return_logs": {
                        "type": "boolean",
                        "description": "After execution, return ComfyUI history/output/error details to the AI"
                    },
                    "wait_for_completion": {
                        "type": "boolean",
                        "description": "Wait for the prompt to finish before returning; recommended for test_run"
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "optimize_workflow",
            "description": "Analyze the current workflow for performance issues and suggest optimizations. Checks for: redundant nodes, VRAM-heavy operations without tiling, missing VAE decode optimizations, unnecessary upscale steps.",
            "parameters": {
                "type": "object",
                "properties": {
                    "canvas_nodes": {
                        "type": "string",
                        "description": "JSON string of current canvas nodes list"
                    }
                },
                "required": ["canvas_nodes"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for ComfyUI related information, tutorials, node documentation, or troubleshooting. Returns both general web results and ComfyUI Manager registry matches.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "web_fetch",
            "description": "Fetch and extract readable text from a specific URL. Use after web_search to read a result page.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Full http(s) URL to fetch"
                    }
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_workflow_details",
            "description": "Get detailed info about the active workflow including node types, categories, links, groups, and subgraphs. Use this to understand the current canvas structure before editing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "canvas_context": {
                        "type": "string",
                        "description": "Optional JSON string of canvas context if already known"
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "edit_node_widget",
            "description": "Edit a widget/parameter value of a node on the active canvas. Requires user approval. You must know the node ID and widget name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "node_id": {
                        "type": "string",
                        "description": "Node ID on the canvas (from canvas_context)"
                    },
                    "widget_name": {
                        "type": "string",
                        "description": "Widget/parameter name to edit (e.g. seed, steps, cfg, ckpt_name)"
                    },
                    "new_value": {
                        "type": "string",
                        "description": "New value as string (will be coerced to correct type)"
                    },
                    "reason": {
                        "type": "string",
                        "description": "Why this edit is needed"
                    }
                },
                "required": ["node_id", "widget_name", "new_value", "reason"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delete_nodes",
            "description": "Delete one or more nodes from the active workflow. Requires user approval.",
            "parameters": {
                "type": "object",
                "properties": {
                    "node_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Array of node IDs to delete"
                    },
                    "reason": {"type": "string", "description": "Why these nodes should be removed"}
                },
                "required": ["node_ids", "reason"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "replace_node",
            "description": "Replace one existing node on the active canvas with another node type atomically. Use this for requests like swap KSampler to KSamplerAdvanced. Preserves position, copies compatible widget values, and preserves compatible input/output links. Requires user approval.",
            "parameters": {
                "type": "object",
                "properties": {
                    "node_id": {"type": "string", "description": "ID of the existing node to replace"},
                    "new_node_name": {"type": "string", "description": "Exact registered node class name to create"},
                    "reason": {"type": "string", "description": "Why this replacement is needed"}
                },
                "required": ["node_id", "new_node_name", "reason"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "inspect_subgraphs",
            "description": "Inspect subgraphs and nested node graphs recursively in the active workflow. Returns nested nodes, links, groups, depth, and paths. Use this before editing a node inside a subgraph.",
            "parameters": {
                "type": "object",
                "properties": {
                    "canvas_context": {
                        "type": "string",
                        "description": "Optional JSON string of canvas context"
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "connect_nodes",
            "description": "Connect an output slot of one node to an input slot of another on the active canvas. Requires user approval.",
            "parameters": {
                "type": "object",
                "properties": {
                    "from_node_id": {"type": "string", "description": "Source node ID"},
                    "from_slot": {"type": "string", "description": "Output slot name or index on source node"},
                    "to_node_id": {"type": "string", "description": "Target node ID"},
                    "to_slot": {"type": "string", "description": "Input slot name or index on target node"},
                    "reason": {"type": "string", "description": "Why this connection is needed"}
                },
                "required": ["from_node_id", "from_slot", "to_node_id", "to_slot", "reason"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "ask_user",
            "description": "Ask the user a clarifying question with selectable options (like OpenCode). Use when you need to make the next step clearer, e.g. which workflow to build, which model to use, or whether to install something. Renders as buttons in the chat.",
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "The question to ask the user (complete sentence)"},
                    "header": {"type": "string", "description": "Short header, max 30 chars, e.g. 'Build workflow?'"},
                    "options": {
                        "type": "array",
                        "description": "2-4 selectable options",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string", "description": "Button label, 1-5 words, concise"},
                                "description": {"type": "string", "description": "Explanation of choice"}
                            },
                            "required": ["label", "description"]
                        }
                    },
                    "multiple": {
                        "type": "boolean",
                        "description": "Set true when the user may select more than one option"
                    },
                    "min_selections": {
                        "type": "integer",
                        "description": "Minimum number of options required when multiple is true"
                    },
                    "max_selections": {
                        "type": "integer",
                        "description": "Maximum number of options allowed when multiple is true"
                    }
                },
                "required": ["question", "header", "options"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "batch_add_nodes",
            "description": "Add multiple ComfyUI nodes at once to build a workflow (e.g. simple txt2img). Each node is added with user approval as a batch. Use this when user wants a complete workflow, not just one node.",
            "parameters": {
                "type": "object",
                "properties": {
                    "nodes": {
                        "type": "array",
                        "description": "List of node class names to add",
                        "items": {"type": "string"}
                    },
                    "reason": {"type": "string", "description": "Why these nodes are needed together"}
                },
                "required": ["nodes", "reason"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "arrange_workflow_nodes",
            "description": "Arrange existing nodes on the active canvas into a readable left-to-right grid. This changes positions only, not nodes or connections. Requires user approval.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {"type": "string", "description": "Why the workflow should be arranged"}
                },
                "required": ["reason"]
            }
        }
    }
]

def fetch_openrouter_free_models(api_endpoint: str) -> str:
    """Fetch free models list from OpenRouter API and pick best available free model."""
    try:
        url = f"{api_endpoint.rstrip('/')}/models"
        req = urllib.request.Request(url, headers={"User-Agent": "ComfyAgent"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            # OpenAI-compatible servers usually return {data:[...]}; some
            # local endpoints return the model array directly.
            data_list = data if isinstance(data, list) else data.get("data", data.get("models", []))
            if isinstance(data_list, dict):
                data_list = [data_list]
            free_models = []
            for item in data_list:
                if not isinstance(item, dict):
                    continue
                pricing = item.get("pricing", {})
                if not isinstance(pricing, dict):
                    pricing = {}
                if str(pricing.get("prompt", "0")) == "0" and str(pricing.get("completion", "0")) == "0":
                    if item.get("id"):
                        free_models.append(item["id"])
            
            # Preferred priority list for free models
            priority = [
                "google/gemini-2.0-flash-exp:free",
                "google/gemini-flash-1.5-8b:free",
                "meta-llama/llama-3.3-70b-instruct:free",
                "deepseek/deepseek-r1:free",
                "qwen/qwen-2.5-coder-32b-instruct:free",
            ]
            for p in priority:
                if p in free_models:
                    return p
            if free_models:
                return free_models[0]
    except Exception as e:
        print(f"[ComfyAgent] Dynamic model fetch error: {e}")
    return "google/gemini-2.0-flash-exp:free"

def fetch_all_models(api_endpoint: str) -> dict:
    """Fetch all models list from OpenAI-compatible endpoint (works for OpenRouter and custom)."""
    try:
        url = f"{api_endpoint.rstrip('/')}/models"
        from settings_manager import load_settings as _ls
        _s = _ls()
        _key = _s.get("api_key", "").strip()
        hdrs = {"User-Agent": "ComfyAgent"}
        if _key:
            hdrs["Authorization"] = f"Bearer {_key}"
        req = urllib.request.Request(url, headers=hdrs)
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = resp.read().decode()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                data = _robust_api_response_parse(raw)
            items = data if isinstance(data, list) else data.get("data", data.get("models", data.get("object", [])))
            if isinstance(items, dict):
                items = [items]
            out = []
            for it in (items or [])[:80]:
                if isinstance(it, str):
                    out.append({"id": it})
                elif isinstance(it, dict):
                    out.append({"id": it.get("id", str(it)), "name": it.get("name", it.get("id", "")), "pricing": it.get("pricing", {})})
            return {"models": out, "count": len(out)}
    except Exception as e:
        return {"error": str(e), "models": []}

def _robust_tool_args_parse(raw_args):
    """Custom endpoint may return args as dict, string, or malformed JSON with extra data."""
    if raw_args is None:
        return {}
    if isinstance(raw_args, dict):
        return raw_args
    if isinstance(raw_args, list):
        # A malformed provider occasionally wraps one argument object in a list.
        return raw_args[0] if raw_args and isinstance(raw_args[0], dict) else {}
    if not isinstance(raw_args, str):
        try:
            return json.loads(str(raw_args))
        except:
            return {}
    s = raw_args.strip()
    if not s:
        return {}
    # Try direct
    try:
        return json.loads(s)
    except json.JSONDecodeError as e:
        # Extra data: try to load first JSON object only
        if "Extra data" in str(e):
            # Find first complete JSON object by brace counting
            depth = 0
            start = None
            for i, ch in enumerate(s):
                if ch == "{":
                    if start is None:
                        start = i
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0 and start is not None:
                        try:
                            return json.loads(s[start:i+1])
                        except:
                            pass
                        break
            # Try truncating at error position
            try:
                return json.loads(s[:e.pos])
            except:
                pass
        return {}

def _robust_api_response_parse(raw: str) -> dict:
    """Handle custom endpoints that concatenate JSON objects or stream, or return empty."""
    if not raw or not raw.strip():
        raise ValueError("Empty response from LLM endpoint (custom endpoint may be down or returned no body — preview empty)")
    raw_stripped = raw.strip()
    # Handle SSE / NDJSON streaming even for single-chunk responses
    if "data:" in raw_stripped or "\n" in raw_stripped:
        stream_parts = []
        has_stream = False
        tool_deltas = []
        for line in raw_stripped.splitlines():
            line = line.strip()
            if not line:
                continue
            original_line = line
            if line.startswith("data:"):
                line = line[5:].strip()
                has_stream = True
                if line == "[DONE]" or not line:
                    continue
            else:
                # Heuristic: if we saw any data: line, treat remaining lines as stream too
                if has_stream and line.startswith("{"):
                    pass
                elif not has_stream and not line.startswith("{"):
                    continue
            try:
                parsed_line = json.loads(line)
                normalized_line = _normalize_provider_response(parsed_line)
                line_choices = normalized_line.get("choices", [])
                if line_choices and isinstance(line_choices[0], dict):
                    first = line_choices[0]
                    line_msg = first.get("message", {})
                    if isinstance(line_msg, dict) and line_msg.get("content"):
                        stream_parts.append(_content_to_text(line_msg["content"]))
                    delta = first.get("delta", {})
                    if isinstance(delta, dict):
                        delta_content = delta.get("content", delta.get("text", ""))
                        if delta_content:
                            stream_parts.append(_content_to_text(delta_content))
                        # Collect streamed tool_calls deltas to reconstruct tool call
                        if "tool_calls" in delta and isinstance(delta["tool_calls"], list):
                            tool_deltas.extend(delta["tool_calls"])
                    # Also handle message tool_calls in streaming
                    if isinstance(line_msg, dict) and "tool_calls" in line_msg:
                        tool_deltas.extend(line_msg.get("tool_calls", []))
            except:
                continue
        if stream_parts or tool_deltas:
            msg = {"role": "assistant", "content": "".join(stream_parts)}
            if tool_deltas:
                msg["tool_calls"] = tool_deltas
            return {"choices": [{"message": msg}]}
        # If we detected stream but got no content, fall through to try direct parse of first data: payload
        if has_stream:
            for line in raw_stripped.splitlines():
                l = line.strip()
                if l.startswith("data:"):
                    l = l[5:].strip()
                    if l and l != "[DONE]":
                        try:
                            return _normalize_provider_response(json.loads(l))
                        except:
                            continue
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        if "Extra data" in str(e):
            # Try to parse only first JSON object
            depth = 0
            start = raw.find("{")
            for i in range(start, len(raw)):
                if raw[i] == "{":
                    depth += 1
                elif raw[i] == "}":
                    depth -= 1
                    if depth == 0:
                        try:
                            return json.loads(raw[start:i+1])
                        except:
                            break
            # Fallback: try up to error position
            try:
                return json.loads(raw[:e.pos].rstrip().rstrip(","))
            except:
                pass
        # For Expecting value at char 0, surface more helpful message
        if "Expecting value" in str(e) and e.pos == 0:
            preview = raw.strip()[:200]
            raise ValueError(f"Endpoint returned non-JSON or empty (preview: {preview!r}). Is the custom endpoint URL correct and model running?")
        raise

def _normalize_provider_response(res_data):
    """Normalize common OpenAI-compatible provider response variations."""
    if isinstance(res_data, list):
        # Some local servers return a list of streaming chunks. Join them
        # rather than dropping every chunk after the first one.
        chunks = []
        for item in res_data:
            normalized = _normalize_provider_response(item)
            choices = normalized.get("choices", []) if isinstance(normalized, dict) else []
            if choices and isinstance(choices[0], dict):
                msg = choices[0].get("message", {})
                text = msg.get("content", "") if isinstance(msg, dict) else ""
                if not text and isinstance(choices[0], dict):
                    delta = choices[0].get("delta", {})
                    if isinstance(delta, dict):
                        text = delta.get("content", delta.get("text", ""))
                if text:
                    chunks.append(_content_to_text(text))
        return {"choices": [{"message": {"role": "assistant", "content": "".join(chunks)}}]}
    if not isinstance(res_data, dict):
        raise ValueError("LLM endpoint returned a response that is not an object.")
    choices = res_data.get("choices")
    if isinstance(choices, dict):
        res_data["choices"] = [choices]
    elif isinstance(choices, list):
        # Normalize each choice's message content. Gemini-style content is
        # often [{text: "..."}] instead of a string.
        for choice in choices:
            if not isinstance(choice, dict):
                continue
            message = choice.get("message", choice)
            if not isinstance(message, dict):
                continue
            content = message.get("content", "")
            if isinstance(content, list):
                parts = []
                for part in content:
                    if isinstance(part, dict):
                        parts.append(str(part.get("text", part.get("content", ""))))
                    elif isinstance(part, str):
                        parts.append(part)
                message["content"] = "".join(parts)
            elif isinstance(content, dict):
                message["content"] = str(content.get("text", content.get("content", "")))
    elif choices is None:
        # Common local endpoint shape: {output: ...} / {response: ...}
        for field in ("output", "response", "text", "content"):
            if field in res_data:
                value = res_data[field]
                if isinstance(value, list):
                    value = "".join(str(x.get("text", x)) if isinstance(x, dict) else str(x) for x in value)
                return {"choices": [{"message": {"role": "assistant", "content": str(value)}}]}
        message = res_data.get("message")
        if isinstance(message, str):
            return {"choices": [{"message": {"role": "assistant", "content": message}}]}
        if isinstance(message, dict):
            return {"choices": [{"message": message}]}
        # Gemini generateContent shape
        candidates = res_data.get("candidates")
        if isinstance(candidates, list):
            parts = []
            for candidate in candidates:
                if not isinstance(candidate, dict):
                    continue
                content = candidate.get("content", {})
                for part in content.get("parts", []) if isinstance(content, dict) else []:
                    if isinstance(part, dict) and part.get("text"):
                        parts.append(str(part["text"]))
            return {"choices": [{"message": {"role": "assistant", "content": "".join(parts)}}]}
    return res_data

def _content_to_text(content):
    """Convert provider content variants to plain text."""
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        return str(content.get("text", content.get("content", "")))
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict):
                parts.append(str(part.get("text", part.get("content", ""))))
            else:
                parts.append(str(part))
        return "".join(parts)
    return str(content)

def _clean_provider_text(text):
    """Remove provider control markers before displaying or persisting text."""
    if not isinstance(text, str):
        return text or ""
    import re
    cleaned = re.sub(r"<\s*[|｜].{0,40}?DSML.{0,80}?(?:[|｜>]|$)", "", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"<\s*[|｜].{0,80}?(?:function_calls?|tool_calls?).{0,80}?(?:[|｜>]|$)", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(?:function_calls?|tool_calls?)\b", "", cleaned, flags=re.IGNORECASE)
    return re.sub(r"\n\s*\n\s*\n+", "\n\n", cleaned).strip()

def execute_tool_call(tool_name: str, args: dict, canvas_context: dict = None, session_manager=None) -> str:
    """Execute a single tool call and return JSON string result."""
    try:
        # Providers sometimes wrap arguments in a one-item list. Normalize it
        # here so every tool receives the object shape its schema describes.
        if isinstance(args, list):
            args = next((item for item in args if isinstance(item, dict)), {})
        if not isinstance(args, dict):
            args = {}
        if session_manager is None:
            # Keep direct unit/tool calls safe without relying on an undefined
            # global; normal chat always passes the active session manager.
            from session_manager import session_mgr as session_manager
        if tool_name == "get_node_details":
            res = IntrospectionTools.get_node_details(args.get("node_name", ""))
            return json.dumps(res, indent=2)
        elif tool_name == "inspect_node_subgraph":
            ctx = canvas_context or {}
            if args.get("canvas_context"):
                try: ctx = json.loads(args["canvas_context"])
                except (TypeError, json.JSONDecodeError): pass
            return json.dumps(CanvasIntrospectionTools.inspect_node_subgraph(args.get("node_id"), ctx), indent=2)
        elif tool_name == "create_task_plan":
            task = {
                "goal": args.get("goal", ""),
                "stages": args.get("stages", []),
                "required_information": args.get("required_information", []),
                "completed_stages": [],
                "remaining_stages": args.get("stages", []),
                "current_stage": "planning",
                "next_step": args.get("next_step", ""),
                "blocked_reason": ""
            }
            session_manager.set_task(task)
            return json.dumps({"status": "planned", "task": task}, indent=2)
        elif tool_name == "update_task_plan":
            task = session_manager.update_task({
                "current_stage": args.get("current_stage", ""),
                "completed_stages": args.get("completed_stages", []),
                "remaining_stages": args.get("remaining_stages", []),
                "blocked_reason": args.get("blocked_reason", ""),
                "next_step": args.get("next_step", "")
            })
            return json.dumps({"status": "updated", "task": task}, indent=2)
        elif tool_name == "request_credential_use":
            credential = args.get("credential", "")
            settings = load_settings()
            configured = bool(settings.get(credential, ""))
            return json.dumps({
                "status": "pending_user_approval",
                "action": "use_credential",
                "credential": credential,
                "configured": configured,
                "purpose": args.get("purpose", ""),
                "endpoint_or_target": args.get("endpoint_or_target", ""),
                "message": "Credential is available: " + str(configured) + ". The secret value is never returned to the AI or chat."
            })
        elif tool_name == "inspect_file_path":
            return json.dumps(FileInspectionTools.inspect_path(args.get("path", ""), bool(args.get("recursive", False))), indent=2)
        elif tool_name == "agent_checkpoint":
            decision = args.get("decision", "stop")
            result = {
                "status": "agent_checkpoint",
                "action": "agent_checkpoint",
                "decision": decision,
                "task_summary": args.get("task_summary", ""),
                "completed": args.get("completed", []),
                "remaining": args.get("remaining", []),
                "essential_connections": args.get("essential_connections", []),
                "missing_information": args.get("missing_information", []),
                "question": args.get("question", "")
            }
            if decision == "ask_user":
                result["status"] = "pending_user_approval"
                result["question"] = result["question"] or "I need clarification before continuing."
            return json.dumps(result, indent=2)
        elif tool_name == "validate_workflow":
            return json.dumps(_validate_live_workflow(canvas_context), indent=2)
        elif tool_name == "find_node_candidates":
            return json.dumps(IntrospectionTools.find_node_candidates(args.get("query", "")), indent=2)
        elif tool_name == "list_model_folders":
            return json.dumps(ModelFolderTools.list_model_folders(), indent=2)
        elif tool_name == "select_nodes_and_create_subgraph":
            node_ids = args.get("node_ids", [])
            return json.dumps({
                "status": "pending_user_approval",
                "action": "select_nodes_and_create_subgraph",
                "node_ids": node_ids,
                "name": args.get("name", "Subgraph"),
                "reason": args.get("reason", ""),
                "title": "Create subgraph/group?",
                "message": f"Group nodes {node_ids} as '{args.get('name', 'Subgraph')}'? The active canvas will be changed; existing links should be preserved when ComfyUI supports it.\nReason: {args.get('reason', '')}"
            })
        elif tool_name == "get_node_dropdown_options":
            res = IntrospectionTools.get_node_dropdown_options(args.get("node_name", ""))
            return json.dumps(res, indent=2)
        elif tool_name == "list_installed_custom_nodes":
            res = IntrospectionTools.list_installed_custom_nodes()
            return json.dumps(res, indent=2)
        elif tool_name == "search_custom_nodes_web":
            res = WebResearchTools.search_web_and_custom_nodes(args.get("query", ""))
            return json.dumps(res, indent=2)
        elif tool_name == "request_install_custom_node":
            # This returns a pending status -- actual install requires user confirmation via frontend
            return json.dumps({
                "status": "pending_user_approval",
                "github_url": args.get("github_url", ""),
                "reason": args.get("reason", ""),
                "message": "Installation request sent to user for approval. Wait for user confirmation before proceeding."
            })
        elif tool_name == "add_node_to_canvas":
            requested = str(args.get("node_name", "")).strip()
            candidates = IntrospectionTools.find_node_candidates(requested)
            exact = any(item.get("node_name") == requested for item in candidates if isinstance(item, dict))
            # Folder/plugin names such as LNR are not node class names.
            if not exact and len(candidates) != 1:
                return json.dumps({
                    "status": "pending_user_approval",
                    "action": "ask_user",
                    "header": "Which node should I add?",
                    "question": f"I found {len(candidates)} registered nodes matching '{requested}'. Which exact node do you want?",
                    "options": [
                        {"label": item.get("node_name", ""), "description": f"{item.get('display_name', '')} — {item.get('category', '')}"}
                        for item in candidates[:4] if isinstance(item, dict) and item.get("node_name")
                    ]
                })
            if not exact and len(candidates) == 1:
                requested = candidates[0]["node_name"]
            return json.dumps({
                "status": "pending_user_approval",
                "action": "add_node_to_canvas",
                "node_name": requested,
                "reason": args.get("reason", ""),
                "message": "The user must approve adding this node to the active workflow tab."
            })
        elif tool_name == "backup_and_fix_custom_node":
            backup_path = OptimizationAndFixTools.backup_custom_nodes()
            fix_res = OptimizationAndFixTools.inspect_and_fix_custom_node(args.get("folder_name", ""))
            return json.dumps({"backup_path": backup_path, "fix_result": fix_res}, indent=2)
        elif tool_name == "trigger_workflow_execution":
            return json.dumps({
                "status": "pending_user_approval",
                "action": "execute_workflow",
                "test_run": bool(args.get("test_run", True)),
                "return_logs": bool(args.get("return_logs", True)),
                "wait_for_completion": bool(args.get("wait_for_completion", True)),
                "workflow_json": args.get("workflow_json", ""),
                "message": "Workflow execution request sent to user for approval. After approval, ComfyUI will queue the test and return status/logs."
            })
        elif tool_name == "optimize_workflow":
            return _analyze_workflow_optimization(args.get("canvas_nodes", "[]"))
        elif tool_name == "web_search":
            res = WebResearchTools.search_web_and_custom_nodes(args.get("query", ""))
            return json.dumps(res, indent=2)
        elif tool_name == "web_fetch":
            res = WebResearchTools.fetch_url_content(args.get("url", ""))
            return json.dumps(res, indent=2)
        elif tool_name == "get_workflow_details":
            ctx = {}
            try:
                if args.get("canvas_context"):
                    ctx = json.loads(args.get("canvas_context"))
            except:
                pass
            if not ctx and isinstance(canvas_context, dict):
                ctx = canvas_context
            res = CanvasIntrospectionTools.get_detailed_workflow_info(ctx)
            return json.dumps(res, indent=2)
        elif tool_name == "inspect_subgraphs":
            ctx = {}
            try:
                if args.get("canvas_context"):
                    ctx = json.loads(args.get("canvas_context"))
            except:
                pass
            if not ctx and isinstance(canvas_context, dict):
                ctx = canvas_context
            res = CanvasIntrospectionTools.list_subgraphs(ctx)
            return json.dumps(res, indent=2)
        elif tool_name == "edit_node_widget":
            return json.dumps({
                "status": "pending_user_approval",
                "action": "edit_node_widget",
                "node_id": args.get("node_id"),
                "widget_name": args.get("widget_name"),
                "new_value": args.get("new_value"),
                "reason": args.get("reason"),
                "title": f"Edit {args.get('widget_name')} on node {args.get('node_id')}?",
                "message": f"Change widget '{args.get('widget_name')}' on node {args.get('node_id')} to '{args.get('new_value')}'?\nReason: {args.get('reason')}"
            })
        elif tool_name == "delete_nodes":
            return json.dumps({
                "status": "pending_user_approval",
                "action": "delete_nodes",
                "node_ids": args.get("node_ids", []),
                "reason": args.get("reason"),
                "title": "Delete nodes?",
                "message": f"Delete nodes {args.get('node_ids')}?\nReason: {args.get('reason')}"
            })
        elif tool_name == "replace_node":
            return json.dumps({
                "status": "pending_user_approval",
                "action": "replace_node",
                "node_id": args.get("node_id"),
                "new_node_name": args.get("new_node_name"),
                "reason": args.get("reason"),
                "title": "Replace node?",
                "message": f"Replace node {args.get('node_id')} with {args.get('new_node_name')}? Position and compatible connections will be preserved.\nReason: {args.get('reason')}"
            })
        elif tool_name == "connect_nodes":
            return json.dumps({
                "status": "pending_user_approval",
                "action": "connect_nodes",
                "from_node_id": args.get("from_node_id"),
                "from_slot": args.get("from_slot"),
                "to_node_id": args.get("to_node_id"),
                "to_slot": args.get("to_slot"),
                "reason": args.get("reason"),
                "title": "Connect nodes?",
                "message": f"Connect {args.get('from_node_id')}:{args.get('from_slot')} -> {args.get('to_node_id')}:{args.get('to_slot')}?\nReason: {args.get('reason')}"
            })
        elif tool_name == "batch_connect_nodes":
            connections = args.get("connections", [])
            if not isinstance(connections, list) or not connections:
                return json.dumps({"error": "connections must be a non-empty array"})
            return json.dumps({
                "status": "pending_user_approval",
                "action": "batch_connect_nodes",
                "connections": connections[:50],
                "reason": args.get("reason", ""),
                "title": f"Connect {len(connections)} workflow links?",
                "message": f"Apply {len(connections)} verified workflow connections as one batch?\nReason: {args.get('reason', '')}"
            })
        elif tool_name == "ask_user":
            return json.dumps({
                "status": "pending_user_approval",
                "action": "ask_user",
                "header": args.get("header", "Question"),
                "question": args.get("question", ""),
                "options": args.get("options", []),
                "multiple": bool(args.get("multiple", False)),
                "min_selections": args.get("min_selections", 1),
                "max_selections": args.get("max_selections"),
            })
        elif tool_name == "batch_add_nodes":
            nodes = args.get("nodes", [])
            if not isinstance(nodes, list) or not nodes:
                return json.dumps({"error": "batch_add_nodes requires non-empty nodes array"})
            return json.dumps({
                "status": "pending_user_approval",
                "action": "batch_add_nodes",
                "nodes": nodes[:12],
                "reason": args.get("reason", ""),
                "title": f"Build workflow with {len(nodes)} nodes?",
                "message": f"Add nodes: {', '.join(nodes[:12])}?\nReason: {args.get('reason','')}"
            })
        elif tool_name == "arrange_workflow_nodes":
            return json.dumps({
                "status": "pending_user_approval",
                "action": "arrange_workflow_nodes",
                "reason": args.get("reason", ""),
                "title": "Arrange workflow nodes?",
                "message": f"Arrange existing nodes into a readable grid? This changes positions only; nodes and connections stay unchanged.\nReason: {args.get('reason','')}"
            })
        else:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})
    except Exception as e:
        return json.dumps({"error": f"Tool '{tool_name}' failed: {str(e)}"})

def _analyze_workflow_optimization(canvas_nodes_json: str) -> str:
    """Analyze workflow nodes for common performance issues."""
    suggestions = []
    warnings = []
    try:
        nodes = json.loads(canvas_nodes_json)
        if isinstance(nodes, dict):
            # Sometimes canvas_nodes is a dict with nodes key
            nodes = nodes.get("nodes", nodes.get("nodes_list", []))
    except (json.JSONDecodeError, TypeError) as e:
        return json.dumps({"error": f"Could not parse canvas_nodes JSON: {e}"})
    
    if not isinstance(nodes, list):
        return json.dumps({"error": "canvas_nodes should be a list of node objects with 'type' field."})
    
    # Ignore malformed provider/canvas entries instead of crashing on .get().
    nodes = [n for n in nodes if isinstance(n, dict)]
    node_types = [n.get("type", "") for n in nodes]
    type_counts = {}
    for t in node_types:
        type_counts[t] = type_counts.get(t, 0) + 1
    
    # 1. Sampling efficiency
    if node_types.count("KSampler") > 1:
        suggestions.append("Multiple KSampler nodes: chain them via LATENT or use KSamplerAdvanced for stepwise refinement instead of parallel samplers.")
    if type_counts.get("KSampler", 0) >= 1 and "KSamplerAdvanced" in node_types:
        warnings.append("Mixed KSampler + KSamplerAdvanced: ensure denoise progression is intentional.")
    if any(t in node_types for t in ["KSampler", "KSamplerAdvanced"]) and "CheckpointLoaderSimple" not in node_types and "CheckpointLoader" not in node_types and "UNETLoader" not in node_types:
        warnings.append("Sampler present but no checkpoint/UNET loader detected — workflow may be missing model loader.")
    
    # 2. VAE & latent efficiency
    if "VAEDecode" in node_types and "UpscaleImage" in node_types:
        try:
            idx_decode = node_types.index("VAEDecode")
            idx_upscale = node_types.index("UpscaleImage")
            if idx_decode < idx_upscale:
                suggestions.append("VAEDecode before UpscaleImage wastes VRAM — use LatentUpscale / LatentUpscaleBy + VAEDecode after, or use UltimateSDUpscale.")
        except: pass
    if "VAEDecodeTiled" not in node_types and any(t in node_types for t in ["VAEDecode"]) and len(nodes) > 20:
        suggestions.append("Large workflow with VAEDecode: consider VAEDecodeTiled for tiled decoding to avoid OOM on big images.")
    if node_types.count("VAELoader") > 1:
        warnings.append("Multiple VAELoader nodes — you can usually share a single VAE.")
    
    # 3. ControlNet
    if any("ControlNet" in t for t in node_types) and not any("Preprocess" in t or "preprocess" in t.lower() for t in node_types):
        suggestions.append("ControlNet without preprocessor detected — add appropriate preprocessor (e.g. DWPreprocessor, Canny, Depth) before ControlNetApply.")
    if "ControlNetApplyAdvanced" in node_types and "ControlNetApply" in node_types:
        warnings.append("Both ControlNetApply and ControlNetApplyAdvanced present — unify to one variant if possible.")
    
    # 4. VRAM heavy nodes
    hi_vram_nodes = [t for t in node_types if any(kw in t.lower() for kw in ["animatediff", "ipadapter", "instantid", "photomaker", "pulid"])]
    if hi_vram_nodes:
        suggestions.append(f"High-VRAM nodes: {', '.join(set(hi_vram_nodes))}. Enable tiled VAE, reduce batch_size, lower resolution, or offload with ModelSamplingDiscrete.")
    
    # 5. LoRA
    lora_count = sum(1 for t in node_types if "lora" in t.lower())
    if lora_count > 3:
        suggestions.append(f"{lora_count} LoRA nodes: each LoRA increases VRAM — stack only what you need, merge LoRAs if possible.")
    
    # 6. Text encoding
    if node_types.count("CLIPTextEncode") > 4:
        suggestions.append("Many CLIPTextEncode nodes: reuse encodings via reroute or cache positive/negative instead of duplicating.")
    
    # 7. Resolution / batch
    suggests_resolution = any("EmptyLatentImage" in t or "EmptySD3LatentImage" in t for t in node_types)
    if suggests_resolution:
        suggestions.append("Check EmptyLatent resolution: try 1024x1024 max for SDXL, use 512 for SD1.5 drafts, scale final with hires-fix.")
    
    # 8. General size
    if len(nodes) > 30:
        suggestions.append(f"Large workflow ({len(nodes)} nodes): group into subgraphs / node groups, or split into stages (generate → upscale → detail).")
    if len(nodes) < 5:
        warnings.append("Very small workflow — may be incomplete (e.g. missing SaveImage / PreviewImage).")
    
    # 9. Missing output
    if not any(t in node_types for t in ["SaveImage", "PreviewImage", "SaveImageWebsocket"]):
        warnings.append("No SaveImage/PreviewImage found — you won't see output.")
    
    # 10. Duplicate loaders
    for loader in ["CheckpointLoaderSimple", "UNETLoader", "CLIPLoader"]:
        if type_counts.get(loader, 0) > 1:
            warnings.append(f"Multiple {loader} — share loader output via reroute.")
    
    if not suggestions and not warnings:
        suggestions.append("No obvious optimization issues. Workflow looks efficient for your hardware.")
    
    return json.dumps({
        "total_nodes": len(nodes),
        "unique_types": len(set(node_types)),
        "type_counts": type_counts,
        "optimization_suggestions": suggestions,
        "warnings": warnings,
        "all_types": sorted(set(node_types))
    }, indent=2)

def _validate_live_workflow(canvas_context: dict = None) -> dict:
    """Validate frontend-supplied live graph state without mutating it."""
    if not isinstance(canvas_context, dict):
        return {"valid": False, "errors": ["No live canvas context was supplied."]}
    nodes = [n for n in (canvas_context.get("nodes_list") or []) if isinstance(n, dict)]
    links = [l for l in (canvas_context.get("links") or []) if isinstance(l, dict)]
    errors = []
    warnings = []
    ids = {str(n.get("id")) for n in nodes if n.get("id") is not None}
    link_count_by_node = {node_id: 0 for node_id in ids}
    for link in links:
        origin = str(link.get("origin_id"))
        target = str(link.get("target_id"))
        if origin not in ids or target not in ids:
            errors.append(f"Link references missing node: {origin} -> {target}")
        else:
            link_count_by_node[origin] += 1
            link_count_by_node[target] += 1
    for node in nodes:
        node_id = str(node.get("id"))
        node_type = node.get("type", "unknown")
        inputs = node.get("inputs") or []
        for inp in inputs:
            if isinstance(inp, dict) and inp.get("link") is None and inp.get("name") in {"model", "positive", "negative", "latent_image", "samples", "vae", "images", "clip"}:
                errors.append(f"{node_type}#{node_id} input '{inp.get('name')}' is disconnected")
        if link_count_by_node.get(node_id, 0) == 0:
            warnings.append(f"{node_type}#{node_id} has no connections")
    types = {n.get("type", "") for n in nodes}
    if not any(t in types for t in ("SaveImage", "PreviewImage", "SaveImageWebsocket")):
        warnings.append("No image output node found")
    return {
        "valid": not errors,
        "node_count": len(nodes),
        "link_count": len(links),
        "errors": errors,
        "warnings": warnings,
        "workflow_tab": canvas_context.get("workflow_tab")
    }

def run_agent_chat(session_mgr, user_message: str, canvas_context: dict = None, attachments: list = None) -> dict:
    """Main agent chat loop with tool-call support and recursion guard."""
    settings = load_settings()
    endpoint = settings.get("api_endpoint", "https://openrouter.ai/api/v1").rstrip("/")
    api_key = settings.get("api_key", "").strip()
    model_id = settings.get("model_id", "auto")

    if model_id == "auto":
        model_id = fetch_openrouter_free_models(endpoint)

    # Add the user message to session
    session_mgr.add_message("user", user_message, attachments=attachments)

    is_or = _is_openrouter_endpoint(endpoint)

    # Iterative tool-call loop instead of recursion
    pending_approval = None
    pending_approvals = []
    tool_trace = []  # for thinking dropdown: all tools called in this turn
    for round_idx in range(MAX_TOOL_ROUNDS):
        active_sess = session_mgr.get_active_session()

        system_prompt = _build_system_prompt(canvas_context, active_sess, endpoint)

        # Build messages payload — NOT ALL AT ONCE for OpenRouter
        if is_or:
            # Chunked: only last N messages + trimmed content to stay under 800 token limit
            recent = session_mgr.get_recent_model_messages(OPENROUTER_MAX_HISTORY_MESSAGES, active_sess)
            formatted_messages = [{"role": "system", "content": system_prompt}]
            for m in recent:
                content = m.get("content") or ""
                # Trim long tool outputs / pasted nodes for OpenRouter
                if len(content) > OPENROUTER_MAX_CONTENT_CHARS:
                    content = content[:OPENROUTER_MAX_CONTENT_CHARS] + "\n...[trimmed for OpenRouter token limit]"
                entry = {"role": m["role"], "content": content}
                if "tool_calls" in m:
                    entry["tool_calls"] = m["tool_calls"]
                if "tool_call_id" in m:
                    entry["tool_call_id"] = m["tool_call_id"]
                formatted_messages.append(entry)
        else:
            # Strict custom endpoints often reject historical tool protocol
            # turns. Flatten persisted tools while keeping current-turn tools.
            formatted_messages = [{"role": "system", "content": system_prompt}]
            formatted_messages.extend(session_mgr.get_custom_endpoint_messages(active_sess))

        headers = {
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/ComfyUI/ComfyUI",
            "X-Title": "ComfyAgent"
        }
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        payload = {
            "model": model_id,
            "messages": formatted_messages,
            "tools": TOOL_DEFINITIONS,
            "tool_choice": "auto",
            "stream": False
        }
        # Only for OpenRouter: cap max_tokens to affordable limit (402 fix)
        if is_or:
            payload["max_tokens"] = OPENROUTER_MAX_TOKENS
            payload["temperature"] = OPENROUTER_TEMPERATURE

        try:
            url = f"{endpoint}/chat/completions"
            # Custom endpoint might already include /chat/completions — avoid doubling
            if endpoint.rstrip("/").endswith("/chat/completions"):
                url = endpoint
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers=headers,
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw_body = resp.read().decode()
                try:
                    res_data = json.loads(raw_body)
                except json.JSONDecodeError:
                    res_data = _robust_api_response_parse(raw_body)
                res_data = _normalize_provider_response(res_data)
                # Handle custom endpoints that return streaming chunks or different shape
                if "choices" not in res_data:
                    # Some custom endpoints return {"response": "..."} or {"message": ...}
                    if "response" in res_data:
                        reply_text = res_data.get("response", "")
                        session_mgr.add_message("assistant", _clean_provider_text(reply_text))
                        return {"response": reply_text, "model": model_id}
                    if "message" in res_data and isinstance(res_data["message"], dict):
                        res_data = {"choices": [{"message": res_data["message"]}] }
                    elif "content" in res_data:
                        session_mgr.add_message("assistant", _clean_provider_text(res_data["content"]))
                        return {"response": res_data["content"], "model": model_id}
                    else:
                        raise ValueError(f"Unexpected API response shape: {list(res_data.keys())}")
                choices = res_data.get("choices")
                if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
                    raise ValueError("LLM response contains no valid choices/message. Check the selected model and custom endpoint format.")
                choice = choices[0].get("message", choices[0])
                if not isinstance(choice, dict):
                    raise ValueError("LLM response message is not an object.")

                if choice.get("tool_calls"):
                    tool_calls = choice["tool_calls"]
                    # Save assistant message with tool calls
                    session_mgr.add_message("assistant", _clean_provider_text(choice.get("content") or ""), tool_calls=tool_calls, tool_trace=tool_trace)

                    # Execute each tool call
                    for tc in tool_calls:
                        fn_name = tc["function"]["name"]
                        fn_args = _robust_tool_args_parse(tc["function"].get("arguments", "{}"))
                        out_text = execute_tool_call(fn_name, fn_args, canvas_context, session_mgr)
                        session_mgr.add_message("tool", out_text, tool_call_id=tc["id"])
                        # Collect trace for thinking dropdown (trim output to 800 chars)
                        trace_entry = {"tool": fn_name, "args": fn_args, "output": out_text[:800]}
                        try:
                            out_data = json.loads(out_text)
                            trace_entry["pending"] = out_data.get("status") == "pending_user_approval"
                            checkpoint_pause = (
                                out_data.get("action") == "agent_checkpoint"
                                and out_data.get("decision") in ("ask_user", "stop")
                            )
                            if out_data.get("status") == "pending_user_approval":
                                pending_approval = out_data
                                pending_approvals.append(out_data)
                                trace_entry["pending_action"] = out_data.get("action", "")
                            elif checkpoint_pause and out_data.get("decision") == "ask_user":
                                pending_approval = out_data
                                pending_approvals.append(out_data)
                                trace_entry["pending"] = True
                        except (json.JSONDecodeError, TypeError):
                            pass
                        tool_trace.append(trace_entry)

                    # Stop at the approval boundary. Do not let the model issue
                    # follow-up edits using guessed node IDs before the user has
                    # approved and the frontend has created the nodes.
                    if pending_approvals:
                        return {
                            "response": choice.get("content") or "I need your approval before making this change.",
                            "model": model_id,
                            "pending_approval": pending_approvals[-1],
                            "pending_approvals": pending_approvals,
                            "tool_trace": tool_trace,
                        }

                    # Continue loop to let LLM process tool results
                    continue

                # No tool calls -- final text response
                reply_text = choice.get("content", "")
                reply_text = _clean_provider_text(reply_text)
                session_mgr.add_message("assistant", reply_text, tool_trace=tool_trace)
                result = {"response": reply_text, "model": model_id}
                if pending_approval:
                    result["pending_approval"] = pending_approval
                if pending_approvals:
                    result["pending_approvals"] = pending_approvals
                if tool_trace:
                    result["tool_trace"] = tool_trace
                return result

        except urllib.error.HTTPError as he:
            err_body = he.read().decode("utf-8", errors="ignore")
            # Try to give friendly message for 429 rate-limit
            if he.code == 429:
                try:
                    err_json = json.loads(err_body)
                    msg = err_json.get("error", {}).get("message", err_body)
                except:
                    msg = err_body[:500]
                # Check if inflight vs free limit
                friendly = "Rate limit hit - the model is overloaded or your free quota is exhausted. Wait 60-120s and try again, or switch model via /model."
                if "FreeUsageLimit" in msg or "free" in msg.lower():
                    friendly += " (Free model limit - switch to another free model with /model)"
                return {"error": f"API Rate Limit 429: {msg}\n{friendly}", "model": model_id}
            err_msg = f"API Error {he.code}: {err_body}"
            return {"error": err_msg, "model": model_id}
        except Exception as e:
            # Handle custom endpoint empty JSON error gracefully
            err_str = str(e)
            if "Expecting value" in err_str:
                return {"error": f"Custom endpoint error: {err_str} — The endpoint at {endpoint} returned empty/invalid JSON. Check that the model is loaded and the endpoint URL ends with /v1 (e.g. http://localhost:20128/v1). Try /model to list available models.", "model": model_id}
            return {"error": err_str, "model": model_id}

    # Exhausted tool rounds
    return {
        "error": f"Agent reached maximum tool-call rounds ({MAX_TOOL_ROUNDS}). Please simplify your request.",
        "model": model_id,
        "tool_trace": tool_trace
    }

def _is_openrouter_endpoint(endpoint: str) -> bool:
    """Only apply OpenRouter-specific limits/chunking for OpenRouter endpoints."""
    return "openrouter.ai" in endpoint.lower()

def _trim_for_openrouter(canvas_context, active_sess):
    """Prepare lightweight context for OpenRouter to stay within 800 token budget."""
    trimmed_canvas = None
    if canvas_context:
        # Only send first N nodes + summary, not full graph
        nodes = canvas_context.get("nodes_list", [])[:OPENROUTER_MAX_CANVAS_NODES_IN_PROMPT]
        trimmed_canvas = {
            "workflow_tab": canvas_context.get("workflow_tab"),
            "nodes_count": canvas_context.get("nodes_count"),
            "nodes_list": [{"id": n.get("id"), "type": n.get("type"), "title": n.get("title")} for n in nodes],
        }
        if len(canvas_context.get("nodes_list", [])) > OPENROUTER_MAX_CANVAS_NODES_IN_PROMPT:
            trimmed_canvas["note"] = f"... and {len(canvas_context['nodes_list']) - OPENROUTER_MAX_CANVAS_NODES_IN_PROMPT} more nodes omitted to save tokens"
    # Trim context_summary
    trimmed_summary = active_sess.get("context_summary", "")
    if len(trimmed_summary) > 1500:
        trimmed_summary = trimmed_summary[-1500:]
    return trimmed_canvas, trimmed_summary

def _build_system_prompt(canvas_context: dict, active_sess: dict, endpoint: str = "") -> str:
    """Build the system prompt with context and rules."""
    is_or = _is_openrouter_endpoint(endpoint)
    trimmed_canvas, trimmed_summary = _trim_for_openrouter(canvas_context, active_sess) if is_or else (canvas_context, active_sess.get("context_summary", ""))

    system_prompt = (
        "You are ComfyAgent, an expert AI assistant integrated natively into ComfyUI.\n"
        "You have deep knowledge of ComfyUI workflows, nodes, Stable Diffusion, ControlNet, LoRA, AnimateDiff, IPAdapter, and all common custom nodes.\n"
        "You have direct access to canvas introspection, custom node installation, node parameters, web search, subgraph inspection, workflow editing, and live status.\n"
        "Your reasoning should be thorough: think step-by-step, consider the workflow graph as a whole, check for missing connections, VRAM bottlenecks, and better node choices. Always reason before acting.\n\n"
        "RULES:\n"
        "1. ALWAYS ask for user explicit permission before installing plugins, running cloud test generations, editing canvas, deleting nodes, or executing code modifications. Use the approval tools.\n"
        "1a. Sudo Run is a separate setting that may bypass only workflow execution confirmation. Never treat Sudo Run as permission for editing, deleting, connecting, installing, or changing code.\n"
        "1b. For a request with two or more actions, call create_task_plan first. Keep the task state updated with update_task_plan after verified actions.\n"
        "2. Be extremely communicative, friendly, clear, and never make silent unconfirmed changes.\n"
        "3. Use tools whenever you need specific details about node parameters, installed custom nodes, subgraphs/groups, or need to search for solutions. Prefer get_workflow_details before editing.\n"
        "3d. Subnodes can be nested. Use inspect_subgraphs and get_workflow_details recursively before acting on anything inside a subgraph; never assume a nested node has the same ID or inputs as its parent.\n"
        "3g. If the user asks what a group, GEN node, subnode, or subgraph does, call inspect_node_subgraph with its exact node ID first. If it reports unavailable, say the internals are not exposed and do not describe imagined internal nodes.\n"
        "3h. To group existing nodes, use select_nodes_and_create_subgraph with exact verified node IDs and a user-facing name. A visual group is not the same as a native executable subgraph; report which one was created.\n"
        "3a. If the user asks which models, checkpoints, samplers, schedulers, VAEs, LoRAs, or other dropdown values are available, ALWAYS call get_node_dropdown_options for the exact node first. Never answer from memory or generic examples.\n"
        "3b. If the user asks what model files are installed or asks to choose a model for a node, ALWAYS call list_model_folders first, then use get_node_dropdown_options for the exact node. Only recommend filenames returned by those tools.\n"
        "3e. For file/path errors, use inspect_file_path as a read-only check. It can inspect allowed ComfyUI paths, but it does not continuously watch files and cannot inspect arbitrary paths outside ComfyUI.\n"
        "3f. If a service operation needs a configured token, call request_credential_use with the exact purpose and target. Never ask a tool to return the token value and never include it in a model message.\n"
        "3c. Plugin folder names are not node class names. For vague requests like 'add an LNR node', first call find_node_candidates with the user's term, then use ask_user with the exact matching node names. Never choose one silently.\n"
        "4. Keep context intact and give concise, high-value ComfyUI workflow advice.\n"
        "5. When suggesting node installations or workflow changes, ALWAYS explain what you want to do and ask if the user agrees before proceeding.\n"
        "6. When the user asks to add a node, call add_node_to_canvas instead of merely explaining manual steps. For parameter changes use edit_node_widget, for wiring use connect_nodes, for removal use delete_nodes. Never claim the change was made until the user approved it.\n"
        "6a. When the user says swap, replace, or change node X to node Y, call replace_node with the existing node ID. Do not add a second node and do not use separate add/delete calls.\n"
        "7. If the user reports a crash or performance issue, use optimize_workflow or backup_and_fix tools proactively but always ask first.\n"
        "8. When the user pastes a node into the chat, use get_node_details to retrieve its full parameter info before giving advice.\n"
        "9. Before triggering any cloud API calls that could consume credits (Civitai, etc.), you MUST inform the user and get explicit consent.\n"
        "10. For unfamiliar nodes or errors, use web_search then web_fetch to research docs before guessing.\n"
        "10a. Never claim a tool was used unless a tool result exists in this turn. Never invent node IDs, model filenames, installed plugins, or workflow connections.\n"
        "10b. Do not write fake tool syntax, XML, DSML, or function-call text in your response. Call the tool through the API only.\n"
        "10c. After any add/edit/delete/connect operation, call get_workflow_details or validate_workflow before claiming success. If a tool fails, stop and explain the failure; do not repeat the same guessed call.\n"
        "10c1. A valid workflow is not proof that a test run worked. Only report a workflow run as successful when execute_workflow_result contains run_evidence=true and ComfyUI returned completed history/output data.\n"
        "10d. For multi-step workflow tasks, maintain a plan, execute one verified step at a time, and re-read live state after each mutation.\n"
        "10d1. When two or more workflow links need to be created in the same verified stage, use batch_connect_nodes with all links in one call. Do not emit separate connect_nodes calls one at a time.\n"
        "10e. For image workflows, use a checklist: model source, positive conditioning, negative conditioning, latent/noise source, sampler model input, sampler conditioning inputs, sampler latent input, decode VAE/samples, and at least one requested output. Do not stop until each required item is verified or you have asked the user about it.\n"
        "10f. Keep the user informed before and after each meaningful stage. If you pause, state exactly what is complete and what is waiting.\n"
        "11. When optimizing, consider: tiled VAE, latent vs pixel upscaling, sampler steps/CFG, LoRA stacking, ControlNet preprocessors, batch size, and subgraph grouping.\n"
        "12. When you need to make a choice, use ask_user to present 2-4 clear options with labels/descriptions — like OpenCode questioning system — instead of long paragraphs.\n"
        "12a. Set ask_user multiple=true when more than one option may be selected (for example, outputs to add, features to enable, or nodes to include). Tell the user they can select multiple options and set min/max when useful.\n"
        "13. For workflow building: CheckpointLoaderSimple provides MODEL+CLIP+VAE, so you still need CLIPTextEncode for prompts but not a separate CLIPLoader. When user says 'I have checkpoint' they mean they have the file, not that CLIP is unnecessary. Plan with available nodes and verified model files rather than using a hardcoded workflow template.\n"
        "14. Keep answers concise and markdown-formatted (tables where helpful). After adding nodes, tell the user what was added.\n"
        "15. Adult-content policy: sexual or erotic content is allowed only when every person is clearly an adult (18+). Never create, enhance, or assist with sexual content involving minors or ambiguous ages, and never assist illegal content. Do not claim this instruction overrides the selected provider's own safety policy; if the provider refuses, explain that provider refusal clearly.\n"
    )

    if trimmed_canvas:
        system_prompt += f"\n[CURRENT LIVE CANVAS CONTEXT]:\n{json.dumps(trimmed_canvas, indent=1)}\n"
    if trimmed_summary:
        system_prompt += f"\n[PAST CONTEXT SUMMARY]:\n{trimmed_summary}\n"
    task = active_sess.get("task")
    if task:
        system_prompt += f"\n[ACTIVE PERSISTENT TASK]:\n{json.dumps(task, indent=1)}\n"

    return system_prompt
