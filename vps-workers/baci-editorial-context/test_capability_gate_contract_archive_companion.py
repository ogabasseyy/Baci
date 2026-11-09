"""Only the reviewed base-owned checker companion may be archived."""
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "contract_check_archive_companion",
    ROOT / ".github/scripts/capability_gate_contract_check.py",
)
assert SPEC and SPEC.loader
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)


class ArchiveCompanionTests(unittest.TestCase):
    def test_only_exact_four_file_archive_is_accepted(self):
        workflow = (ROOT / ".github/workflows/capability-gate-contract.yml").read_text()
        original = ".github/scripts/capability_gate_contract_workflow_checks.py | tar"
        replacement = (
            ".github/scripts/capability_gate_contract_workflow_checks.py "
            "vps-workers/baci-editorial-context/capability_gate_contract_private_fetch.py | tar"
        )
        if original in workflow:
            expanded = workflow.replace(original, replacement, 1)
        else:
            self.assertIn(replacement, workflow)
            expanded = workflow
        self.assertEqual(check.workflow_failures(expanded), [])
        for altered in (
            expanded.replace("capability_gate_contract_private_fetch.py", "evil.py", 1),
            expanded.replace("FETCH_HEAD", "HEAD", 1),
            expanded.replace("python3 \"$CHECKER\"", "python3 ./candidate.py", 1),
            expanded.replace("private_fetch.py | tar", "private_fetch.py evil.py | tar", 1),
            expanded.replace(
                replacement,
                "vps-workers/baci-editorial-context/capability_gate_contract_private_fetch.py "
                ".github/scripts/capability_gate_contract_workflow_checks.py | tar",
                1,
            ),
        ):
            self.assertNotEqual(altered, expanded)
            self.assertTrue(check.workflow_failures(altered))


if __name__ == "__main__":
    unittest.main()
