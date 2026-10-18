"""Report MCP configuration shape without launching servers or printing values."""

import argparse
import json
import os
from pathlib import Path
import tomllib


ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--workspace", type=Path, default=ROOT)
parser.add_argument("--config-home", type=Path, default=Path.home())
parser.add_argument("--agent-dir", type=Path)
args = parser.parse_args()
workspace = args.workspace.expanduser().resolve()
config_home = args.config_home.expanduser().resolve()
agent_dir = args.agent_dir or Path(
    os.environ.get("PI_CODING_AGENT_DIR", str(config_home / ".pi/agent"))
)


def inspect_config(path, dialect):
    record = {"path": str(path), "exists": path.is_file(), "dialect": dialect}
    if not record["exists"]:
        return record
    try:
        raw = path.read_text()
        data = tomllib.loads(raw) if dialect == "codex-toml" else json.loads(raw)
        servers = data.get("mcp_servers" if dialect == "codex-toml" else "mcpServers", {})
        if not isinstance(servers, dict):
            record["shape"] = "invalid-server-map"
            return record
        record["serverCount"] = len(servers)
        record["definitions"] = [
            {
                "hasCommand": isinstance(server.get("command"), str),
                "hasUrl": isinstance(server.get("url"), str),
                "hasExplicitCwd": "cwd" in server,
                "hasEnvironment": bool(server.get("env")),
                "hasHeaders": bool(server.get("headers") or server.get("http_headers")),
            }
            for server in servers.values()
            if isinstance(server, dict)
        ]
    except (OSError, ValueError, AttributeError):
        record["shape"] = "unreadable-or-invalid"
    return record


packages = {}
for package in ["@mariozechner/pi-coding-agent", "@modelcontextprotocol/sdk", "@playwright/mcp"]:
    path = ROOT / "node_modules" / package / "package.json"
    packages[package] = json.loads(path.read_text())["version"] if path.is_file() else None

source_files = list((ROOT / "src").rglob("*.ts"))
report = {
    "scope": "Configuration shape only. No server, browser, authentication, or connectivity check.",
    "pythonRequirement": "Python 3.11 or newer",
    "workspace": str(workspace),
    "configs": [
        inspect_config(agent_dir.expanduser().resolve() / "mcp.json", "pi-json"),
        inspect_config(workspace / ".mcp.json", "project-json"),
        inspect_config(config_home / ".codex/config.toml", "codex-toml"),
    ],
    "installedPackages": packages,
    "explicitPlaywrightReferencesInAppSource": [
        str(path.relative_to(ROOT))
        for path in sorted(source_files)
        if "playwright" in path.read_text().lower()
    ],
}
print(json.dumps(report, indent=2))
