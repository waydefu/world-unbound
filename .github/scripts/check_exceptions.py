#!/usr/bin/env python3
"""Governance exception checks (AEGIS chapter 21 D01; tests T36/T37).

Validates governance/exceptions.yml (converted to JSON, read from stdin)
against the rules of governance/exceptions.schema.json, and enforces expiry:

- an expired exception whose scope matches a changed file fails the check
  (the control it relaxed applies again to that change);
- an expired exception that the change does not touch only warns, so an
  unrelated pull request is not blocked;
- a reached review date warns.

Usage: check_exceptions.py [--changed FILES.txt] [--now ISO-8601] < exceptions.json
"""
import argparse
import json
import re
import sys
from datetime import datetime, timezone

REQUIRED = ["id", "scope", "control_id", "reason", "owner", "approved_by", "created_at",
            "expires_at", "compensating_control", "linked_issue", "risk", "review_at"]
MIN_LENGTH = {"scope": 1, "control_id": 1, "reason": 8, "owner": 2, "approved_by": 2,
              "compensating_control": 4, "linked_issue": 2}
ID_PATTERN = re.compile(r"^EX-[0-9]{4}-[0-9]+$")
RISKS = {"R0", "R1", "R2", "R3"}


def glob_regex(pattern):
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


def parse_time(value):
    """UTC timestamp with an explicit offset, e.g. 2026-11-24T00:00:00Z."""
    if not isinstance(value, str):
        raise ValueError("must be a quoted ISO-8601 string")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("must include a UTC offset (use Z)")
    return parsed


def check(document, now, changed):
    errors, warnings = [], []
    if not isinstance(document, dict):
        return ["exceptions file must be a mapping"], warnings
    unknown = set(document) - {"schema_version", "exceptions"}
    if unknown:
        errors.append(f"unknown top-level keys: {sorted(unknown)}")
    if document.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    entries = document.get("exceptions")
    if not isinstance(entries, list):
        return errors + ["exceptions must be a list"], warnings
    seen = set()
    for index, entry in enumerate(entries):
        label = f"exceptions[{index}]"
        if not isinstance(entry, dict):
            errors.append(f"{label} must be a mapping")
            continue
        label = f"{entry.get('id', label)}"
        missing = [k for k in REQUIRED if k not in entry]
        extra = sorted(set(entry) - set(REQUIRED))
        if missing:
            errors.append(f"{label}: missing {missing}")
        if extra:
            errors.append(f"{label}: unknown fields {extra}")
        if missing:
            continue
        if not ID_PATTERN.match(str(entry["id"])):
            errors.append(f"{label}: id must match EX-YYYY-N")
        if entry["id"] in seen:
            errors.append(f"{label}: duplicate id")
        seen.add(entry["id"])
        for key, minimum in MIN_LENGTH.items():
            if not isinstance(entry[key], str) or len(entry[key]) < minimum:
                errors.append(f"{label}: {key} must be a string of at least {minimum} characters")
        if entry["risk"] not in RISKS:
            errors.append(f"{label}: risk must be one of {sorted(RISKS)}")
        if str(entry["approved_by"]).lower() == str(entry["owner"]).lower():
            errors.append(f"{label}: approved_by must differ from owner")
        try:
            created = parse_time(entry["created_at"])
            expires = parse_time(entry["expires_at"])
            review = parse_time(entry["review_at"])
        except ValueError as err:
            errors.append(f"{label}: invalid timestamp ({err})")
            continue
        if expires <= created:
            errors.append(f"{label}: expires_at must be after created_at")
        if not created <= review <= expires:
            errors.append(f"{label}: review_at must lie between created_at and expires_at")
        if now >= expires:
            scope = glob_regex(str(entry["scope"]))
            touched = [f for f in changed if scope.match(f)]
            if touched:
                errors.append(f"{label}: expired {entry['expires_at']} and this change touches its scope "
                              f"({', '.join(touched[:3])}); control {entry['control_id']} applies again")
            else:
                warnings.append(f"{label}: expired {entry['expires_at']}; remove or renew it")
        elif now >= review:
            warnings.append(f"{label}: review due since {entry['review_at']}")
    return errors, warnings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--changed")
    parser.add_argument("--now")
    args = parser.parse_args()
    document = json.load(sys.stdin)
    now = parse_time(args.now) if args.now else datetime.now(timezone.utc)
    changed = []
    if args.changed:
        with open(args.changed, encoding="utf-8") as fh:
            changed = [line.strip() for line in fh if line.strip()]
    errors, warnings = check(document, now, changed)
    for message in warnings:
        print(f"::warning title=Governance exception::{message}")
    for message in errors:
        print(f"::error title=Governance exception::{message}")
    count = len(document.get("exceptions") or []) if isinstance(document, dict) else 0
    print(f"exceptions: {count} entr{'y' if count == 1 else 'ies'}, {len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
