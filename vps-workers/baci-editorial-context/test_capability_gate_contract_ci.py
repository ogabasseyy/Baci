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
  merge_group:
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
  merge_group:
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

    def test_ordered_negative_branch_excludes_main(self):
        # GitHub evaluates branch patterns in order: a later !main excludes
        # main even after an earlier * match, so any-positive matching
        # would wrongly pass this silenced gate.
        ci = CI.replace(
            "  pull_request:\n", "  pull_request:\n    branches: ['*', '!main']\n", 1
        )
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("main", failures[0])

    def test_types_narrowing_fails(self):
        # types: [opened] drops synchronize updates — the PR pushes most
        # likely to touch cited sources after initial review.
        typed = CI.replace(
            "  pull_request:\n", "  pull_request:\n    types: [opened]\n", 1
        )
        failures = check.ci_failures(typed)
        self.assertTrue(failures)
        self.assertIn("types", failures[0])

    def test_branch_substring_does_not_match_main(self):
        # GitHub matches globs, not substrings: [domain] and [not-main]
        # contain "main" but never match the main branch.
        for branches in ("[domain]", "[not-main]"):
            ci = CI.replace("  pull_request:\n", f"  pull_request:\n    branches: {branches}\n", 1)
            failures = check.ci_failures(ci)
            self.assertTrue(failures, branches)
            self.assertIn("main", failures[0])
        wildcard = CI.replace("  pull_request:\n", "  pull_request:\n    branches: ['*']\n", 1)
        self.assertEqual(check.ci_failures(wildcard), [])

    def test_pinned_checkout_ref_fails(self):
        ci = CI.replace(
            "      - name: Test capability register binding\n",
            "      - uses: actions/checkout@v4\n        with:\n          ref: ${{ github.event.pull_request.base.sha }}\n      - name: Test capability register binding\n",
            1,
        )
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("must not pin a ref", failures[0])

    def test_pre_gate_run_step_fails(self):
        # A PR-controlled script before the gate could overwrite the
        # checked-out gate code, which then runs while the contract's
        # separate checkout still sees pristine files.
        ci = CI.replace(
            "      - name: Test capability register binding\n",
            "      - name: Early script\n        run: echo hi\n      - name: Test capability register binding\n",
            1,
        )
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("precede", failures[0])

    def test_merge_group_presence_and_scope(self):
        # merge_group keeps the quality gate running on merge-queue
        # integration commits; dropping or narrowing it strands the queue.
        failures = check.ci_failures(CI.replace("  merge_group:\n", "", 1))
        self.assertTrue(failures)
        self.assertIn("merge_group", failures[0])
        narrowed = CI.replace(
            "  merge_group:\n", "  merge_group:\n    types: [opened]\n", 1
        )
        failures = check.ci_failures(narrowed)
        self.assertTrue(failures)
        self.assertIn("types", failures[0])

    def test_inline_trigger_filters_fail(self):
        # Flow-style mappings on the trigger line are invisible to the
        # subkey parser: pull_request: {branches: [never]} would silence
        # the gate for main PRs while the key stays present.
        inline = CI.replace(
            "  pull_request:\n", "  pull_request: {branches: [never]}\n", 1
        )
        failures = check.ci_failures(inline)
        self.assertTrue(failures)
        self.assertIn("inline", failures[0])

    def test_commented_branch_pattern_does_not_match(self):
        # `branches: [never] #, main` filters to never: main comes from the
        # YAML comment and must not count as a pattern.
        ci = CI.replace(
            "  pull_request:\n  merge_group:\n",
            "  pull_request:\n    branches: [never] #, main\n  merge_group:\n",
            1,
        )
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("main", failures[0])

    def test_quoted_hash_pattern_stays_literal(self):
        # A '#' inside quotes is a literal pattern character, not a
        # comment: ["#main", main] still matches main.
        ci = CI.replace(
            "  pull_request:\n  merge_group:\n",
            '  pull_request:\n    branches: ["#main", main]\n  merge_group:\n',
            1,
        )
        self.assertEqual(check.ci_failures(ci), [])

    def test_pre_gate_local_action_fails(self):
        # A local uses: step runs PR code before the gate exactly like a
        # run: step does — only the pinned checkout may precede it.
        ci = CI.replace(
            "      - name: Test capability register binding\n",
            "      - uses: ./tools/evil-action\n      - name: Test capability register binding\n",
            1,
        )
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("only the pinned checkout", failures[0])

    def test_swapped_checkout_pin_fails(self):
        # Swapping the checkout action itself runs attacker code before
        # the gate while the step layout still looks intact.
        ci = CI.replace(
            "      - name: Test capability register binding\n",
            "      - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"
            "      - name: Test capability register binding\n",
            1,
        )
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("only the pinned checkout", failures[0])

    def test_pinned_checkout_before_gate_passes(self):
        # The real ci.yml shape (exact checkout, then the gate) stays
        # green: the preceding-step pin must not false-positive.
        ci = CI.replace(
            "      - name: Test capability register binding\n",
            "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n"
            "        with:\n          fetch-depth: 0\n          persist-credentials: false\n"
            "      - name: Test capability register binding\n",
            1,
        )
        self.assertEqual(check.ci_failures(ci), [])

    def test_top_level_startup_env_fails(self):
        # Top-level env inherits into the gate job: a PR-added PYTHONPATH
        # preloads sitecustomize before the gate's python3 starts.
        ci = CI.replace(
            "  merge_group:\n",
            "  merge_group:\n\nenv:\n  PYTHONPATH: /tmp/payload\n",
            1,
        )
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("startup code", failures[0])

    def test_gate_job_env_fails(self):
        # Job-level env preloads PR code into every step: PYTHONPATH brings
        # sitecustomize, BASH_ENV is sourced by bash before the gate runs.
        ci = CI.replace(
            "  changes:\n    runs-on: ubuntu-24.04\n",
            "  changes:\n    runs-on: ubuntu-24.04\n    env:\n      PYTHONPATH: ${{ github.workspace }}/payload\n",
            1,
        )
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("environment", failures[0])

    def test_fake_comment_cannot_satisfy(self):
        ci = """on:
  push:
  pull_request:
  merge_group:
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
