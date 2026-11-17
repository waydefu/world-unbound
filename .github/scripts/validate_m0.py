#!/usr/bin/env python3
"""M0 structure verification. This is NOT a trusted base-branch policy evaluator."""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
REQUIRED = [
    "README.md", "LICENSE", "SECURITY.md", "CODE_OF_CONDUCT.md", "CONTRIBUTING.md",
    "AGENTS.md", ".gitattributes", ".github/CODEOWNERS",
    ".github/pull_request_template.md", ".github/workflows/ci.yml",
    ".github/ISSUE_TEMPLATE/bug.yml", ".github/ISSUE_TEMPLATE/feature.yml",
    ".github/ISSUE_TEMPLATE/performance.yml", ".github/ISSUE_TEMPLATE/config.yml",
    "governance/owners.yml", "governance/labels.yml", "governance/risk.yml",
    "governance/sensitive-paths.yml", "governance/exceptions.yml",
    "governance/exceptions.schema.json", "governance/release-policy.yml",
    "governance/asset-policy.yml", "docs/contracts/system-invariants.md",
    "docs/contracts/save-schema.md", "docs/ci-trust-boundary.md",
    "docs/runbooks/break-glass.md", "docs/architecture/README.md",
    "docs/adr/0000-template.md", "docs/rfc/README.md",
    "docs/threat-model/README.md", "docs/release-policy/README.md",
    "assets/manifests/README.md",
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
        "NEEDS_JSON:", "toJSON(needs)", "m0-files", "policy-syntax",
    ]
    for marker in required_markers:
        if marker not in text:
            errors.append(f"workflow missing M0 marker: {marker}")

if errors:
    print("M0 verification FAILED")
    for issue in errors:
        print("ERROR:", issue)
    sys.exit(1)

print(f"M0 file contract PASS: {len(REQUIRED)} required files, license, CODEOWNERS and gate markers")
