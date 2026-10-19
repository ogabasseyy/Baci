"""Round-21 adversarial parser regressions (stdlib only).

Quoted commas must not invent branch patterns, the CI push scope must be
exactly branches: [main], a top-level PATH is a startup preload, and block
scalars must not smuggle executable structure into the contract workflow.
"""
import importlib.util
import re
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
    branches: [main]
  pull_request:
    branches: [main]
  merge_group:
jobs:
  changes:
    runs-on: ubuntu-24.04
    steps:
      - name: Test capability register binding
        uses: ./.github/actions/capability-gate
      - uses: other/action@v1
"""

# The pinned gate steps hidden in a job-level scalar while the real steps
# run a no-op: `|2-` spells the indent indicator after the chomping flag.
CONCURRENCY_DECOY = """    concurrency: |2-
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      with:
      ref: ${{ github.event.pull_request.head.sha }}
      fetch-depth: 1
      persist-credentials: false
      allow-unsafe-pr-checkout: true
      - name: Gate
        run: |
          if [ -n "${{ github.event.pull_request.head.sha }}" ]; then
          rm -rf /tmp/cg-check && mkdir -p /tmp/cg-check
          git fetch --no-tags --depth 1 origin "${{ github.base_ref }}"
          git archive FETCH_HEAD .github/scripts/capability_gate_contract_check.py .github/scripts/capability_gate_contract_ci_checks.py .github/scripts/capability_gate_contract_workflow_checks.py | tar -x -C /tmp/cg-check
          CHECKER=/tmp/cg-check/.github/scripts/capability_gate_contract_check.py
          else
          CHECKER=.github/scripts/capability_gate_contract_check.py
          fi
          python3 "$CHECKER" "$PINNED_CHECKER_SHA256"
    steps: [{ run: "exit 0" }]
"""


def _workflow_text():
    repo = Path(__file__).resolve().parents[2]
    workflow = repo / ".github/workflows/capability-gate-contract.yml"
    if not workflow.exists():
        raise unittest.SkipTest("contract workflow unavailable")
    return workflow.read_text()


class ContractAdversarialTests(unittest.TestCase):
    def test_quoted_comma_branch_does_not_invent_main(self):
        # branches: ["never,main"] is one quoted scalar: YAML and GitHub
        # read it as the single pattern `never,main`, which never matches.
        for trigger in ("push", "pull_request"):
            anchor = f"  {trigger}:\n    branches: [main]\n"
            ci = CI.replace(anchor, anchor.replace("[main]", '["never,main"]'), 1)
            self.assertNotEqual(ci, CI)
            failures = check.ci_failures(ci)
            self.assertTrue(failures, trigger)
            self.assertIn("main", failures[0])
        text = _workflow_text().replace("    branches: [main]", '    branches: ["never,main"]', 1)
        failures = check.workflow_failures(text)
        self.assertTrue(failures)
        self.assertTrue(any("push" in f for f in failures))

    def test_ci_push_scope_must_be_exactly_main(self):
        # Extra or wildcard branches mint Quality Gate contexts for branch
        # SHAs, so inclusion is not enough: the scope must be exactly main.
        for branches in ("[main, attacker]", "['*']", "[other]"):
            ci = CI.replace("    branches: [main]\n", f"    branches: {branches}\n", 1)
            failures = check.ci_failures(ci)
            self.assertTrue(failures, branches)
            self.assertTrue(any("push" in f for f in failures))
        bare = CI.replace("  push:\n    branches: [main]\n", "  push:\n", 1)
        self.assertNotEqual(bare, CI)
        self.assertTrue(check.ci_failures(bare))

    def test_top_level_path_preload_fails(self):
        # A workflow-level PATH routes the gate's python3 through a
        # PR-controlled directory, so an exit-zero shim bypasses the suite.
        ci = "env:\n  PATH: /tmp/payload:/usr/bin:/bin\n" + CI
        failures = check.ci_failures(ci)
        self.assertTrue(failures)
        self.assertIn("PATH", failures[0])

    def test_checkout_with_block_must_match_exactly(self):
        # A `repository:` entry redirects the pre-gate checkout to an
        # attacker workspace whose local action replaces the real gate.
        checkout = (
            "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n"
            "        with:\n"
            "          fetch-depth: 0\n"
            "          persist-credentials: false\n"
        )
        ci = CI.replace(
            "      - name: Test capability register binding\n",
            checkout + "      - name: Test capability register binding\n",
            1,
        )
        self.assertNotEqual(ci, CI)
        self.assertEqual(check.ci_failures(ci), [])
        evil = ci.replace(
            "          persist-credentials: false\n",
            "          persist-credentials: false\n          repository: attacker/gate-bypass\n",
            1,
        )
        failures = check.ci_failures(evil)
        self.assertTrue(failures)
        self.assertIn("with block", failures[0])

    def test_anchor_decorated_condition_fails(self):
        # YAML resolves `&skip if:` to the plain `if` key, so GitHub skips
        # the job while `^if:` line scans see only an anchor prefix.
        anchored = CI.replace(
            "  changes:\n    runs-on:",
            "  changes:\n    &skip if: false\n    runs-on:",
            1,
        )
        self.assertNotEqual(anchored, CI)
        failures = check.ci_failures(anchored)
        self.assertTrue(failures)
        self.assertIn("anchor", failures[0])
        merged = CI.replace(
            "  changes:\n    runs-on:",
            "  changes:\n    <<: *off\n    runs-on:",
            1,
        )
        self.assertTrue(check.ci_failures(merged))

    def test_startup_env_covers_shell_functions_and_user_site(self):
        # Bash imports BASH_FUNC_python3%% as a function and Python's site
        # initialization respects PYTHONUSERBASE: both must fail top-level.
        for key, value in (
            ("BASH_FUNC_python3%%", "'() { return 0; }'"),
            ("PYTHONUSERBASE", "/tmp/x"),
        ):
            ci = "env:\n  %s: %s\n" % (key, value) + CI
            failures = check.ci_failures(ci)
            self.assertTrue(failures, key)
            self.assertIn("startup code", failures[0])

    def test_explicit_env_key_form_fails(self):
        # YAML's `? env` explicit key is still the env mapping to GitHub
        # but invisible to `^env:` line scans: BASH_ENV would preload a
        # workspace shim before the pinned run block.
        text = _workflow_text()
        pin = re.search(r"PINNED_CHECKER_SHA256: ([0-9a-f]{64})", text).group(1)
        smuggled = text.replace("env:\n  # Baseline hash", "? env\n:\n  BASH_ENV: attacker.sh\n  # Baseline hash", 1)
        smuggled = smuggled.replace(
            "  gate-contract:\n",
            "  gate-contract:\n    env:\n      PINNED_CHECKER_SHA256: %s\n" % pin,
            1,
        )
        self.assertNotEqual(smuggled, text)
        failures = check.workflow_failures(smuggled)
        self.assertTrue(failures)
        self.assertIn("explicit YAML key", failures[0])

    def test_indented_scalar_header_does_not_hide_steps(self):
        # The pinned text inside `concurrency: |2-` is scalar content while
        # the flow-style steps run `exit 0`: no violation may be reported.
        text = _workflow_text()
        head, _, tail = text.partition("    steps:")
        _, _, rest = tail.partition("  gate-attestation:")
        smuggled = head + CONCURRENCY_DECOY + "  gate-attestation:" + rest
        self.assertNotEqual(smuggled, text)
        self.assertTrue(check.workflow_failures(smuggled))


if __name__ == "__main__":
    unittest.main()
