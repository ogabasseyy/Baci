"""Execution-context pinning tests (stdlib only).

Quoted YAML keys are the same key to GitHub: every condition, env,
ref, trigger-filter, permission, and shell scan must see through the
quotes, or a quoted spelling silently disables the guard. Startup
environments and custom shells preload or replace execution.
"""
import importlib.util
import sys
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

    def test_flow_checkout_with_ref_fails(self):
        # `with: {ref: base.sha}` keeps the accepted uses line while the
        # checkout lands on the base revision, emptying the gate diff.
        ci = CI.replace(
            "      - name: Test capability register binding\n",
            "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n"
            '        with: {ref: "${{ github.event.pull_request.base.sha }}", fetch-depth: 0}\n'
            "      - name: Test capability register binding\n",
            1,
        )
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("must not pin a ref", failures[0])

    def test_inline_and_quoted_run_steps_fail(self):
        inline = CI.replace(
            "      - name: Test capability register binding\n",
            "      - run: cp attacker.py vps-workers/baci-editorial-context/capability_gate.py\n"
            "      - name: Test capability register binding\n",
            1,
        )
        failures = check.ci_failures(inline)
        self.assertTrue(failures)
        self.assertIn("precede", failures[0])
        quoted_uses = CI.replace(
            "      - name: Test capability register binding\n",
            '      - "uses": ./tools/evil-action\n'
            "      - name: Test capability register binding\n",
            1,
        )
        failures = check.ci_failures(quoted_uses)
        self.assertTrue(failures)
        self.assertIn("only the pinned checkout", failures[0])

    def test_escaped_condition_keys_fail(self):
        # YAML decodes "\x69f" to `if`: the raw-text scans must reject the
        # escaped spelling instead of missing the condition.
        ci = CI.replace(
            "  changes:\n    runs-on: ubuntu-24.04\n",
            '  changes:\n    runs-on: ubuntu-24.04\n    "\\x69f": false\n',
            1,
        )
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("plain spelling", failures[0])
        text = _workflow_text()
        quoted = text.replace(
            "        run: |\n",
            '        "\\x69f": false\n        run: |\n',
            1,
        )
        failures = check.workflow_failures(quoted)
        self.assertTrue(failures)
        self.assertIn("plain spelling", " ".join(failures))

    def test_quoted_top_level_env_key_workflow_fails(self):
        text = _workflow_text()
        quoted = text.replace("env:\n", '"env":\n  BASH_ENV: /tmp/x.sh\n', 1)
        failures = check.workflow_failures(quoted)
        self.assertTrue(failures)
        self.assertIn("only the checker pin", " ".join(failures))

    def test_top_level_flow_env_fails(self):
        ci = CI.replace(
            "jobs:\n",
            "env: {BASH_ENV: /tmp/x}\n\njobs:\n",
            1,
        )
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("block mapping", failures[0])
        text = _workflow_text()
        flowed = text.replace(
            "env:\n",
            "env: {BASH_ENV: /tmp/x}\n",
            1,
        )
        failures = check.workflow_failures(flowed)
        self.assertTrue(failures)
        self.assertIn("block mapping", " ".join(failures))

    def test_gate_job_container_fails(self):
        ci = CI.replace(
            "  changes:\n    runs-on: ubuntu-24.04\n",
            "  changes:\n    runs-on: ubuntu-24.04\n    container: ghcr.io/evil:latest\n",
            1,
        )
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("PR-selected container", failures[0])
        text = _workflow_text()
        contained = text.replace(
            "    if: github.event_name == 'pull_request_target'\n",
            "    if: github.event_name == 'pull_request_target'\n    container: ghcr.io/evil:latest\n",
            1,
        )
        failures = check.workflow_failures(contained)
        self.assertTrue(failures)
        self.assertIn("PR-selected container", " ".join(failures))

    def test_scalar_decoy_gate_fails(self):
        # A `name: |` scalar smuggling the pinned lines while the job calls
        # a reusable workflow must fail: the text is content, not steps.
        decoy = CI.replace(
            "      - name: Test capability register binding\n        uses: ./.github/actions/capability-gate\n",
            "      - uses: ./.github/workflows/attacker.yml\n        name: |\n          - name: Test capability register binding\n          uses: ./.github/actions/capability-gate\n",
            1,
        )
        failures = check.ci_failures(decoy)
        self.assertTrue(failures)
        called = CI.replace(
            "  changes:\n    runs-on: ubuntu-24.04\n",
            "  changes:\n    runs-on: ubuntu-24.04\n    uses: ./.github/workflows/attacker.yml\n",
            1,
        )
        failures = check.ci_failures(called)
        self.assertTrue(failures)
        self.assertIn("reusable workflow", " ".join(failures))

    def test_blank_line_does_not_end_scalar_scrub(self):
        # A blank line never ends a YAML block scalar: ending the scrub
        # there shows the checker structure GitHub reads as content.
        ci_checks = sys.modules["capability_gate_contract_ci_checks"]
        lines = [
            "        name: |",
            "          - name: Test capability register binding",
            "",
            "          uses: ./.github/actions/capability-gate",
        ]
        self.assertEqual(ci_checks._without_block_scalars(lines)[1:], ["", "", ""])
        # End to end, the blank-line decoy fails exactly like the plain one.
        blank = CI.replace(
            "      - name: Test capability register binding\n        uses: ./.github/actions/capability-gate\n",
            "      - uses: ./.github/workflows/attacker.yml\n        name: |\n          - name: Test capability register binding\n\n          uses: ./.github/actions/capability-gate\n",
            1,
        )
        self.assertEqual(check.ci_failures(blank), ["ci.yml must invoke the capability gate exactly once"])

    def test_escaped_branch_pattern_fails(self):
        # `"!m\\x61in"` decodes to `!main`: the later exclusion empties the
        # filter while the raw text still shows a main match.
        attacked = CI.replace(
            "  pull_request:\n",
            '  pull_request:\n    branches: [main, "!m\\x61in"]\n',
            1,
        )
        failures = check.ci_failures(attacked)
        self.assertTrue(failures)
        self.assertIn("main match", failures[0])
        plain_exclusion = CI.replace(
            "  pull_request:\n",
            '  pull_request:\n    branches: [main, "!main"]\n',
            1,
        )
        failures = check.ci_failures(plain_exclusion)
        self.assertTrue(failures)
        self.assertIn("main match", failures[0])


if __name__ == "__main__":
    unittest.main()
