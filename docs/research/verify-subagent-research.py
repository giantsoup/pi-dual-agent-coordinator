"""Recheck local evidence for the dated report without launching agent runtimes."""

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REPORTS = [
    ROOT / "docs/research/subagent-recommendation-2026-10-18.md",
    ROOT / "docs/research/pi-subagent-source-notes-2026-10-18.md",
]
checks = 0


def require(condition, message):
    global checks
    if not condition:
        raise SystemExit(message)
    checks += 1


for report in REPORTS:
    body = report.read_text()
    require(body.endswith("\n"), f"Missing final newline: {report}")
    for target in re.findall(r"\]\(([^)]+)\)", body):
        if target.startswith(("https://", "http://", "#")):
            continue
        path = (report.parent / target.split("#", 1)[0]).resolve()
        require(path.is_file(), f"Missing local link: {report.name}: {target}")
    require(not any(line.rstrip() != line for line in body.splitlines()),
            f"Trailing whitespace: {report}")

installed = json.loads((ROOT / "node_modules/@mariozechner/pi-coding-agent/package.json").read_text())
lock = json.loads((ROOT / "package-lock.json").read_text())
require(installed["version"] == "0.67.68", "Installed Pi version differs; revisit version-specific findings")
require(lock["packages"]["node_modules/@mariozechner/pi-coding-agent"]["version"] == "0.67.68",
        "Locked Pi version differs; revisit version-specific findings")

evidence = {
    "src/runtime/runtime-registry.ts": ["new Map<Role, RoleRuntimeBinding>()"],
    "src/coordinator/bind-runtime-events.ts": ["new Map<Role, () => void>()"],
    "src/runtime/create-role-runtime.ts": ["baseToolsOverride:", "noExtensions: true", "AuthStorage.inMemory()"],
    "src/runtime/managed-session.ts": ["abortCompaction()", "abortBranchSummary()", "await this.pending?.catch"],
    "src/security/provider-broker.ts": ["Smoke test tools forbidden", "maxRequests?: number"],
    "src/types/role.ts": ['type Role = "A" | "B"'],
}
for source, markers in evidence.items():
    body = (ROOT / source).read_text()
    for marker in markers:
        require(marker in body, f"Source evidence changed: {source}: {marker}")

print(f"Passed {checks} local evidence and document checks. No runtime or live-provider verification performed.")
