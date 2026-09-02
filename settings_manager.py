import os
import json
import base64
import sys

# Optional encryption using cryptography module if available, otherwise simple encoding fallback
try:
    from cryptography.fernet import Fernet
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False

SETTINGS_FILE = os.path.join(os.path.dirname(__file__), "settings.json")
KEY_FILE = os.path.join(os.path.dirname(__file__), ".secret.key")

def _get_or_create_key():
    if not os.path.exists(KEY_FILE):
        if HAS_CRYPTO:
            key = Fernet.generate_key()
            with open(KEY_FILE, "wb") as f:
                f.write(key)
            return key
        else:
            key = base64.urlsafe_b64encode(os.urandom(32))
            with open(KEY_FILE, "wb") as f:
                f.write(key)
            return key
    with open(KEY_FILE, "rb") as f:
        return f.read().strip()

def _encrypt_val(val: str) -> str:
    if not val:
        return ""
    key = _get_or_create_key()
    if HAS_CRYPTO:
        f = Fernet(key)
        return f.encrypt(val.encode('utf-8')).decode('utf-8')
    else:
        return "ENC_" + base64.b64encode(val.encode('utf-8')).decode('utf-8')

def _decrypt_val(val: str) -> str:
    if not val:
        return ""
    if val.startswith("ENC_"):
        try:
            return base64.b64decode(val[4:].encode('utf-8')).decode('utf-8')
        except Exception:
            return val
    key = _get_or_create_key()
    if HAS_CRYPTO:
        try:
            f = Fernet(key)
            return f.decrypt(val.encode('utf-8')).decode('utf-8')
        except Exception:
            return val
    return val

def load_settings() -> dict:
    defaults = {
        "api_endpoint": "https://openrouter.ai/api/v1",
        "api_key": "",
        "model_id": "auto", # auto picks best free model
        "civitai_key": "",
        "github_token": "",
        "yolo_mode": False,
        "sudo_run": False,
        "skip_session_delete_approval": False,
        "civitai_air_id": "urn:air:other:unknown:civitai:2909387@3290648",
        "annotate_civitai_images": True
    }
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                for k, v in data.items():
                    if k.endswith("_key") or k == "github_token":
                        defaults[k] = _decrypt_val(v)
                    else:
                        defaults[k] = v
        except Exception as e:
            print(f"[ComfyAgent] Error loading settings: {e}")
    return defaults

def save_settings(settings: dict):
    to_save = {}
    for k, v in settings.items():
        if k.endswith("_key") or k == "github_token":
            to_save[k] = _encrypt_val(v)
        else:
            to_save[k] = v
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(to_save, f, indent=2)
