"""Refresh public artifact sizes and local LM Studio model capabilities.

Usage: python3 docs/research/verify-local-agent-b-models.py
Reads metadata only. Does not download weights, load models, or read credentials.
"""

import json
import urllib.request


REPOSITORIES = (
    "lmstudio-community/Qwen3.8-27B-MLX-8bit",
    "lmstudio-community/Qwen3.8-27B-MLX-6bit",
    "lmstudio-community/Qwen3-Coder-Next-MLX-6bit",
)


def read_json(url):
    with urllib.request.urlopen(url, timeout=20) as response:
        return json.load(response)


def main():
    report = {"artifacts": [], "local_models": [], "errors": []}
    for repository in REPOSITORIES:
        try:
            data = read_json(f"https://huggingface.co/api/models/{repository}?blobs=true")
            files = data["siblings"]
            if not files or any(not isinstance(item.get("size"), int) for item in files):
                raise ValueError("Repository metadata lacks file sizes")
            report["artifacts"].append({
                "repository": repository,
                "revision": data["sha"],
                "total_file_bytes": sum(item["size"] for item in files),
                "weights_bytes": sum(item["size"] for item in files
                                     if item["rfilename"].endswith(".safetensors")),
            })
        except Exception as error:
            report["errors"].append({"source": repository, "error": str(error)})
    try:
        inventory = read_json("http://127.0.0.1:1234/api/v1/models")
        for model in inventory["models"]:
            if model.get("type") != "llm":
                continue
            tool_use = model.get("capabilities", {}).get("trained_for_tool_use") is True
            context = model.get("max_context_length", 0)
            report["local_models"].append({
                "key": model["key"], "size_bytes": model.get("size_bytes"),
                "tool_use": tool_use, "max_context_length": context,
                "eligible_for_current_picker": tool_use and context >= 65536,
                "loaded_context_lengths": [instance.get("config", {}).get("context_length")
                                           for instance in model.get("loaded_instances", [])],
            })
    except Exception as error:
        report["errors"].append({"source": "local LM Studio", "error": str(error)})
    print(json.dumps(report, indent=2))
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
