#!/usr/bin/env python3
"""Label dictionary check and sync for governance/labels.yml.

The workflow converts the YAML dictionary to JSON (Ruby's safe YAML loader)
and pipes it here, so this script needs only the Python standard library.

  --check            validate the dictionary only (no network)
  --apply            create missing labels and fix colour/description drift
  --prune            with --apply: also delete labels not in the dictionary

Without --apply the sync prints its plan and changes nothing. Labels outside
the dictionary are only listed unless --prune is given, because deleting a
label removes it from every Issue and PR that carries it.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get("GITHUB_API_URL", "https://api.github.com")
COLOR = re.compile(r"^[0-9A-Fa-f]{6}$")


def validate(dictionary: dict) -> list[dict]:
    """Returns the label list or exits with every problem found."""
    problems: list[str] = []
    labels = dictionary.get("labels")
    if dictionary.get("schema_version") != 1:
        problems.append("schema_version must be 1")
    if not isinstance(labels, list) or not labels:
        problems.append("labels must be a non-empty list")
        labels = []
    seen: set[str] = set()
    for index, label in enumerate(labels):
        name = label.get("name") if isinstance(label, dict) else None
        if not isinstance(name, str) or not name.strip() or len(name) > 50:
            problems.append(f"labels[{index}]: name must be a non-empty string of at most 50 characters")
            continue
        if name.lower() in seen:
            problems.append(f"duplicate label (case-insensitive): {name}")
        seen.add(name.lower())
        if not COLOR.match(str(label.get("color", ""))):
            problems.append(f"{name}: color must be six hex digits")
        if len(str(label.get("description", ""))) > 100:
            problems.append(f"{name}: description longer than 100 characters")
    for group in dictionary.get("exclusive_groups", []):
        for name in group:
            if name.lower() not in seen:
                problems.append(f"exclusive group member is not a defined label: {name}")
    if problems:
        print("label dictionary INVALID")
        for problem in problems:
            print("ERROR:", problem)
        sys.exit(1)
    return labels


def request(method: str, path: str, token: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "label-sync",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as err:
        # Fail closed: a rate limit or permission error must not look like success.
        sys.exit(f"{method} {path} failed: HTTP {err.code} {err.read().decode(errors='replace')[:300]}")


def main() -> None:
    args = set(sys.argv[1:])
    labels = validate(json.load(sys.stdin))
    if "--check" in args:
        print(f"label dictionary OK: {len(labels)} labels")
        return

    token = os.environ.get("GITHUB_TOKEN", "")
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if not token or not repo:
        sys.exit("GITHUB_TOKEN and GITHUB_REPOSITORY are required")
    apply = "--apply" in args
    prune = "--prune" in args

    existing: dict[str, dict] = {}
    page = 1
    while True:
        batch = request("GET", f"/repos/{repo}/labels?per_page=100&page={page}", token)
        for label in batch:
            existing[label["name"].lower()] = label
        if len(batch) < 100:
            break
        page += 1

    changes = 0
    wanted = set()
    for label in labels:
        name, color, description = label["name"], label["color"].lower(), label.get("description", "")
        wanted.add(name.lower())
        current = existing.get(name.lower())
        body = {"color": color, "description": description}
        if current is None:
            print(f"create  {name}")
            if apply:
                request("POST", f"/repos/{repo}/labels", token, {"name": name, **body})
            changes += 1
        elif current["name"] != name or current["color"].lower() != color or (current.get("description") or "") != description:
            print(f"update  {name}")
            if apply:
                body["new_name"] = name
                request("PATCH", f"/repos/{repo}/labels/{urllib.parse.quote(current['name'], safe='')}", token, body)
            changes += 1

    extras = sorted(label["name"] for key, label in existing.items() if key not in wanted)
    for name in extras:
        if prune:
            print(f"delete  {name}")
            if apply:
                request("DELETE", f"/repos/{repo}/labels/{urllib.parse.quote(name, safe='')}", token)
            changes += 1
        else:
            print(f"extra   {name} (not in dictionary; kept, use prune to delete)")

    mode = "applied" if apply else "dry run, nothing changed"
    print(f"label sync: {changes} change(s), {len(extras)} label(s) outside the dictionary ({mode})")


if __name__ == "__main__":
    main()
