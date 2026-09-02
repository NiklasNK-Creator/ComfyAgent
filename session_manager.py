import os
import json
import uuid
import time
import re

SESSIONS_FILE = os.path.join(os.path.dirname(__file__), "sessions.json")

class SessionManager:
    def __init__(self):
        self.sessions = {}
        self.active_session_id = None
        self.credential_grants = {}
        self.load_sessions()

    def load_sessions(self):
        if os.path.exists(SESSIONS_FILE):
            try:
                with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.sessions = data.get("sessions", {})
                    self.active_session_id = data.get("active_session_id", None)
                    self._sanitize_loaded_messages()
            except Exception as e:
                print(f"[ComfyAgent] Failed to load sessions: {e}")
                self.sessions = {}
                self.active_session_id = None

    def _sanitize_loaded_messages(self):
        """Clean provider control markers from old persisted assistant messages."""
        for session in self.sessions.values():
            for message in session.get("messages", []):
                if message.get("role") == "assistant" and isinstance(message.get("content"), str):
                    content = message["content"]
                    content = re.sub(r"<\s*[|｜].{0,200}?(?:DSML|function_calls?|tool_calls?).{0,200}?(?:[|｜>]|$)", "", content, flags=re.IGNORECASE)
                    content = re.sub(r"\b(?:function_calls?|tool_calls?)\b", "", content, flags=re.IGNORECASE)
                    message["content"] = re.sub(r"\n\s*\n\s*\n+", "\n\n", content).strip()

        if not self.sessions or not self.active_session_id or self.active_session_id not in self.sessions:
            self.create_session("Default Session")

    def save_sessions(self):
        try:
            with open(SESSIONS_FILE, "w", encoding="utf-8") as f:
                json.dump({
                    "sessions": self.sessions,
                    "active_session_id": self.active_session_id
                }, f, indent=2)
        except Exception as e:
            print(f"[ComfyAgent] Failed to save sessions: {e}")

    def create_session(self, name: str = None) -> str:
        session_id = str(uuid.uuid4())[:8]
        if not name:
            name = f"Session {len(self.sessions) + 1}"
        self.sessions[session_id] = {
            "id": session_id,
            "name": name,
            "created_at": time.time(),
            "messages": [],
            "context_summary": "",
            "task": None
        }
        self.active_session_id = session_id
        self.save_sessions()
        return session_id

    def list_sessions(self) -> list:
        res = []
        for sid, sess in self.sessions.items():
            res.append({
                "id": sid,
                "name": sess["name"],
                "active": sid == self.active_session_id,
                "msg_count": len(sess["messages"])
            })
        return res

    def switch_session(self, session_id: str) -> bool:
        if session_id in self.sessions:
            self.active_session_id = session_id
            self.save_sessions()
            return True
        return False

    def delete_session(self, session_id: str) -> bool:
        if session_id in self.sessions:
            del self.sessions[session_id]
            if self.active_session_id == session_id:
                if self.sessions:
                    self.active_session_id = list(self.sessions.keys())[0]
                else:
                    self.create_session("Default Session")
            self.save_sessions()
            return True
        return False

    def get_active_session(self) -> dict:
        if not self.active_session_id or self.active_session_id not in self.sessions:
            self.create_session("Default Session")
        return self.sessions[self.active_session_id]

    def get_model_messages(self, session=None):
        """Return provider-valid history, dropping orphaned tool responses."""
        session = session or self.get_active_session()
        messages = session.get("messages", [])
        result = []
        index = 0
        while index < len(messages):
            message = messages[index]
            role = message.get("role")
            if role == "assistant" and message.get("tool_calls"):
                calls = message.get("tool_calls") or []
                call_ids = {call.get("id") for call in calls if isinstance(call, dict) and call.get("id")}
                following = []
                cursor = index + 1
                while cursor < len(messages) and messages[cursor].get("role") == "tool":
                    tool_message = messages[cursor]
                    if tool_message.get("tool_call_id") in call_ids:
                        following.append(tool_message)
                    cursor += 1
                # OpenAI-compatible APIs require one response for every call.
                # Drop incomplete groups rather than sending invalid history.
                if call_ids and {m.get("tool_call_id") for m in following} >= call_ids:
                    result.append(message)
                    result.extend(following)
                index = cursor
                continue
            elif role == "tool":
                # Orphan tool messages are never valid at the top level.
                index += 1
                continue
            elif role in ("user", "assistant", "system"):
                result.append(message)
            index += 1
        # A suffix used for context windows must never start with a tool result.
        # Drop leading tool messages after any prior trimming/corruption.
        while result and result[0].get("role") == "tool":
            result.pop(0)
        # Also remove a trailing assistant tool-call group that has no complete
        # tool responses. Providers reject incomplete function-call turns.
        if result and result[-1].get("role") == "assistant" and result[-1].get("tool_calls"):
            result.pop()
        return result

    def get_recent_model_messages(self, limit=12, session=None):
        """Return a recent provider-valid suffix beginning at a safe boundary."""
        messages = self.get_model_messages(session)
        if len(messages) <= limit:
            return messages
        start = len(messages) - limit
        # Never start on a tool response or assistant tool-call message.
        while start > 0 and messages[start].get("role") == "tool":
            start -= 1
        while start > 0 and messages[start].get("role") == "assistant" and messages[start].get("tool_calls"):
            start -= 1
        return messages[start:]

    def get_custom_endpoint_messages(self, session=None):
        """Flatten tool protocol history for strict local providers.

        Tools still run live in the current request; persisted prior tool calls
        are represented as ordinary assistant context so providers that reject
        OpenAI function-turn ordering do not crash on restored sessions.
        """
        result = []
        for message in self.get_model_messages(session):
            role = message.get("role")
            if role == "tool":
                result.append({
                    "role": "assistant",
                    "content": "[Previous tool result]\n" + str(message.get("content", ""))[:6000]
                })
            elif role == "assistant" and message.get("tool_calls"):
                calls = []
                for call in message.get("tool_calls", []):
                    fn = call.get("function", {}) if isinstance(call, dict) else {}
                    calls.append(fn.get("name", "tool"))
                content = message.get("content") or "[Previous tool call: " + ", ".join(calls) + "]"
                result.append({"role": "assistant", "content": content})
            else:
                result.append({"role": role, "content": message.get("content") or ""})
        return result

    def set_task(self, task: dict):
        session = self.get_active_session()
        session["task"] = task
        self.save_sessions()

    def get_task(self):
        return self.get_active_session().get("task")

    def update_task(self, updates: dict):
        session = self.get_active_session()
        task = session.setdefault("task", {})
        task.update(updates)
        self.save_sessions()
        return task

    def grant_credential(self, credential: str, purpose: str, target: str):
        """Store only a scoped ephemeral grant; never store or return the secret."""
        self.credential_grants[credential] = {
            "purpose": purpose,
            "target": target,
            "granted_at": time.time()
        }

    def has_credential_grant(self, credential: str) -> bool:
        return credential in self.credential_grants

    def add_message(self, role: str, content: str, tool_calls=None, tool_call_id=None, tool_trace=None, attachments=None):
        sess = self.get_active_session()
        msg = {
            "role": role,
            "content": content,
            "timestamp": time.time(),
            "id": str(uuid.uuid4())[:8]
        }
        if tool_calls:
            msg["tool_calls"] = tool_calls
        if tool_call_id:
            msg["tool_call_id"] = tool_call_id
        if tool_trace:
            msg["tool_trace"] = tool_trace
        if attachments:
            msg["attachments"] = attachments
        sess["messages"].append(msg)
        self._check_context_limit(sess)
        self.save_sessions()
        return msg["id"]

    def revert_to_message(self, msg_id: str) -> bool:
        """Truncate history *before* msg_id — reverts chat context only, does NOT touch canvas nodes.
        Clicking revert on a message removes that message and everything after it, so you can retry."""
        sess = self.get_active_session()
        idx = next((i for i, m in enumerate(sess["messages"]) if m.get("id") == msg_id), None)
        if idx is None:
            return False
        # Keep only messages BEFORE the target (exclusive) — more intuitive for retry
        sess["messages"] = sess["messages"][:idx]
        self.save_sessions()
        return True

    def revert_last(self, count: int = 1) -> bool:
        sess = self.get_active_session()
        if len(sess["messages"]) >= count:
            sess["messages"] = sess["messages"][:-count]
            self.save_sessions()
            return True
        return False

    def _check_context_limit(self, sess: dict):
        # Prevent context window overflow by summarizing older messages if count > 30
        if len(sess["messages"]) > 35:
            older = sess["messages"][:-15]
            summary_items = []
            for m in older:
                if m.get("content"):
                    summary_items.append(f"{m['role']}: {m['content'][:150]}")
            sess["context_summary"] += "\n" + "\n".join(summary_items)
            # Keep summary concise
            if len(sess["context_summary"]) > 2000:
                sess["context_summary"] = sess["context_summary"][-2000:]
            sess["messages"] = sess["messages"][-15:]

session_mgr = SessionManager()
