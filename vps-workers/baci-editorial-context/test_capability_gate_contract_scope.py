"""Execution-scope and suite-membership regressions (stdlib only).

Round-16 findings: the push attestation must be scoped to exactly main
(inclusion globs still match it), the checker must run at the workspace
root (a working-directory/defaults override would execute a mirror tree
while the pinned text matches), and the suite must contain no symlinks (a
linked stdlib name would hijack imports before any check runs).
"""
import importlib.util
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


if __name__ == "__main__":
    unittest.main()
