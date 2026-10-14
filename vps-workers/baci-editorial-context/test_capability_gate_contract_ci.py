"""Caller-side (ci.yml) contract tests (stdlib only).

Split from test_capability_gate_contract.py to hold the 300-line limit:
invocation block, job conditions, and trigger wiring live here.
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


class ContractCiTests(unittest.TestCase):
    def test_intact_invocation_passes(self):
        self.assertEqual(check.ci_failures(CI), [])

    def test_conditioned_step_fails(self):
        ci = CI.replace(
            "        uses: ./.github/actions/capability-gate\n",
            "        if: github.event_name == 'push'\n        uses: ./.github/actions/capability-gate\n",
            1,
        )
        self.assertTrue(check.ci_failures(ci))

    def test_relocation_into_never_running_job_fails(self):
        ci = """on:
  push:
  pull_request:
jobs:
  changes:
    runs-on: ubuntu-24.04
    steps:
      - uses: other/action@v1
  skipped:
    if: false
    runs-on: ubuntu-24.04
    steps:
      - name: Test capability register binding
        uses: ./.github/actions/capability-gate
"""
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("unconditional", failures[0])

    def test_continue_on_error_job_fails(self):
        ci = CI.replace(
            "  changes:\n    runs-on: ubuntu-24.04\n",
            "  changes:\n    continue-on-error: true\n    runs-on: ubuntu-24.04\n",
            1,
        )
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("unconditional", failures[0])

    def test_spaced_job_condition_fails(self):
        # Valid YAML permits whitespace before the colon: `if : false`
        # skips the job exactly like `if: false`.
        ci = CI.replace(
            "  changes:\n    runs-on: ubuntu-24.04\n",
            "  changes:\n    if : false\n    runs-on: ubuntu-24.04\n",
            1,
        )
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("unconditional", failures[0])

    def test_needs_gated_job_fails(self):
        ci = CI.replace(
            "  changes:\n    runs-on: ubuntu-24.04\n",
            "  changes:\n    needs: [other]\n    runs-on: ubuntu-24.04\n",
            1,
        )
        self.assertTrue(check.ci_failures(ci))

    def test_dropped_trigger_fails(self):
        self.assertTrue(check.ci_failures(CI.replace("  pull_request:\n", "", 1)))
        commented = CI.replace("  pull_request:\n", "  # pull_request:\n", 1)
        self.assertTrue(check.ci_failures(commented))

    def test_spaced_trigger_key_still_passes(self):
        # Spacing before the colon is YAML-equivalent, not a bypass.
        ci = CI.replace("  pull_request:\n", "  pull_request :\n", 1)
        self.assertEqual(check.ci_failures(ci), [])

    def test_narrowed_trigger_values_fail(self):
        branched = CI.replace(
            "  pull_request:\n", "  pull_request:\n    branches: [other]\n", 1
        )
        failures = check.ci_failures(branched)
        self.assertTrue(failures)
        self.assertIn("branches", failures[0])
        pathed = CI.replace(
            "  push:\n", "  push:\n    paths-ignore:\n      - docs/**\n", 1
        )
        failures = check.ci_failures(pathed)
        self.assertTrue(failures)
        self.assertIn("paths-ignore", failures[0])

    def test_types_narrowing_fails(self):
        # types: [opened] drops synchronize updates — the PR pushes most
        # likely to touch cited sources after initial review.
        typed = CI.replace(
            "  pull_request:\n", "  pull_request:\n    types: [opened]\n", 1
        )
        failures = check.ci_failures(typed)
        self.assertTrue(failures)
        self.assertIn("types", failures[0])

    def test_fake_comment_cannot_satisfy(self):
        ci = """on:
  push:
  pull_request:
jobs:
  changes:
    runs-on: ubuntu-24.04
    steps:
      # - name: Test capability register binding
      # uses: ./.github/actions/capability-gate
      - uses: other/action@v1
"""
        self.assertTrue(check.ci_failures(ci))


if __name__ == "__main__":
    unittest.main()
