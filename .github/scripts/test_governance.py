#!/usr/bin/env python3
"""Tests for classify_risk.py and check_exceptions.py (AEGIS T31, T32, T36, T37).

Run: python3 -m unittest discover -s .github/scripts -p 'test_*.py'
The real governance/sensitive-paths.yml is loaded through Ruby's safe YAML
loader, the same conversion CI uses.
"""
import json
import subprocess
import unittest
from datetime import datetime, timezone
from pathlib import Path

import check_exceptions
import classify_risk

ROOT = Path(__file__).resolve().parents[2]


def load_yaml(path):
    script = ("require 'yaml'; require 'json'; puts JSON.generate(YAML.safe_load(File.read(ARGV[0]), "
              "permitted_classes: [], permitted_symbols: [], aliases: false))")
    out = subprocess.run(["ruby", "-e", script, str(path)], check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


POLICY = load_yaml(ROOT / "governance/sensitive-paths.yml")


def tier(files, diff=""):
    return classify_risk.classify(files, POLICY, diff)["tier"]


def diff_adding(path, *lines):
    body = "\n".join("+" + line for line in lines)
    return f"--- a/{path}\n+++ b/{path}\n@@ -1 +1 @@\n{body}\n"


class RiskTiers(unittest.TestCase):
    def test_documentation_only_is_r0(self):
        self.assertEqual(tier(["README.md", "docs/adr/0002-target-architecture.md"]), "R0")

    def test_single_module_code_is_r1(self):
        self.assertEqual(tier(["src/world/hash.ts", "tests/world.test.ts"]), "R1")

    def test_cross_module_code_is_r2(self):
        self.assertEqual(tier(["src/world/hash.ts", "src/render/environment.ts"]), "R2")

    def test_t32_benign_lockfile_update_is_r2_not_r3(self):
        diff = diff_adding("package-lock.json", '      "version": "0.188.0",')
        self.assertEqual(tier(["package-lock.json"], diff), "R2")

    def test_t31_postinstall_script_escalates_to_r3(self):
        diff = diff_adding("package.json", '    "postinstall": "node fetch.js",')
        self.assertEqual(tier(["package.json"], diff), "R3")

    def test_t31_new_registry_escalates_to_r3(self):
        self.assertEqual(tier([".npmrc"], diff_adding(".npmrc", "registry=https://example.invalid/")), "R3")

    def test_t31_workflow_write_permission_escalates_to_r3(self):
        path = ".github/workflows/ci.yml"
        self.assertEqual(tier([path], diff_adding(path, "      contents: write")), "R3")

    def test_t31_build_script_and_governance_paths_are_r3(self):
        self.assertEqual(tier(["native/core/build.rs"]), "R3")
        self.assertEqual(tier(["governance/risk.yml"]), "R3")
        self.assertEqual(tier(["AGENTS.md"]), "R3")
        self.assertEqual(tier([".github/scripts/classify_risk.py"]), "R3")

    def test_save_schema_contract_is_r2(self):
        self.assertEqual(tier(["docs/contracts/save-schema.md"]), "R2")

    def test_glob_semantics(self):
        self.assertTrue(classify_risk.glob_regex("**/Dockerfile*").match("Dockerfile"))
        self.assertTrue(classify_risk.glob_regex("**/Dockerfile*").match("tools/bake/Dockerfile.ci"))
        self.assertFalse(classify_risk.glob_regex(".github/workflows/**").match(".github/scripts/x.py"))
        self.assertFalse(classify_risk.glob_regex("src/*.ts").match("src/app/App.ts"))


NOW = datetime(2026, 12, 1, tzinfo=timezone.utc)


def exception(**overrides):
    entry = {
        "id": "EX-2026-017", "scope": "src/render/**", "control_id": "perf-baseline",
        "reason": "temporary hardware lab outage", "owner": "@renderer-owner",
        "approved_by": "@security-owner", "created_at": "2026-11-17T00:00:00Z",
        "expires_at": "2026-11-24T00:00:00Z", "compensating_control": "nightly-device-benchmark",
        "linked_issue": "#427", "risk": "R2", "review_at": "2026-11-20T00:00:00Z",
    }
    entry.update(overrides)
    return {"schema_version": 1, "exceptions": [entry]}


class Exceptions(unittest.TestCase):
    def run_check(self, document, changed=(), now=NOW):
        return check_exceptions.check(document, now, list(changed))

    def test_repository_file_is_valid(self):
        errors, _ = self.run_check(load_yaml(ROOT / "governance/exceptions.yml"))
        self.assertEqual(errors, [])

    def test_t36_expired_exception_fails_when_its_scope_changes(self):
        errors, _ = self.run_check(exception(), ["src/render/environment.ts"])
        self.assertEqual(len(errors), 1)
        self.assertIn("perf-baseline applies again", errors[0])

    def test_t37_expired_exception_only_warns_for_unrelated_changes(self):
        errors, warnings = self.run_check(exception(), ["docs/README.md"])
        self.assertEqual(errors, [])
        self.assertEqual(len(warnings), 1)

    def test_active_exception_passes_and_review_date_warns(self):
        errors, warnings = self.run_check(exception(), ["src/render/x.ts"], datetime(2026, 11, 21, tzinfo=timezone.utc))
        self.assertEqual(errors, [])
        self.assertIn("review due", warnings[0])

    def test_self_approval_is_rejected(self):
        errors, _ = self.run_check(exception(approved_by="@Renderer-Owner"), now=datetime(2026, 11, 18, tzinfo=timezone.utc))
        self.assertTrue(any("approved_by must differ" in e for e in errors))

    def test_structural_errors(self):
        cases = [
            exception(id="EX-17"),
            exception(risk="R9"),
            exception(expires_at="2026-11-10T00:00:00Z"),
            exception(created_at="2026-11-17T00:00:00"),
            exception(reason="short"),
            exception(extra_field="x"),
        ]
        for document in cases:
            errors, _ = self.run_check(document, now=datetime(2026, 11, 18, tzinfo=timezone.utc))
            self.assertTrue(errors, document["exceptions"][0])
        missing = exception()
        del missing["exceptions"][0]["owner"]
        self.assertTrue(self.run_check(missing)[0])


if __name__ == "__main__":
    unittest.main()
