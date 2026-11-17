#!/usr/bin/env python3
"""Negative tests for validate_m0.py (AEGIS T01 accidental case, T05, T17, T43, T44).

Each test copies the tracked repository into a temporary directory, applies
one deliberate weakening and asserts that the validator rejects it. Running
these in CI keeps the evidence current instead of relying on a one-off log.

Run: python3 -m unittest discover -s .github/scripts -p 'test_*.py'
"""
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CI = ".github/workflows/ci.yml"
PAGES = ".github/workflows/pages.yml"


def tracked_files():
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True)
    return [name for name in out.stdout.decode().split("\0") if name]


class ValidatorNegativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.files = tracked_files()

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="validator-"))
        for name in self.files:
            source = ROOT / name
            if source.is_file():
                target = self.tmp / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def edit(self, name, old, new, count=1):
        path = self.tmp / name
        text = path.read_text(encoding="utf-8")
        self.assertIn(old, text, f"mutation anchor not found in {name}: {old!r}")
        path.write_text(text.replace(old, new, count), encoding="utf-8")

    def validate(self):
        run = subprocess.run([sys.executable, "-I", str(self.tmp / ".github/scripts/validate_m0.py")],
                             capture_output=True, text=True, timeout=300)
        return run.returncode, run.stdout + run.stderr

    def assertRejected(self, fragment):
        code, output = self.validate()
        self.assertEqual(code, 1, f"validator accepted the mutation:\n{output}")
        self.assertIn(fragment, output)

    def test_unmodified_copy_passes(self):
        code, output = self.validate()
        self.assertEqual(code, 0, output)

    def test_t05_gate_accepting_skipped_jobs(self):
        self.edit(CI, 'if result != "success":', 'if result not in ("success", "skipped"):')
        self.assertRejected("final-gate self-test")

    def test_gate_dropping_a_required_job(self):
        self.edit(CI, ', "dependency-review"}', "}")
        self.assertRejected("final-gate self-test")

    def test_t17_cache_action(self):
        self.edit(CI, "      - name: Typecheck\n",
                  "      - uses: actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830\n      - name: Typecheck\n")
        self.assertRejected("caches are not allowed")

    def test_t17_setup_node_cache(self):
        self.edit(PAGES, "          node-version-file: .nvmrc\n", "          node-version-file: .nvmrc\n          cache: npm\n")
        self.assertRejected("caches are not allowed")

    def test_t43_privileged_trigger(self):
        self.edit(CI, "  pull_request:\n", "  pull_request_target:\n")
        self.assertRejected("privileged trigger pull_request_target")

    def test_t43_local_action(self):
        self.edit(CI, "      - name: Typecheck\n", "      - uses: ./.github/actions/setup\n      - name: Typecheck\n")
        self.assertRejected("local action/workflow reference")

    def test_t44_secrets_inherit(self):
        path = self.tmp / ".github/workflows/reuse.yml"
        path.write_text("name: reuse\non: [push]\npermissions:\n  contents: read\n\ndefaults:\n  run:\n    shell: bash\n"
                        "jobs:\n  call:\n    uses: octo/repo/.github/workflows/x.yml@0123456789abcdef0123456789abcdef01234567\n"
                        "    secrets: inherit\n", encoding="utf-8")
        self.assertRejected("'secrets: inherit' is not allowed")

    def test_unpinned_action(self):
        text = (self.tmp / CI).read_text(encoding="utf-8")
        pinned = re.search(r"actions/checkout@[0-9a-f]{40}", text).group(0)
        self.edit(CI, pinned, "actions/checkout@v7", count=-1)
        self.assertRejected("action not pinned to a full commit SHA")

    def test_blanket_permissions(self):
        self.edit(CI, "permissions:\n  contents: read\n", "permissions: write-all\n")
        self.assertRejected("blanket workflow permissions")

    def test_missing_default_bash_shell(self):
        self.edit(PAGES, "defaults:\n  run:\n    shell: bash\n", "")
        self.assertRejected("pipefail")

    def test_lint_step_removed(self):
        self.edit(CI, "        run: npm run lint\n", "        run: echo skipped\n")
        self.assertRejected("npm run lint")

    def test_codeowners_entry_removed(self):
        self.edit(".github/CODEOWNERS", "/governance/ @waydefu\n", "")
        self.assertRejected("CODEOWNERS missing explicit entry for protected path: /governance/")


if __name__ == "__main__":
    unittest.main()
