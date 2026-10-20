"""Contract-workflow structure tests (stdlib only).

Split from test_capability_gate_contract.py to hold the 300-line limit:
the gate-contract workflow's own triggers, job, steps, and run block
live here.
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


def _workflow_text():
    repo = Path(__file__).resolve().parents[2]
    workflow = repo / ".github/workflows/capability-gate-contract.yml"
    if not workflow.exists():
        raise unittest.SkipTest("contract workflow unavailable")
    return workflow.read_text()


class ContractWorkflowTests(unittest.TestCase):
    def test_workflow_must_keep_base_owned_execution(self):
        text = _workflow_text()
        self.assertEqual(check.workflow_failures(text), [])
        dropped = text.replace(
            "            git archive FETCH_HEAD .github/scripts/capability_gate_contract_check.py .github/scripts/capability_gate_contract_ci_checks.py .github/scripts/capability_gate_contract_workflow_checks.py | tar -x -C /tmp/cg-check\n", ""
        )
        self.assertNotEqual(dropped, text)
        self.assertTrue(check.workflow_failures(dropped))

    def test_extra_run_step_fails(self):
        text = _workflow_text()
        extra = text.replace(
            '          python3 "$CHECKER" "$PINNED_CHECKER_SHA256"\n',
            '          python3 "$CHECKER" "$PINNED_CHECKER_SHA256"\n      - name: Extra\n        run: |\n          echo hijack\n',
            1,
        )
        self.assertNotEqual(extra, text)
        failures = check.workflow_failures(extra)
        self.assertTrue(failures)
        self.assertIn("exactly its two steps", failures[0])

    def test_markers_only_as_comments_fail(self):
        text = _workflow_text()
        # Comment every line containing a marker.
        commented = "\n".join(
            ("# " + line if ("git archive FETCH_HEAD" in line or 'python3 "$CHECKER"' in line) else line)
            for line in text.splitlines()
        )
        self.assertNotEqual(commented, text)
        self.assertTrue(check.workflow_failures(commented))

    def test_contract_trigger_removal_fails(self):
        text = _workflow_text()
        dropped = text.replace("  pull_request_target:\n", "", 1)
        self.assertNotEqual(dropped, text)
        self.assertTrue(check.workflow_failures(dropped))

    def test_echoed_markers_fail(self):
        # Executable echoes of the marker strings still change the run
        # block, so the exact-sequence match must reject them.
        text = _workflow_text()
        echoed = text.replace(
            '          python3 "$CHECKER" "$PINNED_CHECKER_SHA256"\n',
            '          echo \'git archive FETCH_HEAD\'\n          python3 "$CHECKER" "$PINNED_CHECKER_SHA256"\n',
            1,
        )
        self.assertNotEqual(echoed, text)
        self.assertTrue(check.workflow_failures(echoed))

    def test_commented_checker_pin_fails(self):
        text = _workflow_text()
        commented = text.replace(
            "  PINNED_CHECKER_SHA256:", "  # PINNED_CHECKER_SHA256:", 1
        )
        self.assertNotEqual(commented, text)
        self.assertIsNone(check.declared_checker_pin(commented))
        self.assertTrue(check.workflow_failures(commented))

    def test_extra_uses_step_and_permissions_fail(self):
        text = _workflow_text()
        extra = text.replace(
            '          python3 "$CHECKER" "$PINNED_CHECKER_SHA256"\n',
            '          python3 "$CHECKER" "$PINNED_CHECKER_SHA256"\n      - uses: evil/action@v1\n',
            1,
        )
        failures = check.workflow_failures(extra)
        self.assertTrue(failures)
        self.assertIn("exactly its two steps", failures[0])
        with_perms = text.replace(
            "    name: Capability Gate Contract\n",
            "    name: Capability Gate Contract\n    permissions:\n      contents: write\n",
            1,
        )
        failures = check.workflow_failures(with_perms)
        self.assertTrue(failures)
        self.assertIn("must not override permissions", failures[0])

    def test_disabled_contract_job_fails(self):
        # A job-level gate skips the guard while the shell block stays
        # byte-identical, so conditions are asserted separately.
        text = _workflow_text()
        disabled = text.replace(
            "    name: Capability Gate Contract\n",
            "    name: Capability Gate Contract\n    if: false\n",
            1,
        )
        self.assertNotEqual(disabled, text)
        failures = check.workflow_failures(disabled)
        self.assertTrue(failures)
        self.assertIn("safe event", failures[0])

    def test_narrowed_contract_trigger_fails(self):
        text = _workflow_text()
        narrowed = text.replace(
            "    types: [opened, synchronize, reopened, edited]\n",
            "    types: [opened]\n",
            1,
        )
        self.assertNotEqual(narrowed, text)
        failures = check.workflow_failures(narrowed)
        self.assertTrue(failures)
        self.assertIn("full pull_request_target types", failures[0])

    def test_misplaced_head_ref_fails(self):
        # The required ref text kept under the checkout step's env while
        # with.ref points at the base would validate the base tree.
        text = _workflow_text()
        decoy = text.replace(
            "          ref: ${{ github.event.pull_request.head.sha }}\n",
            "          ref: ${{ github.event.pull_request.base.sha }}\n",
            1,
        )
        decoy = decoy.replace(
            "          persist-credentials: false\n",
            "          persist-credentials: false\n        env:\n          ref: ${{ github.event.pull_request.head.sha }}\n",
            1,
        )
        failures = check.workflow_failures(decoy)
        self.assertTrue(failures)
        self.assertIn("pinned data-only checkout", failures[0])

    def test_step_scoped_pin_fails(self):
        # Step env never reaches the sibling run step: the baseline would
        # arrive empty and any later checker change would self-declare.
        text = _workflow_text()
        moved = text.replace(
            "  PINNED_CHECKER_SHA256:", "  # PINNED_CHECKER_SHA256:", 1
        )
        moved = moved.replace(
            "          persist-credentials: false\n",
            "          persist-credentials: false\n        env:\n          PINNED_CHECKER_SHA256: 0\n",
            1,
        )
        self.assertNotEqual(moved, text)
        failures = check.workflow_failures(moved)
        self.assertTrue(failures)
        self.assertIn("where it propagates", failures[0])

    def test_replaced_first_step_fails(self):
        text = _workflow_text()
        swapped = text.replace(
            "        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n",
            "        uses: evil/action@v1\n",
            1,
        )
        failures = check.workflow_failures(swapped)
        self.assertTrue(failures)
        self.assertIn("pinned data-only checkout", failures[0])

    def test_permissions_decoy_fails(self):
        text = _workflow_text()
        deceptive = text.replace(
            "  contents: read\n",
            "  contents: read\n  write-all: true\n",
            1,
        )
        failures = check.workflow_failures(deceptive)
        self.assertTrue(failures)
        self.assertIn("exactly read-only", failures[0])

    def test_extra_job_fails(self):
        text = _workflow_text()
        evil = text + (
            "\n  evil-job:\n    runs-on: ubuntu-24.04\n"
            "    steps:\n      - uses: evil/action@v1\n"
        )
        failures = check.workflow_failures(evil)
        self.assertTrue(failures)
        self.assertIn("exactly its guard jobs", failures[0])

    def test_swapped_job_conditions_fail(self):
        text = _workflow_text()
        swapped = text.replace(
            "    if: github.event_name == 'pull_request_target'\n",
            "    if: github.event_name == 'push'\n",
            1,
        )
        failures = check.workflow_failures(swapped)
        self.assertTrue(failures)
        self.assertIn("safe event", failures[0])

    def test_inline_run_step_fails(self):
        text = _workflow_text()
        inline = text.replace(
            '          python3 "$CHECKER" "$PINNED_CHECKER_SHA256"\n',
            '          python3 "$CHECKER" "$PINNED_CHECKER_SHA256"\n        run: echo hi\n',
            1,
        )
        failures = check.workflow_failures(inline)
        self.assertTrue(failures)
        self.assertIn("exactly one run step", failures[0])

    def test_quoted_conditions_fail(self):
        # "if": false is the same key as if: false and must not slip past.
        text = _workflow_text()
        quoted_step = text.replace(
            "        run: |\n",
            '        "if": false\n        run: |\n',
            1,
        )
        failures = check.workflow_failures(quoted_step)
        self.assertTrue(failures)
        self.assertIn("unconditional", " ".join(failures))
        quoted_job = text.replace(
            "    if: github.event_name == 'pull_request_target'\n",
            '    "if": false\n',
            1,
        )
        failures = check.workflow_failures(quoted_job)
        self.assertTrue(failures)
        self.assertIn("safe event", " ".join(failures))

    def test_swapped_or_dropped_job_names_fail(self):
        # Required checks are named by job name and ignore triggers, while
        # skipped jobs report success: a name swap lets the push-only
        # attestation satisfy the guard's required context.
        text = _workflow_text()
        swapped = text.replace(
            "    name: Capability Gate Contract\n",
            "    name: Capability Gate Contract Attestation\n",
            1,
        )
        failures = check.workflow_failures(swapped)
        self.assertTrue(failures)
        self.assertIn("status name", " ".join(failures))
        dropped = text.replace("    name: Capability Gate Contract\n", "", 1)
        failures = check.workflow_failures(dropped)
        self.assertTrue(failures)
        self.assertIn("status name", " ".join(failures))

    def test_attestation_rewrite_fails(self):
        text = _workflow_text()
        weakened = text.replace(
            'run: python3 .github/scripts/capability_gate_contract_check.py "$PINNED_CHECKER_SHA256"\n',
            "run: echo attested\n",
            1,
        )
        failures = check.workflow_failures(weakened)
        self.assertTrue(failures)
        self.assertIn("attestation", " ".join(failures))

    def test_startup_environments_fail(self):
        # BASH_ENV is sourced by bash and PYTHONPATH preloads
        # sitecustomize before the base-owned checker starts.
        text = _workflow_text()
        bashed = text.replace(
            "    timeout-minutes: 5\n    steps:\n      # Reviewed: head is contract-check DATA only, never executed; the",
            "    timeout-minutes: 5\n    env:\n      BASH_ENV: /tmp/payload.sh\n    steps:\n      # Reviewed: head is contract-check DATA only, never executed; the",
            1,
        )
        failures = check.workflow_failures(bashed)
        self.assertTrue(failures)
        self.assertIn("env", " ".join(failures))
        pathed = text.replace(
            '        run: |\n',
            '        env:\n          PYTHONPATH: ${{ github.workspace }}/payload\n        run: |\n',
            1,
        )
        failures = check.workflow_failures(pathed)
        self.assertTrue(failures)
        self.assertIn("env", " ".join(failures))
        topped = text.replace("env:\n", "env:\n  BASH_ENV: /tmp/payload.sh\n", 1)
        failures = check.workflow_failures(topped)
        self.assertTrue(failures)
        self.assertIn("only the checker pin", " ".join(failures))

if __name__ == "__main__":
    unittest.main()
