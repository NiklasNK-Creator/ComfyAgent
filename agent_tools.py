import os
import sys
import shutil
import zipfile
import subprocess
import time
import urllib.request
import urllib.parse
import json
import re
try:
    from PIL import Image, PngImagePlugin
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

# Guard for folder_paths -- it only exists inside a running ComfyUI process
try:
    import folder_paths
    _HAS_FOLDER_PATHS = True
except ImportError:
    _HAS_FOLDER_PATHS = False
    print("[ComfyAgent] Warning: folder_paths not available (running outside ComfyUI?).")

def _get_custom_nodes_dir() -> str:
    """Resolve the custom_nodes directory reliably."""
    if _HAS_FOLDER_PATHS:
        try:
            paths = folder_paths.get_folder_paths("custom_nodes")
            if paths:
                return paths[0]
        except Exception:
            pass
    # Fallback: assume this extension sits inside custom_nodes/<our_folder>
    our_dir = os.path.dirname(os.path.abspath(__file__))
    parent = os.path.dirname(our_dir)
    # Verify it actually looks like a custom_nodes dir
    if os.path.basename(parent).lower() == "custom_nodes":
        return parent
    # Last resort: walk up to find custom_nodes
    return parent


class IntrospectionTools:
    @staticmethod
    def get_node_details(node_name: str) -> dict:
        """Retrieve exact details, parameters, inputs, and outputs of a specific node class."""
        try:
            from nodes import NODE_CLASS_MAPPINGS
            if node_name in NODE_CLASS_MAPPINGS:
                node_cls = NODE_CLASS_MAPPINGS[node_name]
                input_info = {}
                if hasattr(node_cls, "INPUT_TYPES"):
                    try:
                        raw = node_cls.INPUT_TYPES()
                        # Ensure it's JSON-serializable
                        input_info = _make_serializable(raw)
                    except Exception as e:
                        input_info = {"error": str(e)}
                
                return {
                    "node_name": node_name,
                    "category": getattr(node_cls, "CATEGORY", "unknown"),
                    "return_types": list(getattr(node_cls, "RETURN_TYPES", [])),
                    "return_names": list(getattr(node_cls, "RETURN_NAMES", [])),
                    "function": getattr(node_cls, "FUNCTION", ""),
                    "description": getattr(node_cls, "DESCRIPTION", "") or (node_cls.__doc__ or ""),
                    "input_types": input_info
                }
            return {"error": f"Node '{node_name}' not found in registered ComfyUI nodes."}
        except Exception as e:
            return {"error": f"Failed to get details for node '{node_name}': {str(e)}"}

    @staticmethod
    def list_all_node_names() -> list:
        """Return a list of all registered node class names."""
        try:
            from nodes import NODE_CLASS_MAPPINGS
            return sorted(NODE_CLASS_MAPPINGS.keys())
        except Exception as e:
            return [f"Error: {str(e)}"]

    @staticmethod
    def find_node_candidates(query: str) -> list:
        """Find exact registered node classes matching a user-facing search term."""
        try:
            from nodes import NODE_CLASS_MAPPINGS
            query_lower = str(query or "").lower().strip()
            results = []
            for name, node_cls in NODE_CLASS_MAPPINGS.items():
                category = str(getattr(node_cls, "CATEGORY", ""))
                display = str(getattr(node_cls, "DISPLAY_NAME", ""))
                searchable = f"{name} {category} {display}".lower()
                if query_lower and query_lower in searchable:
                    results.append({
                        "node_name": name,
                        "display_name": display or name,
                        "category": category,
                    })
            return sorted(results, key=lambda x: (x["category"], x["node_name"]))[:100]
        except Exception as e:
            return [{"error": str(e)}]

    @staticmethod
    def get_node_dropdown_options(node_name: str) -> dict:
        """Return live selectable dropdown values exposed by a node's INPUT_TYPES."""
        try:
            from nodes import NODE_CLASS_MAPPINGS
            node_cls = NODE_CLASS_MAPPINGS.get(node_name)
            if not node_cls:
                return {"error": f"Node '{node_name}' not found."}
            raw = node_cls.INPUT_TYPES() if hasattr(node_cls, "INPUT_TYPES") else {}
            options = {}
            for section, fields in raw.items():
                if not isinstance(fields, dict):
                    continue
                for name, spec in fields.items():
                    values = None
                    if isinstance(spec, (list, tuple)) and spec:
                        # ComfyUI dropdown form: (choices, config_dict)
                        if isinstance(spec[0], (list, tuple)):
                            values = list(spec[0])
                        # ComfyUI dynamic COMBO form: ["COMBO", {options: [...]}]
                        elif len(spec) > 1 and isinstance(spec[1], dict):
                            config = spec[1]
                            values = config.get("options") or config.get("choices")
                            if values is None and isinstance(config.get("values"), (list, tuple)):
                                values = config["values"]
                    elif isinstance(spec, dict):
                        values = spec.get("options") or spec.get("choices")
                    if values is not None:
                        options[name] = {
                            "values": _make_serializable(values),
                            "count": len(values),
                            "current_type": "dropdown"
                        }
            # Include the actual current widget values as a fallback signal.
            return {"node_name": node_name, "dropdowns": options, "source": "live INPUT_TYPES"}
        except Exception as e:
            return {"node_name": node_name, "error": str(e)}

    @staticmethod
    def list_installed_custom_nodes() -> list:
        """List all installed custom node packages in custom_nodes folder."""
        try:
            custom_nodes_dir = _get_custom_nodes_dir()
            if not os.path.exists(custom_nodes_dir):
                return []
            items = []
            for entry in os.listdir(custom_nodes_dir):
                full_path = os.path.join(custom_nodes_dir, entry)
                if os.path.isdir(full_path) and not entry.startswith(".") and not entry.startswith("__"):
                    has_init = os.path.exists(os.path.join(full_path, "__init__.py"))
                    items.append({"name": entry, "has_init": has_init})
            return items
        except Exception as e:
            return [{"error": f"Error scanning custom_nodes: {str(e)}"}]


class ModelFolderTools:
    """Read actual ComfyUI model directories instead of inventing filenames."""
    @staticmethod
    def list_model_folders() -> dict:
        folders = {}
        folder_names = ["checkpoints", "vae", "loras", "controlnet", "upscale_models", "clip", "unet", "diffusion_models", "embeddings", "style_models"]
        for name in folder_names:
            try:
                paths = folder_paths.get_folder_paths(name) if _HAS_FOLDER_PATHS else []
            except Exception:
                paths = []
            if not paths:
                continue
            files = []
            for base in paths:
                if not os.path.isdir(base):
                    continue
                for root, dirs, filenames in os.walk(base):
                    dirs[:] = [d for d in dirs if d != "__pycache__"]
                    for filename in filenames:
                        if filename.lower().endswith((".safetensors", ".ckpt", ".pth", ".pt", ".bin", ".yaml", ".yml")):
                            files.append(os.path.relpath(os.path.join(root, filename), base))
            folders[name] = sorted(set(files))[:500]
        return {"folders": folders, "folder_count": len(folders)}

class FileInspectionTools:
    """Read-only path inspection with traversal protection."""
    @staticmethod
    def inspect_path(path: str, recursive: bool = False, max_items: int = 100) -> dict:
        try:
            candidate = os.path.abspath(os.path.expanduser(str(path or "")))
            allowed_roots = []
            custom = _get_custom_nodes_dir()
            allowed_roots.extend([custom, os.path.dirname(custom)])
            if _HAS_FOLDER_PATHS:
                for name in ("checkpoints", "vae", "loras", "controlnet", "upscale_models", "clip", "unet", "diffusion_models"):
                    try: allowed_roots.extend(folder_paths.get_folder_paths(name) or [])
                    except Exception: pass
            allowed_roots = [os.path.abspath(root) for root in allowed_roots if root]
            if not any(os.path.commonpath([candidate, root]) == root for root in allowed_roots):
                return {"error": "Path is outside allowed ComfyUI/custom-node/model directories.", "path": candidate}
            if not os.path.exists(candidate):
                return {"exists": False, "path": candidate}
            result = {"exists": True, "path": candidate, "is_file": os.path.isfile(candidate), "is_directory": os.path.isdir(candidate)}
            if os.path.isfile(candidate):
                result["size"] = os.path.getsize(candidate)
                result["extension"] = os.path.splitext(candidate)[1]
                return result
            entries = []
            walker = os.walk(candidate) if recursive else [(candidate, [], os.listdir(candidate))]
            for root, dirs, files in walker:
                dirs[:] = [d for d in dirs if d not in ("__pycache__", ".git", "node_modules")]
                for name in dirs + files:
                    item = os.path.join(root, name)
                    entries.append({"path": item, "name": name, "is_file": os.path.isfile(item), "size": os.path.getsize(item) if os.path.isfile(item) else None})
                    if len(entries) >= max_items: break
                if len(entries) >= max_items: break
            result["items"] = entries
            result["truncated"] = len(entries) >= max_items
            return result
        except Exception as e:
            return {"error": str(e), "path": path}

class ImageMetadataTools:
    """Add truthful, idempotent metadata to images produced by a workflow."""
    @staticmethod
    def annotate_recent_outputs(prompt_id=None, workflow_nodes=None, max_files=100) -> dict:
        try:
            if not HAS_PIL:
                return {"annotated": [], "skipped": [], "error": "Pillow not installed."}
            if not _HAS_FOLDER_PATHS:
                return {"annotated": [], "skipped": [], "error": "ComfyUI folder_paths is unavailable."}
            output_dir = folder_paths.get_output_directory()
            nodes = workflow_nodes or []
            node_types = [str(n.get("type", "")) for n in nodes if isinstance(n, dict)]
            civitai_used = any("civitai" in node_type.lower() for node_type in node_types)
            if not civitai_used:
                return {"annotated": [], "skipped": [], "reason": "No Civitai-related node was present in the executed workflow."}
            import settings_manager
            settings = settings_manager.load_settings()
            if not settings.get("annotate_civitai_images", True):
                return {"annotated": [], "skipped": [], "reason": "Civitai image annotation is disabled in settings."}
            air_id = settings.get("civitai_air_id", "").strip()
            if not air_id:
                return {"annotated": [], "skipped": [], "reason": "No Civitai AIR identifier configured."}
            candidates = []
            for root, dirs, files in os.walk(output_dir):
                dirs[:] = [d for d in dirs if d not in ("__pycache__",)]
                for filename in files:
                    if filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                        full = os.path.join(root, filename)
                        candidates.append(full)
            candidates.sort(key=lambda p: os.path.getmtime(p), reverse=True)
            annotated = []
            skipped = []
            for path in candidates[:max_files]:
                try:
                    if prompt_id and os.path.getmtime(path) < time.time() - 86400:
                        skipped.append({"path": path, "reason": "older than recent run window"})
                        continue
                    if os.path.getsize(path) > 100 * 1024 * 1024:
                        skipped.append({"path": path, "reason": "file too large"})
                        continue
                    backup_path = path + ".comfyagent.bak"
                    shutil.copy2(path, backup_path)
                    with Image.open(path) as source:
                        image = source.copy()
                        existing = dict(source.info)
                        existing["civitai_air"] = air_id
                        existing["comfyagent_civitai"] = "true"
                        if path.lower().endswith(".png"):
                            metadata = PngImagePlugin.PngInfo()
                            for key, value in existing.items():
                                if isinstance(value, str):
                                    metadata.add_text(str(key), value)
                            image.save(path, pnginfo=metadata)
                        elif path.lower().endswith((".jpg", ".jpeg")):
                            save_kwargs = {"quality": 95}
                            for key in ("exif", "icc_profile", "dpi", "comment"):
                                if key in existing:
                                    save_kwargs[key] = existing[key]
                            image.save(path, **save_kwargs)
                        else:
                            save_kwargs = {}
                            for key in ("exif", "icc_profile", "xmp"):
                                if key in existing:
                                    save_kwargs[key] = existing[key]
                            image.save(path, **save_kwargs)
                    try:
                        os.remove(backup_path)
                    except OSError:
                        pass
                    annotated.append({"path": path, "civitai_air": air_id})
                except Exception as e:
                    try:
                        if os.path.exists(path + ".comfyagent.bak"):
                            shutil.copy2(path + ".comfyagent.bak", path)
                            os.remove(path + ".comfyagent.bak")
                    except OSError:
                        pass
                    skipped.append({"path": path, "reason": str(e)})
            return {"annotated": annotated, "skipped": skipped, "civitai_air": air_id, "prompt_id": prompt_id}
        except Exception as e:
            return {"annotated": [], "skipped": [], "error": str(e)}

class WebResearchTools:
    @staticmethod
    def search_web_and_custom_nodes(query: str) -> dict:
        """Search ComfyUI Manager registry for custom nodes matching query + general web."""
        manager_results = []
        try:
            url = "https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/custom-node-list.json"
            req = urllib.request.Request(url, headers={"User-Agent": "ComfyAgent/1.0"})
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read().decode())
                nodes = data if isinstance(data, list) else data.get("custom_nodes", [])
                if isinstance(nodes, dict):
                    nodes = [nodes]
                q_lower = query.lower()
                matched = []
                for n in nodes:
                    if not isinstance(n, dict):
                        continue
                    title = n.get("title", "")
                    desc = n.get("description", "")
                    nodename = n.get("nodename_pattern", "")
                    searchable = f"{title} {desc} {nodename}".lower()
                    keywords = q_lower.split()
                    hits = sum(1 for kw in keywords if kw in searchable)
                    if hits > 0:
                        matched.append({
                            "title": title,
                            "author": n.get("author", ""),
                            "description": desc[:200],
                            "files": n.get("files", []),
                            "install_type": n.get("install_type", ""),
                            "relevance": hits
                        })
                matched.sort(key=lambda x: x["relevance"], reverse=True)
                manager_results = matched[:8]
        except Exception as e:
            manager_results = [{"error": str(e)}]

        # Also do general web search
        web_results = WebResearchTools.search_general_web(query)
        return {
            "query": query,
            "manager_results_count": len([r for r in manager_results if "error" not in r]),
            "manager_results": manager_results,
            "web_results": web_results.get("results", [])[:5],
            "web_error": web_results.get("error")
        }

    @staticmethod
    def search_general_web(query: str, max_results: int = 5) -> dict:
        """General web search via DuckDuckGo HTML (no API key needed)."""
        try:
            # DuckDuckGo HTML endpoint
            ddg_url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(query)}"
            req = urllib.request.Request(ddg_url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ComfyAgent/1.0",
                "Accept": "text/html"
            })
            with urllib.request.urlopen(req, timeout=10) as resp:
                html = resp.read().decode("utf-8", errors="ignore")
            # Parse DuckDuckGo HTML results: look for result__url and result__snippet
            results = []
            # Regex for DDG HTML structure
            pattern = re.compile(
                r'class="result__url"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?class="result__snippet"[^>]*>(.*?)</',
                re.DOTALL
            )
            for m in pattern.finditer(html):
                href = m.group(1)
                title_raw = re.sub(r'<[^>]+>', '', m.group(2)).strip()
                snippet_raw = re.sub(r'<[^>]+>', '', m.group(3)).strip()
                # DDG wraps redirects as //duckduckgo.com/l/?uddg=<url>
                if "uddg=" in href:
                    href = urllib.parse.unquote(href.split("uddg=")[-1].split("&")[0])
                href = href.replace("&amp;", "&")
                if href and title_raw:
                    results.append({"title": title_raw[:120], "url": href, "snippet": snippet_raw[:300]})
                    if len(results) >= max_results:
                        break
            # Fallback: try simpler anchor parsing if above found nothing
            if not results:
                alt_pat = re.compile(r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.DOTALL)
                for m in alt_pat.finditer(html):
                    href = m.group(1)
                    title_raw = re.sub(r'<[^>]+>', '', m.group(2)).strip()
                    if "uddg=" in href:
                        href = urllib.parse.unquote(href.split("uddg=")[-1].split("&")[0])
                    if href.startswith("/") or "duckduckgo" in href:
                        continue
                    results.append({"title": title_raw[:120], "url": href, "snippet": ""})
                    if len(results) >= max_results:
                        break
            return {"query": query, "results": results}
        except Exception as e:
            return {"query": query, "error": str(e), "results": []}

    @staticmethod
    def fetch_url_content(url: str, max_chars: int = 8000) -> dict:
        """Fetch URL and return cleaned text content."""
        try:
            if not url.startswith("http://") and not url.startswith("https://"):
                return {"error": "URL must start with http:// or https://", "url": url}
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ComfyAgent/1.0",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            })
            with urllib.request.urlopen(req, timeout=12) as resp:
                content_type = resp.headers.get("Content-Type", "")
                raw = resp.read().decode("utf-8", errors="ignore")
            # If JSON, return truncated
            if "application/json" in content_type:
                return {"url": url, "content_type": content_type, "text": raw[:max_chars]}
            # Strip HTML tags, scripts, styles
            # Remove script/style blocks
            cleaned = re.sub(r'<script[^>]*>.*?</script>', '', raw, flags=re.DOTALL | re.IGNORECASE)
            cleaned = re.sub(r'<style[^>]*>.*?</style>', '', cleaned, flags=re.DOTALL | re.IGNORECASE)
            # Replace block elements with newlines
            cleaned = re.sub(r'</(p|div|h[1-6]|br|li|tr)[^>]*>', '\n', cleaned, flags=re.IGNORECASE)
            # Remove all tags
            cleaned = re.sub(r'<[^>]+>', '', cleaned)
            # Decode HTML entities
            import html as html_lib
            cleaned = html_lib.unescape(cleaned)
            # Collapse whitespace
            cleaned = re.sub(r'[ \t]+', ' ', cleaned)
            cleaned = re.sub(r'\n\s*\n', '\n\n', cleaned)
            cleaned = cleaned.strip()
            if len(cleaned) > max_chars:
                cleaned = cleaned[:max_chars] + "\n...[truncated]"
            return {"url": url, "text": cleaned, "chars": len(cleaned)}
        except Exception as e:
            return {"url": url, "error": str(e)}


class CustomNodeInstaller:
    @staticmethod
    def install_via_github(github_url: str) -> dict:
        """Clone git repo into custom_nodes directory."""
        # Validate URL
        if not github_url.startswith("https://github.com/"):
            return {"status": "error", "message": "Only https://github.com/ URLs are allowed for security."}
        try:
            custom_nodes_dir = _get_custom_nodes_dir()
            repo_name = github_url.rstrip("/").split("/")[-1].replace(".git", "")
            target_dir = os.path.join(custom_nodes_dir, repo_name)
            if os.path.exists(target_dir):
                return {"status": "exists", "message": f"Folder '{repo_name}' already exists at {target_dir}."}
            
            cmd = ["git", "clone", "--depth", "1", github_url, target_dir]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if res.returncode == 0:
                # Install requirements if present
                req_file = os.path.join(target_dir, "requirements.txt")
                pip_output = ""
                if os.path.exists(req_file):
                    pip_res = subprocess.run(
                        [sys.executable, "-m", "pip", "install", "-r", req_file],
                        capture_output=True, text=True, timeout=300
                    )
                    pip_output = pip_res.stdout[-200:] if pip_res.stdout else ""
                return {
                    "status": "success",
                    "message": f"Successfully cloned '{repo_name}'. A server restart is required to load the new nodes.",
                    "pip_output": pip_output
                }
            else:
                return {"status": "error", "message": f"Git clone failed: {res.stderr[:500]}"}
        except subprocess.TimeoutExpired:
            return {"status": "error", "message": "Clone timed out after 120 seconds."}
        except Exception as e:
            return {"status": "error", "message": str(e)}


class OptimizationAndFixTools:
    @staticmethod
    def backup_custom_nodes() -> str:
        """Creates a zip backup of custom_nodes before applying fixes."""
        try:
            custom_nodes_dir = _get_custom_nodes_dir()
            # Put backups alongside custom_nodes, not inside it
            backup_dir = os.path.join(os.path.dirname(custom_nodes_dir), "comfyagent_backups")
            os.makedirs(backup_dir, exist_ok=True)
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            backup_path = os.path.join(backup_dir, f"custom_nodes_backup_{timestamp}.zip")
            
            with zipfile.ZipFile(backup_path, "w", zipfile.ZIP_DEFLATED) as ziph:
                for root, dirs, files in os.walk(custom_nodes_dir):
                    # Skip heavy/irrelevant directories
                    dirs[:] = [d for d in dirs if d not in ("__pycache__", ".git", "node_modules", ".venv")]
                    for file in files:
                        filepath = os.path.join(root, file)
                        arcname = os.path.relpath(filepath, custom_nodes_dir)
                        try:
                            ziph.write(filepath, arcname)
                        except (PermissionError, OSError):
                            pass  # Skip locked files
            return backup_path
        except Exception as e:
            return f"Backup failed: {str(e)}"

    @staticmethod
    def inspect_and_fix_custom_node(folder_name: str) -> dict:
        """Scan a target custom node folder for known crash bugs, missing imports, or optimization issues."""
        try:
            custom_nodes_dir = _get_custom_nodes_dir()
            target_path = os.path.join(custom_nodes_dir, folder_name)
            if not os.path.exists(target_path):
                return {"error": f"Folder '{folder_name}' not found in custom_nodes."}
            
            py_files = []
            for root, dirs, files in os.walk(target_path):
                dirs[:] = [d for d in dirs if d not in ("__pycache__", ".git")]
                for f in files:
                    if f.endswith(".py"):
                        py_files.append(os.path.join(root, f))
            
            issues_found = []
            for py_file in py_files:
                try:
                    with open(py_file, "r", encoding="utf-8", errors="ignore") as pf:
                        content = pf.read()
                        fname = os.path.relpath(py_file, target_path)
                        
                        # VRAM leak: CUDA cache clear without GC
                        if "torch.cuda.empty_cache()" in content and "gc.collect()" not in content:
                            issues_found.append({
                                "file": fname,
                                "severity": "warning",
                                "issue": "torch.cuda.empty_cache() called without gc.collect() -- may cause VRAM leak."
                            })
                        
                        # OpenCV dependency check
                        if "import cv2" in content or "from cv2" in content:
                            issues_found.append({
                                "file": fname,
                                "severity": "info",
                                "issue": "Uses OpenCV (cv2). Ensure opencv-python or opencv-python-headless is installed."
                            })
                        
                        # Deprecated ComfyUI API usage
                        if "comfy.samplers.KSampler" in content:
                            issues_found.append({
                                "file": fname,
                                "severity": "warning",
                                "issue": "Uses potentially deprecated comfy.samplers.KSampler import path."
                            })
                        
                        # Global mutable state (common bug pattern)
                        if re.search(r"^[A-Z_]+\s*=\s*\[\]", content, re.MULTILINE):
                            issues_found.append({
                                "file": fname,
                                "severity": "info",
                                "issue": "Module-level mutable list found. Could cause state leaks between calls."
                            })
                        
                        # Missing error handling on model loading
                        if "load_state_dict" in content and "try" not in content:
                            issues_found.append({
                                "file": fname,
                                "severity": "warning",
                                "issue": "load_state_dict called without try/except. Missing model files will crash ComfyUI."
                            })
                        
                        # Syntax check
                        try:
                            compile(content, py_file, "exec")
                        except SyntaxError as se:
                            issues_found.append({
                                "file": fname,
                                "severity": "error",
                                "issue": f"Python syntax error at line {se.lineno}: {se.msg}"
                            })
                except Exception:
                    pass
            
            # Check for requirements.txt
            has_requirements = os.path.exists(os.path.join(target_path, "requirements.txt"))
            
            return {
                "folder": folder_name,
                "py_file_count": len(py_files),
                "has_requirements_txt": has_requirements,
                "issues_found": issues_found,
                "issues_count": len(issues_found)
            }
        except Exception as e:
            return {"error": str(e)}

class CanvasIntrospectionTools:
    @staticmethod
    def inspect_node_subgraph(node_id, canvas_context=None) -> dict:
        """Inspect one outer node and any nested graph data supplied by frontend."""
        if not isinstance(canvas_context, dict):
            return {"node_id": str(node_id), "available": False, "error": "No live canvas context supplied."}
        nodes = canvas_context.get("nodes_list") or []
        outer = next((n for n in nodes if isinstance(n, dict) and str(n.get("id")) == str(node_id)), None)
        if not outer:
            return {"node_id": str(node_id), "available": False, "error": "Outer node was not found in the active canvas."}
        nested = []
        for key in ("subgraph", "subgraphs", "graph", "graphs", "workflow", "workflows", "nested_graph", "nested_graphs"):
            value = outer.get(key)
            if value is not None:
                nested.extend(CanvasIntrospectionTools._walk_nested_graph(value, f"node:{node_id}.{key}"))
        # Match nested graph records that frontend tagged with owner ID.
        for graph in canvas_context.get("nested_graphs", []) or []:
            if isinstance(graph, dict) and str(graph.get("owner_id")) == str(node_id):
                nested.append(graph)
        if not nested:
            return {
                "node_id": str(node_id),
                "outer_node": outer,
                "available": False,
                "message": "This ComfyUI build did not expose the internal subgraph through the frontend context. Do not infer its internal nodes; inspect the group by opening it in ComfyUI or export its workflow."
            }
        return {"node_id": str(node_id), "outer_node": outer, "available": True, "nested_graphs": nested}

    @staticmethod
    def _walk_nested_graph(value, path="root", depth=0, found=None):
        """Recursively inspect common nested graph/subgraph shapes."""
        if found is None:
            found = []
        if depth > 8 or value is None:
            return found
        if isinstance(value, dict):
            nodes = value.get("nodes")
            if isinstance(nodes, list):
                found.append({
                    "path": path,
                    "depth": depth,
                    "node_count": len(nodes),
                    "nodes": _make_serializable(nodes),
                    "links": _make_serializable(value.get("links", [])),
                    "groups": _make_serializable(value.get("groups", [])),
                })
            for key, child in value.items():
                if key.lower() in {"subgraph", "subgraphs", "graph", "graphs", "workflow", "workflows", "node_defs", "children"}:
                    CanvasIntrospectionTools._walk_nested_graph(child, f"{path}.{key}", depth + 1, found)
                elif isinstance(child, (dict, list)) and "subgraph" in str(key).lower():
                    CanvasIntrospectionTools._walk_nested_graph(child, f"{path}.{key}", depth + 1, found)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                CanvasIntrospectionTools._walk_nested_graph(child, f"{path}[{index}]", depth + 1, found)
        return found

    @staticmethod
    def get_detailed_workflow_info(canvas_context: dict = None) -> dict:
        """Provide detailed workflow info including links, groups, subgraphs."""
        try:
            from nodes import NODE_CLASS_MAPPINGS
            info = {
                "total_registered_node_types": len(NODE_CLASS_MAPPINGS),
                "categories": sorted(set(getattr(cls, "CATEGORY", "unknown") for cls in NODE_CLASS_MAPPINGS.values())),
            }
            if canvas_context:
                info["active_workflow"] = canvas_context
                nodes = canvas_context.get("nodes_list", []) or []
                info["node_types_in_workflow"] = list(set(n.get("type", "") for n in nodes))
                # Links if provided by frontend deeper context
                if "links" in canvas_context:
                    info["links"] = canvas_context["links"][:50]
                if "groups" in canvas_context:
                    info["groups"] = canvas_context["groups"]
                if "subgraphs" in canvas_context:
                    info["subgraphs"] = canvas_context["subgraphs"]
                info["nested_graphs"] = CanvasIntrospectionTools._walk_nested_graph(canvas_context)
            return info
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def list_subgraphs(canvas_context: dict = None) -> dict:
        """List subgraph/group info from canvas context."""
        if not canvas_context:
            return {"subgraphs": [], "groups": [], "note": "No canvas context provided. Frontend will supply subgraph details."}
        nested = CanvasIntrospectionTools._walk_nested_graph(canvas_context)
        return {
            "subgraphs": canvas_context.get("subgraphs", []),
            "groups": canvas_context.get("groups", []),
            "nodes_with_subgraph_flag": [n for n in canvas_context.get("nodes_list", []) if isinstance(n, dict) and ("subgraph" in n.get("type", "").lower() or (n.get("flags") or {}).get("subgraph"))],
            "nested_graphs": nested,
            "nested_graph_count": len(nested)
        }


    @staticmethod
    def trigger_backend_restart():
        """Triggers ComfyUI server restart gracefully."""
        print("[ComfyAgent] Triggering graceful server restart...")
        try:
            # Flush any pending file writes
            sys.stdout.flush()
            sys.stderr.flush()
            # Use sys.exit for clean shutdown with atexit handlers
            sys.exit(0)
        except SystemExit:
            # If sys.exit is caught by something, fall back to os._exit
            os._exit(0)


def _make_serializable(obj):
    """Convert non-serializable objects to strings for JSON output."""
    if isinstance(obj, dict):
        return {k: _make_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [_make_serializable(i) for i in obj]
    elif isinstance(obj, (str, int, float, bool, type(None))):
        return obj
    else:
        return str(obj)
