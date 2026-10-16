"""Execution-scope and suite-membership regressions (stdlib only).

Round-16/17 findings: the push attestation must be scoped to exactly main,
the checker must run at the workspace root, the suite must contain no
symlinks, job env is job-wide wherever it sits, escaped trigger subkeys
decode like GitHub, shadow package components are rejected, and duplicate
pin declarations fail.
"""
import contextlib
import hashlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path

_check_spec = importlib.util.spec_from_file_location(
    "contract_check",
    Path(__file__).resolve().parents[2] / ".github/scripts/capability_gate_contract_check.py",
)
if _check_spec is None or _check_spec.loader is None:
    raise ImportError("contract checker unavailable")
check = importlib.util.module_from_spec(_check_spec)
_check_spec.loader.exec_module(check)


def _workflow_text():
    repo = Path(__file__).resolve().parents[2]
    workflow = repo / ".github/workflows/capability-gate-contract.yml"
    if not workflow.exists():
        raise unittest.SkipTest("contract workflow unavailable")
    return workflow.read_text()


CI = """on:
  push:
  pull_request:
  merge_group:
jobs:
  changes:
    runs-on: ubuntu-24.04
    steps:
      - name: Test capability register binding
        uses: ./.github/actions/capability-gate
      - uses: other/action@v1
"""


class ContractScopeTests(unittest.TestCase):
    def test_push_branches_must_be_exactly_main(self):
        text = _workflow_text()
        anchor = "never by a push to any other branch.\n    branches: [main]\n"
        self.assertIn(anchor, text)
        for pat in ("[main, attacker]", "['*']", "[other]"):
            mutant = text.replace(anchor, anchor.replace("[main]", pat), 1)
            self.assertNotEqual(mutant, text)
            failures = check.workflow_failures(mutant)
            self.assertTrue(failures)
            self.assertTrue(any("push" in f for f in failures))

    def test_working_directory_and_defaults_fail(self):
        text = _workflow_text()
        step = text.replace(
            '          python3 "$CHECKER" "$PINNED_CHECKER_SHA256"\n',
            '          python3 "$CHECKER" "$PINNED_CHECKER_SHA256"\n        working-directory: decoy\n',
            1,
        )
        self.assertNotEqual(step, text)
        self.assertEqual(check.execution_scope_failures(text), [])
        self.assertTrue(check.execution_scope_failures(step))
        top = text.replace("on:\n", "defaults:\n  run:\n    working-directory: decoy\non:\n", 1)
        self.assertNotEqual(top, text)
        self.assertTrue(check.execution_scope_failures(top))

    def test_suite_symlinks_fail(self):
        with tempfile.TemporaryDirectory() as root:
            suite = Path(root, check.SUITE_DIR)
            suite.mkdir(parents=True)
            (suite / "ok_test_capability_x.py").write_bytes(b"x = 1\n")
            declared = {f"{check.SUITE_DIR}/ok_test_capability_x.py": "0" * 64}
            self.assertEqual(check.undeclared_suite_files(root, declared), [])
            target = Path(root, "real")
            target.mkdir()
            (target / "__init__.py").write_bytes(b"import os\n")
            (suite / "json").symlink_to(target, target_is_directory=True)
            failures = check.undeclared_suite_files(root, declared)
            self.assertTrue(any("symlinks" in f and "json" in f for f in failures))

    def test_post_steps_job_env_fails(self):
        # Job-level env applies wherever it sits in the mapping: an env
        # block after the steps is still inherited by the gate step.
        mutant = CI.replace(
            "      - uses: other/action@v1\n",
            "      - uses: other/action@v1\n    env:\n      PYTHONPATH: /payload\n",
            1,
        )
        self.assertNotEqual(mutant, CI)
        failures = check.ci_failures(mutant)
        self.assertTrue(failures)
        self.assertIn("must not set environment", " ".join(failures))

    def test_escaped_trigger_subkeys_fail(self):
        # `"br\x61nches"` decodes to `branches`: the [never] filter must be
        # seen (and fail), not skipped as an unknown subkey.
        mutant = CI.replace(
            "  pull_request:\n",
            '  pull_request:\n    "br\\x61nches": [never]\n',
            1,
        )
        self.assertNotEqual(mutant, CI)
        failures = check.ci_failures(mutant)
        self.assertTrue(failures)
        self.assertIn("main match", " ".join(failures))
        text = _workflow_text()
        esc_types = text.replace(
            "    types: [opened, synchronize, reopened, edited]\n",
            '    "typ\\x65s": [opened]\n',
            1,
        )
        self.assertNotEqual(esc_types, text)
        failures = check.workflow_failures(esc_types)
        self.assertTrue(failures)
        self.assertIn("full pull_request_target types", " ".join(failures))

    def test_shadow_package_components_fail(self):
        # json/__init__.py is classified by the stem __init__, yet the
        # gate's `import json` would resolve the directory first.
        with tempfile.TemporaryDirectory() as root:
            pkg = Path(root, check.SUITE_DIR, "json")
            pkg.mkdir(parents=True)
            init = pkg / "__init__.py"
            init.write_bytes(b"import os\n")
            rel = f"{check.SUITE_DIR}/json/__init__.py"
            digest = hashlib.sha256(init.read_bytes()).hexdigest()
            failures, _ = check.pin_failures(root, {}, {rel: digest})
            self.assertTrue(any("shadow the interpreter" in f for f in failures))

    def test_job_execution_controls_pinned(self):
        # The pinned steps could otherwise move to a self-hosted runner or
        # gain sidecars/matrices while the text still matches.
        text = _workflow_text()
        self.assertEqual(check.execution_scope_failures(text), [])
        movers = {
            "self-hosted": text.replace("    runs-on: ubuntu-24.04\n", "    runs-on: self-hosted\n", 1),
            "matrix": text.replace("    timeout-minutes: 5\n    steps:\n", "    timeout-minutes: 5\n    strategy:\n      matrix:\n        x: [1]\n    steps:\n", 1),
            "services": text.replace("    timeout-minutes: 5\n    steps:\n", "    timeout-minutes: 5\n    services:\n      db:\n        image: evil\n    steps:\n", 1),
        }
        for label, mutant in movers.items():
            self.assertNotEqual(mutant, text, label)
            self.assertTrue(check.execution_scope_failures(mutant), label)

    def test_main_surfaces_execution_scope(self):
        # execution_scope_failures is wired through main, not the workflow
        # companion: prove the wiring with a minimal tree whose only
        # workflow defect is the runner move.
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / ".github/workflows").mkdir(parents=True)
            (Path(root) / ".github/workflows/ci.yml").write_text(CI)
            text = _workflow_text()
            mutant = text.replace("    runs-on: ubuntu-24.04\n", "    runs-on: self-hosted\n", 1)
            self.assertNotEqual(mutant, text)
            (Path(root) / ".github/workflows/capability-gate-contract.yml").write_text(mutant)
            (Path(root) / ".github/scripts").mkdir(parents=True)
            (Path(root) / ".github/scripts/capability_gate_contract_check.py").write_text("BASE_PINS = {}\n")
            Path(root, check.SUITE_DIR).mkdir(parents=True)
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = check.main(root)
            self.assertEqual(rc, 1)
            self.assertIn("ubuntu-24.04", buf.getvalue())

    def test_no_executable_step_before_checker(self):
        # A run step smuggled ahead of the checkout would execute PR code
        # before the base-owned checker starts.
        text = _workflow_text()
        evil_first = text.replace("    steps:\n", "    steps:\n      - run: echo pwned\n", 1)
        self.assertNotEqual(evil_first, text)
        self.assertTrue(check.workflow_failures(evil_first))

    def test_inline_job_env_fails(self):
        # A job-level `env: {BASH_ENV: ...}` marks the mapping open and skips
        # the inline value: the pin check below would still see the top-level
        # pin while Bash sources the PR file first.
        text = _workflow_text()
        mutant = text.replace(
            "    timeout-minutes: 5\n    steps:\n",
            "    timeout-minutes: 5\n    env: {BASH_ENV: attacker.sh}\n    steps:\n",
            1,
        )
        self.assertNotEqual(mutant, text)
        failures = check.workflow_failures(mutant)
        self.assertTrue(failures)
        self.assertIn("block mapping", " ".join(failures))

    def test_native_extension_shadows_fail(self):
        # json.so never matches rglob *.py, yet the gate's `import json`
        # resolves the extension from the script directory first.
        with tempfile.TemporaryDirectory() as root:
            suite = Path(root, check.SUITE_DIR)
            suite.mkdir(parents=True)
            (suite / "json.so").write_bytes(b"ELF-fake")
            failures = check.undeclared_suite_files(root, {})
            self.assertTrue(any("shadow the interpreter" in f and "json.so" in f for f in failures))

    def test_duplicate_pin_declarations_fail(self):
        # Python executes the LAST assignment: a second (weakened) dict
        # would run while review parses the first.
        with tempfile.TemporaryDirectory() as root:
            dup = Path(root, "checker.py")
            dup.write_text('BASE_PINS = {"a": "' + "0" * 64 + '"}\nBASE_PINS = {}\n')
            with self.assertRaisesRegex(ValueError, "duplicated"):
                check.declared_pins(dup)
            text = _workflow_text()
            anchor = "  PINNED_CHECKER_SHA256: "
            idx = text.index(anchor)
            eol = text.index("\n", idx)
            doubled = text[:eol] + "\n  PINNED_CHECKER_SHA256: " + "0" * 64 + text[eol:]
            with self.assertRaisesRegex(ValueError, "duplicated"):
                check.declared_checker_pin(doubled)


if __name__ == "__main__":
    unittest.main()
