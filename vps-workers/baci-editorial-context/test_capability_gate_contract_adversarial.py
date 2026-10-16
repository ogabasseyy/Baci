"""Round-21 adversarial parser regressions (stdlib only).

Quoted commas must not invent branch patterns, the CI push scope must be
exactly branches: [main], a top-level PATH is a startup preload, and block
scalars must not smuggle executable structure into the contract workflow.
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
