"""Text checks for the capability-gate contract (no pins, pure parsing).

Companion to capability_gate_contract_check.py, which imports this module
from its own directory — including from the base-owned /tmp extraction, so
no repository layout is assumed. Everything here reads candidate text as
data; nothing here executes PR code.
"""
import re

CI_YML = ".github/workflows/ci.yml"
CHECKER = ".github/scripts/capability_gate_contract_check.py"
WORKFLOW = ".github/workflows/capability-gate-contract.yml"

STEP_NAME_LINE = "      - name: Test capability register binding"
STEP_USES_LINE = "        uses: ./.github/actions/capability-gate"

# The contract workflow's run block, stripped per line. Any edit — an added
# step, a dropped fetch, head-owned execution — fails workflow_failures
# until this expectation is updated alongside it (a declared checker change).
EXPECTED_RUN = [
    'if [ -n "${{ github.event.pull_request.head.sha }}" ]; then',
    "rm -rf /tmp/cg-check && mkdir -p /tmp/cg-check",
    'git fetch --no-tags --depth 1 origin "${{ github.base_ref }}"',
    "git archive FETCH_HEAD .github/scripts/capability_gate_contract_check.py .github/scripts/capability_gate_contract_text_checks.py | tar -x -C /tmp/cg-check",
    "CHECKER=/tmp/cg-check/.github/scripts/capability_gate_contract_check.py",
    "else",
    "CHECKER=.github/scripts/capability_gate_contract_check.py",
    "fi",
    'python3 "$CHECKER" "$PINNED_CHECKER_SHA256"',
]

_JOB_HEADER = re.compile(r"^  [A-Za-z0-9_.\-]+:")
_JOB_CONDITION = re.compile(r"^    (if|needs|continue-on-error):")
_NEXT_STEP = re.compile(r"^      - ")
_TRIGGER_KEY = re.compile(r"^  ([A-Za-z_]+):\s*(.*)$")
_TRIGGER_SUBKEY = re.compile(r"^    ([A-Za-z_-]+):\s*(.*)$")
_TRIGGER_ITEM = re.compile(r"^      - (.*)$")


def trigger_failures(ci_text):
    """The gate must stay wired to the events that need it, unnarrowed.

    Key presence alone is not enough: keeping ``pull_request`` while
    retargeting its branches or adding path filters silences the gate for
    main PRs without touching the asserted step block. Commented lines
    never fire, so they cannot satisfy the check.
    """
    lines = ci_text.splitlines()
    try:
        on = next(i for i, line in enumerate(lines) if line == "on:")
    except StopIteration:
        return ["ci.yml must declare workflow triggers"]
    end = len(lines)
    for i in range(on + 1, len(lines)):
        line = lines[i]
        if line and not line[0].isspace() and not line.startswith("#"):
            end = i
            break
    keys = set()
    subs = {}
    current = None
    for i in range(on + 1, end):
        line = lines[i]
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        key = _TRIGGER_KEY.match(line)
        if key:
            current = key.group(1)
            keys.add(current)
            subs[current] = []
            continue
        sub = _TRIGGER_SUBKEY.match(line)
        if sub and current is not None:
            subs[current].append((sub.group(1), sub.group(2), i))
    failures = [f"ci.yml must keep the {name} trigger" for name in sorted({"push", "pull_request"} - keys)]
    for trig in ("push", "pull_request"):
        for key, rest, idx in subs.get(trig, []):
            if key in ("paths", "paths-ignore", "branches-ignore"):
                failures.append(f"ci.yml must not narrow the {trig} trigger with {key}:")
            if key == "branches":
                branches = [rest] if rest.strip() else []
                j = idx + 1
                while j < end:
                    item = _TRIGGER_ITEM.match(lines[j])
                    if not item:
                        break
                    branches.append(item.group(1))
                    j += 1
                if not any("main" in branch for branch in branches):
                    failures.append(f"ci.yml must keep main in the {trig} branches:")
    return failures


def ci_failures(ci_text):
    """Exact invocation block bound to an unconditional executing job."""
    lines = ci_text.splitlines()
    failures = trigger_failures(ci_text)
    starts = [i for i, line in enumerate(lines) if line.strip() == STEP_NAME_LINE.strip()]
    if len(starts) != 1:
        return failures + ["ci.yml must invoke the capability gate exactly once"]
    start = starts[0]
    if lines[start] != STEP_NAME_LINE:
        return failures + ["capability gate step must use the pinned indentation"]
    headers = [i for i, line in enumerate(lines) if _JOB_HEADER.match(line)]
    job_start = max([i for i in headers if i < start], default=None)
    if job_start is None:
        return failures + ["capability gate step is not inside a workflow job"]
    later = [i for i in headers if i > start]
    job = lines[job_start : (later[0] if later else len(lines))]
    if any(_JOB_CONDITION.match(line) for line in job):
        return failures + ["capability gate job must stay unconditional (no job-level if:/needs:/continue-on-error:)"]
    code = []
    for line in lines[start + 1 :]:
        if _NEXT_STEP.match(line):
            break
        if line.strip() and not line.strip().startswith("#"):
            code.append(line)
    if code != [STEP_USES_LINE]:
        return failures + ["capability gate invocation must be exactly the pinned block"]
    return failures


def workflow_failures(workflow_text):
    """The contract workflow must keep executing base-owned logic, exactly.

    Substring markers can hide in comments or dead steps, so the single run
    block is compared line for line: an added executable step, a dropped
    fetch, or head-owned execution all fail. The workflow also stays
    read-only and keeps its pull_request_target trigger.
    """
    code = [line for line in workflow_text.splitlines() if line.strip() and not line.strip().startswith("#")]
    failures = []
    if not any(re.match(r"^\s*pull_request_target:", line) for line in code):
        failures.append("contract workflow must keep the pull_request_target trigger")
    if "contents: read" not in "\n".join(code):
        failures.append("contract workflow must stay read-only (contents: read)")
    runs = [i for i, line in enumerate(code) if re.match(r"^\s*run:\s*\|\s*$", line)]
    if len(runs) != 1:
        return failures + [f"contract workflow must have exactly one run step (found {len(runs)})"]
    indent = len(code[runs[0]]) - len(code[runs[0]].lstrip())
    body = []
    for line in code[runs[0] + 1 :]:
        stripped = line.strip()
        if len(line) - len(line.lstrip()) <= indent:
            break
        body.append(stripped)
    if body != EXPECTED_RUN:
        failures.append("contract workflow run block must stay exactly the pinned base-owned sequence")
    return failures
