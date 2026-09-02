import os
import sys

# Add project root to sys.path
sys.path.insert(0, os.path.dirname(__file__))

import api_routes
from settings_manager import load_settings
from session_manager import session_mgr

class ComfyAgentExtensionNode:
    """Dummy ComfyUI node entry to register extension cleanly in ComfyUI."""
    @classmethod
    def INPUT_TYPES(s):
        return {"required": {}}
    
    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "ComfyAgent"

    def noop(self):
        return ()

NODE_CLASS_MAPPINGS = {
    "ComfyAgentAssistant": ComfyAgentExtensionNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ComfyAgentAssistant": "🤖 ComfyAgent AI Assistant"
}

# ComfyUI serves frontend files from this directory relative to the extension.
WEB_DIRECTORY = "js"

print("[ComfyAgent] Extension loaded successfully!")
