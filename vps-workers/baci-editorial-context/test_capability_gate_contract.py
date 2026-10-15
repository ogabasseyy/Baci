"""Contract-checker tests (stdlib only).

The base-owned checker reads PR files as data, never executes them: these
tests pin that behavior with fabricated trees plus a self-consistency run
against this checkout (forgotten pin updates fail here, not in CI).
"""
import hashlib
import importlib.util
import shutil
import subprocess
import sys
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


def _tree(root, ci=CI, pins=None, payload=b"enforcement"):
    (Path(root) / ".github/workflows").mkdir(parents=True)
    (Path(root) / ".github/workflows/ci.yml").write_text(ci)
    (Path(root) / ".github/scripts").mkdir(parents=True)
    checker = Path(root) / ".github/scripts/capability_gate_contract_check.py"
    checker.write_text("BASE_PINS = %r\n" % (pins or {}))
    target = Path(root) / "gate.py"
    target.write_bytes(payload)
    return checker, target


def _workflow_text():
    repo = Path(__file__).resolve().parents[2]
    workflow = repo / ".github/workflows/capability-gate-contract.yml"
    if not workflow.exists():
        raise unittest.SkipTest("contract workflow unavailable")
    return workflow.read_text()


class ContractCheckTests(unittest.TestCase):
    def test_intact_tree_passes(self):
        with tempfile.TemporaryDirectory() as root:
            checker, target = _tree(root)
            checker.write_text("BASE_PINS = %r\n" % {"gate.py": check.sha256_of(target)})
            self.assertEqual(check.ci_failures(CI), [])
            declared = check.declared_pins(checker)
            failures, notices = check.pin_failures(root, {"gate.py": declared["gate.py"]}, declared)
            self.assertEqual((failures, notices), ([], []))

    def test_hollowed_file_with_stale_pins_fails(self):
        with tempfile.TemporaryDirectory() as root:
            _, target = _tree(root, pins={"gate.py": "0" * 64})
            target.write_bytes(b"hollowed")
            declared = check.declared_pins(Path(root) / ".github/scripts/capability_gate_contract_check.py")
            failures, _ = check.pin_failures(root, {"gate.py": "0" * 64}, declared)
            self.assertEqual(len(failures), 1)
            self.assertIn("without a pin update", failures[0])

    def test_declared_pin_update_passes_with_notice(self):
        with tempfile.TemporaryDirectory() as root:
            _, target = _tree(root)
            target.write_bytes(b"reviewed change")
            new = check.sha256_of(target)
            (Path(root) / ".github/scripts/capability_gate_contract_check.py").write_text(
                "BASE_PINS = %r\n" % {"gate.py": new}
            )
            declared = check.declared_pins(Path(root) / ".github/scripts/capability_gate_contract_check.py")
            failures, notices = check.pin_failures(root, {"gate.py": "0" * 64}, declared)
            self.assertEqual(failures, [])
            self.assertEqual(len(notices), 1)

    def test_missing_enforcement_file_fails(self):
        with tempfile.TemporaryDirectory() as root:
            _tree(root, pins={"gate.py": "0" * 64})
            (Path(root) / "gate.py").unlink()
            declared = check.declared_pins(Path(root) / ".github/scripts/capability_gate_contract_check.py")
            failures, _ = check.pin_failures(root, {"gate.py": "0" * 64}, declared)
            self.assertIn("missing", failures[0])

    def test_declaration_is_parsed_never_executed(self):
        with tempfile.TemporaryDirectory() as root:
            bomb = Path(root) / "checker.py"
            bomb.write_text("BASE_PINS = {'gate.py': '%s'}\nraise RuntimeError('executed')\n" % ("0" * 64))
            self.assertEqual(check.declared_pins(bomb), {"gate.py": "0" * 64})

    def test_tmp_copy_runs_from_repo_root(self):
        # The workflow runs a base-owned copy from /tmp: the checker must
        # derive the tree from the working directory, never its own path.
        repo = Path(__file__).resolve().parents[2]
        if not (repo / ".github/workflows/ci.yml").exists():
            self.skipTest("CI workflow unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            scripts = Path(tmp, ".github", "scripts")
            scripts.mkdir(parents=True)
            for name in ("capability_gate_contract_check.py", "capability_gate_contract_ci_checks.py", "capability_gate_contract_workflow_checks.py"):
                shutil.copy(repo / ".github/scripts" / name, scripts / name)
            proc = subprocess.run(
                [sys.executable, str(scripts / "capability_gate_contract_check.py")],
                cwd=repo, capture_output=True, text=True,
            )
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)

    def test_checker_file_pin_lifecycle(self):
        with tempfile.TemporaryDirectory() as root:
            script = Path(root, ".github/scripts")
            script.mkdir(parents=True)
            target = script / "capability_gate_contract_check.py"
            target.write_bytes(b"logic")
            digest = check.sha256_of(target)
            self.assertEqual(check.checker_file_failures(root, digest, digest), ([], []))
            target.write_bytes(b"reviewed logic")
            new = check.sha256_of(target)
            failures, notices = check.checker_file_failures(root, digest, new)
            self.assertEqual(failures, [])
            self.assertEqual(len(notices), 1)
            failures, _ = check.checker_file_failures(root, digest, digest)
            self.assertTrue(failures)
            # Advance declaration while the checker is unchanged must fail.
            target.write_bytes(b"logic")
            failures, _ = check.checker_file_failures(root, digest, "e" * 64)
            self.assertTrue(failures)
            self.assertIn("without a checker change", failures[0])
            target.unlink()
            failures, _ = check.checker_file_failures(root, digest, new)
            self.assertIn("missing", failures[0])

    def test_pin_set_covers_enforcement_core(self):
        # A comment-swallowed dict entry once silently unpinned the gate:
        # the files that decide and produce the verdict must stay declared.
        repo = Path(__file__).resolve().parents[2]
        checker = repo / ".github/scripts/capability_gate_contract_check.py"
        if not checker.exists():
            self.skipTest("contract checker unavailable")
        declared = check.declared_pins(checker)
        for rel in (
            ".github/actions/capability-gate/action.yml",
            "vps-workers/baci-editorial-context/capability_gate.py",
            "vps-workers/baci-editorial-context/capability_gate_paths.py",
            "vps-workers/baci-editorial-context/register_status.py",
            "vps-workers/baci-editorial-context/register_digests.py",
            "vps-workers/baci-editorial-context/platform_capabilities.py",
            "vps-workers/baci-editorial-context/test_capability_register_binding.py",
            ".github/scripts/capability_gate_contract_ci_checks.py",
            ".github/scripts/capability_gate_contract_workflow_checks.py",
            ".github/workflows/capability-register-freshness.yml",
        ):
            self.assertIn(rel, declared)

    def test_advance_declaration_without_file_change_fails(self):
        with tempfile.TemporaryDirectory() as root:
            _, target = _tree(root, pins={"gate.py": "0" * 64})
            digest = check.sha256_of(target)
            base = {"gate.py": digest}
            failures, _ = check.pin_failures(root, base, {"gate.py": "f" * 64})
            self.assertTrue(failures)
            self.assertIn("without a file change", failures[0])
            failures, _ = check.pin_failures(root, base, {"gate.py": digest})
            self.assertEqual(failures, [])

    def test_dropped_declaration_fails(self):
        # Deleting an unchanged file's declaration must fail: otherwise a
        # first PR drops the pin and a later PR weakens the file unseen.
        with tempfile.TemporaryDirectory() as root:
            _, target = _tree(root, pins={"gate.py": "0" * 64})
            digest = check.sha256_of(target)
            base = {"gate.py": digest}
            failures, _ = check.pin_failures(root, base, {})
            self.assertTrue(failures)
            self.assertIn("declaration dropped", failures[0])

    def test_undeclared_suite_file_fails(self):
        with tempfile.TemporaryDirectory() as root:
            suite = Path(root, check.SUITE_DIR)
            suite.mkdir(parents=True)
            (suite / "gate.py").write_bytes(b"x = 1\n")
            (suite / "test_000_capability_exit.py").write_bytes(b"import os\n")
            declared = {f"{check.SUITE_DIR}/gate.py": "0" * 64}
            failures = check.undeclared_suite_files(root, declared)
            self.assertEqual(len(failures), 1)
            self.assertIn("test_000_capability_exit", failures[0])

    def test_declared_new_suite_file_passes_with_notice(self):
        # A brand-new suite file has no baseline to betray: declaring its
        # actual digest passes with a notice instead of deadlocking growth.
        with tempfile.TemporaryDirectory() as root:
            suite = Path(root, check.SUITE_DIR)
            suite.mkdir(parents=True)
            (suite / "test_000_capability_new.py").write_bytes(b"import os\n")
            rel = f"{check.SUITE_DIR}/test_000_capability_new.py"
            digest = check.sha256_of(Path(root, rel))
            failures, notices = check.pin_failures(root, {}, {rel: digest})
            self.assertEqual(failures, [])
            self.assertTrue(any("new suite file" in n for n in notices))
            # A mismatched hash fails: otherwise a benign file could declare
            # a future payload's digest, then land it silently in a later PR.
            wrong, _ = check.pin_failures(root, {}, {rel: "ab" * 32})
            self.assertTrue(any("does not match" in f for f in wrong))
            # Pins for non-suite paths or missing files still fail: only
            # reviewed suite additions get the transition.
            bad, _ = check.pin_failures(root, {}, {"other/new.py": "ab" * 32})
            self.assertTrue(any("unknown pin" in f for f in bad))
            missing, _ = check.pin_failures(root, {}, {f"{check.SUITE_DIR}/ghost.py": "ab" * 32})
            self.assertTrue(any("unknown pin" in f for f in missing))

    def test_workflow_checker_pin_matches_shipped_checker(self):
        # A stale bootstrap pin fails every later PR under the base-owned
        # guard, so the pin's freshness is asserted in-repo, not by format.
        repo = Path(__file__).resolve().parents[2]
        declared = check.declared_checker_pin(
            (repo / ".github/workflows/capability-gate-contract.yml").read_text()
        )
        self.assertIsNotNone(declared)
        actual = hashlib.sha256(
            (repo / ".github/scripts/capability_gate_contract_check.py").read_bytes()
        ).hexdigest()
        self.assertEqual(actual, declared)

    def test_head_pins_match_declared(self):
        # Forgetting a pin refresh after an enforcement edit fails the suite
        # here instead of surprising CI.
        repo = Path(__file__).resolve().parents[2]
        if not (repo / ".github/workflows/ci.yml").exists():
            self.skipTest("CI workflow unavailable")
        self.assertEqual(check.main(repo), 0)


if __name__ == "__main__":
    unittest.main()
