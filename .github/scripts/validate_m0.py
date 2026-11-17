#!/usr/bin/env python3
"""Repository contract and workflow hygiene checks.

CI runs this file twice: the pull request's own copy (m0-files, required) and the
protected base commit's copy against the pull request (base-policy, advisory).
"""
from pathlib import Path
import json
import os
import re
import subprocess
import sys
import textwrap

ROOT = Path(__file__).resolve().parents[2]
REQUIRED = [
    "README.md", "LICENSE", "SECURITY.md", "CODE_OF_CONDUCT.md", "CONTRIBUTING.md",
    "AGENTS.md", ".gitattributes", ".github/CODEOWNERS",
    ".github/pull_request_template.md", ".github/workflows/ci.yml",
    ".github/ISSUE_TEMPLATE/bug.yml", ".github/ISSUE_TEMPLATE/feature.yml",
    ".github/ISSUE_TEMPLATE/performance.yml", ".github/ISSUE_TEMPLATE/config.yml",
    ".github/ISSUE_TEMPLATE/task.yml",
    "governance/owners.yml", "governance/labels.yml", "governance/risk.yml",
    "governance/sensitive-paths.yml", "governance/exceptions.yml",
    "governance/exceptions.schema.json", "governance/release-policy.yml",
    "governance/asset-policy.yml", "docs/contracts/system-invariants.md",
    "docs/contracts/save-schema.md", "docs/ci-trust-boundary.md",
    "docs/runbooks/break-glass.md", "docs/architecture/README.md",
    "docs/adr/0000-template.md", "docs/rfc/README.md",
    "docs/threat-model/README.md", "docs/release-policy/README.md",
    "assets/manifests/README.md",
    "package.json", "package-lock.json", ".nvmrc", "index.html", "vite.config.ts", "tsconfig.json",
    "scripts/audit.mjs", "scripts/audit-visual.mjs", "src/main.ts",
    ".github/workflows/pages.yml", "docs/adr/0001-engine-architecture.md",
    ".github/workflows/labels.yml", ".github/scripts/sync_labels.py",
    ".github/scripts/classify_risk.py", ".github/scripts/check_exceptions.py",
    ".github/scripts/test_governance.py", "docs/governance/m1.md",
]
errors = []
for name in REQUIRED:
    path = ROOT / name
    if not path.is_file() or path.stat().st_size == 0:
        errors.append(f"missing or empty required file: {name}")

if (ROOT / "LICENSE").is_file():
    license_text = (ROOT / "LICENSE").read_text(encoding="utf-8")
    if "MIT License" not in license_text or "Copyright (c) 2026 waydefu" not in license_text:
        errors.append("LICENSE must be an explicit complete MIT license")

if (ROOT / ".github/CODEOWNERS").is_file():
    lines = (ROOT / ".github/CODEOWNERS").read_text(encoding="utf-8").splitlines()
    if "* @waydefu" not in lines:
        errors.append("CODEOWNERS must assign default @waydefu")
    owned = {line.split()[0] for line in lines if line.strip() and not line.startswith("#")}
    for protected in ["/.github/", "/governance/", "/AGENTS.md", "/.gitattributes", "/docs/contracts/"]:
        if protected not in owned:
            errors.append(f"CODEOWNERS missing explicit entry for protected path: {protected}")

if (ROOT / "governance/exceptions.schema.json").is_file():
    try:
        schema = json.loads((ROOT / "governance/exceptions.schema.json").read_text(encoding="utf-8"))
        if schema.get("type") != "object" or "exceptions" not in schema.get("required", []):
            errors.append("exceptions.schema.json does not define required exceptions")
    except (json.JSONDecodeError, OSError) as err:
        errors.append(f"invalid JSON Schema: {err}")

workflow_path = ROOT / ".github/workflows/ci.yml"
if workflow_path.is_file():
    text = workflow_path.read_text(encoding="utf-8")
    required_markers = [
        "contents: read", "final-gate:", "if: ${{ always() }}",
        "NEEDS_JSON:", "toJSON(needs)", "m0-files", "policy-syntax", "app-checks", "visual-audit",
        "npm ci --ignore-scripts", "dependency-review", "fail-on-severity:", "allow-licenses:",
        "base-policy", "check_exceptions.py", "unittest discover",
    ]
    for marker in required_markers:
        if marker not in text:
            errors.append(f"workflow missing M0 marker: {marker}")

# Static workflow hygiene across every workflow file (text scan, not a YAML policy engine).
DEFAULT_SHELL = re.compile(r"^defaults:\n  run:\n    shell: bash\n", re.M)
PINNED = re.compile(r"^[^@\s]+@[0-9a-f]{40}$")
for wf in sorted((ROOT / ".github/workflows").glob("*.y*ml")):
    rel = wf.relative_to(ROOT)
    if not DEFAULT_SHELL.search(wf.read_text(encoding="utf-8")):
        errors.append(f"{rel}: must set 'defaults: run: shell: bash' so piped steps fail on any error (pipefail)")
    for number, raw in enumerate(wf.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.split(" #", 1)[0].strip()
        if line.startswith("#"):
            continue
        match = re.match(r"^(?:-\s*)?uses:\s*(\S+)$", line)
        if match:
            target = match.group(1).strip("'\"")
            if target.startswith("./"):
                errors.append(f"{rel}:{number}: local action/workflow reference needs human-reviewed trust design: {target}")
            elif not PINNED.match(target):
                errors.append(f"{rel}:{number}: action not pinned to a full commit SHA: {target}")
        for banned in ("pull_request_target", "workflow_run", "issue_comment"):
            if re.search(rf"(^|[\s\[,]){banned}\s*(:|,|\]|$)", line):
                errors.append(f"{rel}:{number}: privileged trigger {banned} is not allowed at M0")
        if re.match(r"^secrets:\s*inherit$", line):
            errors.append(f"{rel}:{number}: 'secrets: inherit' is not allowed")
        if re.search(r"-all\s*$", line) and line.startswith("permissions:"):
            errors.append(f"{rel}:{number}: blanket workflow permissions are not allowed")
        # AEGIS A01 / T17: no dependency or build caches anywhere, so nothing a pull
        # request writes can be restored into a trusted or release job.
        if re.match(r"^(?:-\s*)?uses:\s*actions/cache(/\w+)?@", line) or re.match(r"^cache(-dependency-path)?:\s*\S", line):
            errors.append(f"{rel}:{number}: caches are not allowed (AEGIS A01)")

# Negative self-test of the final-gate logic (T05 at logic level only; real enforcement
# still depends on the Ruleset requiring the final-gate check from GitHub Actions).
if workflow_path.is_file():
    gate = re.search(r"python3 - <<'PY'\n(.*?)\n[ \t]*PY\n", workflow_path.read_text(encoding="utf-8"), re.S)
    if not gate:
        errors.append("could not locate final-gate script in ci.yml")
    else:
        source = textwrap.dedent(gate.group(1))
        jobs = ["m0-files", "policy-syntax", "app-checks", "visual-audit", "dependency-review"]
        good = {name: {"result": "success"} for name in jobs}
        cases = {"all-success": (good, 0), "empty": ({}, 1)}
        for name in jobs:
            cases[f"missing {name}"] = ({k: v for k, v in good.items() if k != name}, 1)
            cases[f"{name}=skipped"] = ({**good, name: {"result": "skipped"}}, 1)
        for bad in ("skipped", "failure", "cancelled", "neutral", ""):
            cases[f"policy-syntax={bad or 'blank'}"] = ({**good, "policy-syntax": {"result": bad}}, 1)
        for label, (needs, expected) in cases.items():
            run = subprocess.run(
                [sys.executable, "-c", source],
                env={**os.environ, "NEEDS_JSON": json.dumps(needs)},
                capture_output=True, text=True, timeout=60,
            )
            if run.returncode != expected:
                errors.append(f"final-gate self-test '{label}': expected exit {expected}, got {run.returncode}")
        print(f"final-gate self-test: {len(cases)} cases evaluated")

if errors:
    print("M0 verification FAILED")
    for issue in errors:
        print("ERROR:", issue)
    sys.exit(1)

print(f"M0 file contract PASS: {len(REQUIRED)} required files, license, CODEOWNERS, workflow hygiene and gate self-test")
