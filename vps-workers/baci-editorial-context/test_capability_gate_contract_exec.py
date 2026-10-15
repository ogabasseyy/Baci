"""Execution-context pinning tests (stdlib only).

Quoted YAML keys are the same key to GitHub: every condition, env,
ref, trigger-filter, permission, and shell scan must see through the
quotes, or a quoted spelling silently disables the guard. Startup
environments and custom shells preload or replace execution.
"""
import importlib.util
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
"""


def _workflow_text():
    repo = Path(__file__).resolve().parents[2]
    workflow = repo / ".github/workflows/capability-gate-contract.yml"
    if not workflow.exists():
        raise unittest.SkipTest("contract workflow unavailable")
    return workflow.read_text()


class ContractExecTests(unittest.TestCase):
    def test_quoted_trigger_filter_keys_fail(self):
        quoted_branches = CI.replace(
            "  pull_request:\n",
            '  pull_request:\n    "branches": [never]\n',
            1,
        )
        failures = check.ci_failures(quoted_branches)
        self.assertTrue(failures)
        self.assertIn("main", failures[0])
        quoted_types = CI.replace(
            "  pull_request:\n",
            '  pull_request:\n    "types": [opened]\n',
            1,
        )
        failures = check.ci_failures(quoted_types)
        self.assertTrue(failures)
        self.assertIn("types", failures[0])

    def test_quoted_top_level_startup_env_fails(self):
        ci = CI.replace(
            "jobs:\n",
            'env:\n  "PYTHONPATH": /tmp/payload\njobs:\n',
            1,
        )
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("startup code", failures[0])

    def test_quoted_gate_job_env_fails(self):
        ci = CI.replace(
            "    runs-on: ubuntu-24.04\n",
            '    runs-on: ubuntu-24.04\n    "env":\n      BASH_ENV: /tmp/x.sh\n',
            1,
        )
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("environment", failures[0])

    def test_quoted_checkout_ref_fails(self):
        ci = CI.replace(
            "      - name: Test capability register binding\n",
            "      - uses: actions/checkout@v4\n        with:\n          \"ref\": abc123\n"
            "      - name: Test capability register binding\n",
            1,
        )
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("must not pin a ref", failures[0])

    def test_contract_run_step_shell_pinned(self):
        text = _workflow_text()
        evil = text.replace(
            "        shell: bash\n",
            "        shell: bash -c 'exit 0' -- {0}\n",
            1,
        )
        self.assertNotEqual(evil, text)
        failures = check.workflow_failures(evil)
        self.assertTrue(failures)
        self.assertIn("shell", " ".join(failures))
        self.assertEqual(check.workflow_failures(text), [])

    def test_quoted_contract_step_env_fails(self):
        text = _workflow_text()
        quoted = text.replace(
            "        run: |\n",
            '        "env":\n          BASH_ENV: /tmp/x.sh\n        run: |\n',
            1,
        )
        failures = check.workflow_failures(quoted)
        self.assertTrue(failures)
        self.assertIn("env", " ".join(failures))

    def test_quoted_contract_job_permissions_fail(self):
        text = _workflow_text()
        quoted = text.replace(
            "    runs-on: ubuntu-24.04\n",
            '    runs-on: ubuntu-24.04\n    "permissions":\n      contents: write\n',
            1,
        )
        failures = check.workflow_failures(quoted)
        self.assertTrue(failures)
        self.assertIn("permissions", " ".join(failures))

    def test_quoted_contract_types_fail(self):
        text = _workflow_text()
        quoted = text.replace(
            "    types: [opened, synchronize, reopened, edited]\n",
            '    "types": [opened]\n',
            1,
        )
        failures = check.workflow_failures(quoted)
        self.assertTrue(failures)
        self.assertIn("types", " ".join(failures))


if __name__ == "__main__":
    unittest.main()
