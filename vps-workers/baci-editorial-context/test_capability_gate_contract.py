"""Contract-checker tests (stdlib only).

The base-owned checker reads PR files as data, never executes them: these
tests pin that behavior with fabricated trees plus a self-consistency run
against this checkout (forgotten pin updates fail here, not in CI).
"""
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
            for name in ("capability_gate_contract_check.py", "capability_gate_contract_text_checks.py"):
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

    def test_workflow_must_keep_base_owned_execution(self):
        repo = Path(__file__).resolve().parents[2]
        workflow = repo / ".github/workflows/capability-gate-contract.yml"
        if not workflow.exists():
            self.skipTest("contract workflow unavailable")
        self.assertEqual(check.workflow_failures(workflow.read_text()), [])
        dropped = workflow.read_text().replace(
            "            git archive FETCH_HEAD .github/scripts/capability_gate_contract_check.py .github/scripts/capability_gate_contract_text_checks.py | tar -x -C /tmp/cg-check\n", ""
        )
        self.assertNotEqual(dropped, workflow.read_text())
        self.assertTrue(check.workflow_failures(dropped))

    def test_extra_run_step_fails(self):
        repo = Path(__file__).resolve().parents[2]
        workflow = repo / ".github/workflows/capability-gate-contract.yml"
        if not workflow.exists():
            self.skipTest("contract workflow unavailable")
        text = workflow.read_text()
        extra = text.replace(
            '          python3 "$CHECKER" "$PINNED_CHECKER_SHA256"\n',
            '          python3 "$CHECKER" "$PINNED_CHECKER_SHA256"\n      - name: Extra\n        run: |\n          echo hijack\n',
            1,
        )
        self.assertNotEqual(extra, text)
        failures = check.workflow_failures(extra)
        self.assertTrue(failures)
        self.assertIn("exactly one run step", failures[0])

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
            ".github/scripts/capability_gate_contract_text_checks.py",
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

    def test_markers_only_as_comments_fail(self):
        repo = Path(__file__).resolve().parents[2]
        workflow = repo / ".github/workflows/capability-gate-contract.yml"
        if not workflow.exists():
            self.skipTest("contract workflow unavailable")
        text = workflow.read_text()
        # Comment every line containing a marker.
        commented = "\n".join(
            ("# " + line if ("git archive FETCH_HEAD" in line or 'python3 "$CHECKER"' in line) else line)
            for line in text.splitlines()
        )
        self.assertNotEqual(commented, text)
        self.assertTrue(check.workflow_failures(commented))

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

    def test_contract_trigger_removal_fails(self):
        repo = Path(__file__).resolve().parents[2]
        workflow = repo / ".github/workflows/capability-gate-contract.yml"
        if not workflow.exists():
            self.skipTest("contract workflow unavailable")
        text = workflow.read_text()
        dropped = text.replace("  pull_request_target:\n", "", 1)
        self.assertNotEqual(dropped, text)
        self.assertTrue(check.workflow_failures(dropped))

    def test_echoed_markers_fail(self):
        # Executable echoes of the marker strings still change the run
        # block, so the exact-sequence match must reject them.
        repo = Path(__file__).resolve().parents[2]
        workflow = repo / ".github/workflows/capability-gate-contract.yml"
        if not workflow.exists():
            self.skipTest("contract workflow unavailable")
        text = workflow.read_text()
        echoed = text.replace(
            '          python3 "$CHECKER" "$PINNED_CHECKER_SHA256"\n',
            '          echo \'git archive FETCH_HEAD\'\n          python3 "$CHECKER" "$PINNED_CHECKER_SHA256"\n',
            1,
        )
        self.assertNotEqual(echoed, text)
        self.assertTrue(check.workflow_failures(echoed))

    def test_head_pins_match_declared(self):
        # Forgetting a pin refresh after an enforcement edit fails the suite
        # here instead of surprising CI.
        repo = Path(__file__).resolve().parents[2]
        if not (repo / ".github/workflows/ci.yml").exists():
            self.skipTest("CI workflow unavailable")
        self.assertEqual(check.main(repo), 0)


if __name__ == "__main__":
    unittest.main()
