#!/usr/bin/env python3
"""Advisory risk tier (R0-R3) for a change set (AEGIS chapter 11, C01; tests T31/T32).

Inputs are data only: the changed-file list, the unified diff text and the
sensitive-path policy (governance/sensitive-paths.yml converted to JSON). In
CI the policy and this script are taken from the protected base commit when
it has them, so a pull request cannot lower its own tier by editing them.

The tier is reported, not enforced: with a single maintainer there is no
independent reviewer to route R3 changes to. Exit status is 0 unless the
inputs are unreadable.

Usage: classify_risk.py --policy POLICY.json --changed FILES.txt [--diff PR.diff] [--json]
"""
import argparse
import json
import re
import sys

TIERS = ["R0", "R1", "R2", "R3"]
DOC_ONLY = re.compile(r"(^docs/|\.md$|^LICENSE$)")
SOURCE_MODULE = re.compile(r"^src/([^/]+)/")

# (file pattern, added-line pattern, escalation reason) -> R3
ESCALATIONS = [
    (re.compile(r"(^|/)package\.json$"),
     re.compile(r'"(preinstall|install|postinstall|prepare|prepack|postpack)"\s*:'),
     "new_install_or_compile_script"),
    (re.compile(r"(^|/)(\.npmrc|\.yarnrc(\.yml)?|pnpm-workspace\.yaml|package\.json)$"),
     re.compile(r"registry\s*[=:]"),
     "new_unapproved_registry"),
    (re.compile(r"^\.github/workflows/"),
     re.compile(r"(^\s*[a-z-]+:\s*write\b)|write-all"),
     "elevated_workflow_permissions"),
    (re.compile(r"(^|/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose\.ya?ml)$"),
     re.compile(r"privileged"),
     "privileged_docker_configuration"),
]


def glob_regex(pattern):
    """Glob with ** (any depth), * and ? (no slash)."""
    out, i = "", 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out, i = out + "(?:.*/)?", i + 3
        elif pattern.startswith("**", i):
            out, i = out + ".*", i + 2
        elif pattern[i] == "*":
            out, i = out + "[^/]*", i + 1
        elif pattern[i] == "?":
            out, i = out + "[^/]", i + 1
        else:
            out, i = out + re.escape(pattern[i]), i + 1
    return re.compile("^" + out + "$")


def added_lines(diff_text):
    """Maps file path -> list of added lines from a unified diff."""
    result, current = {}, None
    for line in diff_text.splitlines():
        if line.startswith("+++ "):
            target = line[4:].strip()
            current = target[2:] if target.startswith("b/") else None
            if current is not None:
                result.setdefault(current, [])
        elif current is not None and line.startswith("+") and not line.startswith("+++"):
            result[current].append(line[1:])
    return result


def classify(changed, policy, diff_text=""):
    reasons = []
    tier = 0
    files = [f for f in changed if f]
    if not files:
        return {"tier": "R0", "reasons": ["no changed files"], "files": 0}
    if all(DOC_ONLY.search(f) for f in files):
        reasons.append("documentation only")
    else:
        tier = 1
        reasons.append("code or configuration change (default R1)")
    modules = sorted({m.group(1) for f in files for m in [SOURCE_MODULE.match(f)] if m})
    if len(modules) >= 2:
        tier = max(tier, 2)
        reasons.append(f"cross-module change: src/{{{','.join(modules)}}}")
    for rule in policy.get("rules", []):
        regex = glob_regex(rule["glob"])
        hits = [f for f in files if regex.match(f)]
        if hits:
            level = TIERS.index(rule["baseline_risk"])
            tier = max(tier, level)
            reasons.append(f"{rule['baseline_risk']} sensitive path {rule['glob']}: {', '.join(hits[:3])}"
                           + (" ..." if len(hits) > 3 else "") + f" ({rule['reason']})")
    added = added_lines(diff_text)
    for path_re, line_re, reason in ESCALATIONS:
        for path, lines in added.items():
            if path_re.search(path) and any(line_re.search(line) for line in lines):
                tier = 3
                reasons.append(f"R3 escalation {reason}: {path}")
    return {"tier": TIERS[tier], "reasons": reasons, "files": len(files)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", required=True)
    parser.add_argument("--changed", required=True)
    parser.add_argument("--diff")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    with open(args.policy, encoding="utf-8") as fh:
        policy = json.load(fh)
    with open(args.changed, encoding="utf-8") as fh:
        changed = [line.strip() for line in fh if line.strip()]
    diff_text = ""
    if args.diff:
        with open(args.diff, encoding="utf-8", errors="replace") as fh:
            diff_text = fh.read()
    result = classify(changed, policy, diff_text)
    if args.json:
        print(json.dumps(result, indent=2))
        return
    print(f"## Risk tier: {result['tier']} (advisory)\n")
    print(f"{result['files']} changed file(s). Derived from the protected base policy, not from labels.\n")
    for reason in result["reasons"]:
        print(f"- {reason}")
    if result["tier"] == "R3":
        print("\n**R3:** security-owner review is required by policy. With one maintainer this cannot be "
              "independent; review every listed path yourself before merging.")
        print("::warning title=Risk tier R3::This change touches R3 paths or escalation patterns; see the job summary.")


if __name__ == "__main__":
    sys.exit(main())
