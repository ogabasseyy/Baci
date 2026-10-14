"""Text checks for the capability-gate contract (no pins, pure parsing).

Companion to capability_gate_contract_check.py, which imports this module
from its own directory — including from the base-owned /tmp extraction, so
no repository layout is assumed. Everything here reads candidate text as
data; nothing here executes PR code.
"""
import fnmatch
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

def _norm(line):
    """Normalize YAML spacing without changing semantics: valid YAML permits
    whitespace before a mapping colon (``if : false`` is the same ``if``
    key), so structural patterns must tolerate it."""
    return re.sub(r"\s+:", ":", line.strip())


_JOB_HEADER = re.compile(r"^  [A-Za-z0-9_.\-]+\s*:")
_JOB_CONDITION = re.compile(r"^    (if|needs|continue-on-error)\s*:")
_NEXT_STEP = re.compile(r"^      -(\s|$)")
_TRIGGER_KEY = re.compile(r"^  ([A-Za-z_]+)\s*:\s*(.*)$")
_TRIGGER_SUBKEY = re.compile(r"^    ([A-Za-z_-]+)\s*:\s*(.*)$")
_TRIGGER_ITEM = re.compile(r"^      -\s(.*)$")


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
            if key == "types":
                # Any activity allowlist risks dropping events (e.g. types:
                # [opened] silences synchronize); the gate must run on all
                # of them, so the key must stay absent.
                failures.append(f"ci.yml must not narrow the {trig} trigger with types:")
            if key == "branches":
                branches = [rest] if rest.strip() else []
                j = idx + 1
                while j < end:
                    item = _TRIGGER_ITEM.match(lines[j])
                    if not item:
                        break
                    branches.append(item.group(1))
                    j += 1
                patterns = []
                for raw in branches:
                    for part in raw.strip().strip("[]").split(","):
                        cleaned = part.strip().strip("'\"")
                        if cleaned:
                            patterns.append(cleaned)
                if not any(fnmatch.fnmatchcase("main", pat) for pat in patterns):
                    failures.append(f"ci.yml must keep an exact main match in the {trig} branches:")
    return failures


def ci_failures(ci_text):
    """Exact invocation block bound to an unconditional executing job."""
    lines = ci_text.splitlines()
    failures = trigger_failures(ci_text)
    starts = [i for i, line in enumerate(lines) if _norm(line) == _norm(STEP_NAME_LINE)]
    if len(starts) != 1:
        return failures + ["ci.yml must invoke the capability gate exactly once"]
    start = starts[0]
    indent = len(lines[start]) - len(lines[start].lstrip())
    if indent != 6 or _norm(lines[start]) != _norm(STEP_NAME_LINE):
        return failures + ["capability gate step must use the pinned indentation"]
    headers = [i for i, line in enumerate(lines) if _JOB_HEADER.match(line)]
    job_start = max([i for i in headers if i < start], default=None)
    if job_start is None:
        return failures + ["capability gate step is not inside a workflow job"]
    later = [i for i in headers if i > start]
    job = lines[job_start : (later[0] if later else len(lines))]
    if any(_JOB_CONDITION.match(line) for line in job):
        return failures + ["capability gate job must stay unconditional (no job-level if:/needs:/continue-on-error:)"]
    # A checkout pinned to the base SHA would diff the base against itself
    # and skip the suite while the contract stays green.
    for line in lines[job_start:start]:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and re.match(r"^ref\s*:", stripped):
            return failures + ["capability gate checkout must not pin a ref (the gate diffs the PR candidate)"]
    code = []
    for line in lines[start + 1 :]:
        if _NEXT_STEP.match(line):
            break
        if line.strip() and not line.strip().startswith("#"):
            code.append(line)
    if (
        [_norm(line) for line in code] != [_norm(STEP_USES_LINE)]
        or any(len(line) - len(line.lstrip()) != 8 for line in code)
    ):
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
    if not any(re.match(r"^\s*pull_request_target\s*:", line) for line in code):
        failures.append("contract workflow must keep the pull_request_target trigger")
    if "contents: read" not in "\n".join(code):
        failures.append("contract workflow must stay read-only (contents: read)")
    if not any(line.strip() == "ref: ${{ github.event.pull_request.head.sha }}" for line in code):
        failures.append("contract workflow must check out the PR head (base ref would validate the base tree)")
    if not any(re.match(r"^\s*PINNED_CHECKER_SHA256:\s*[0-9a-f]{64}\s*$", line) for line in code):
        failures.append("contract workflow must declare its checker pin as a live entry (not a comment)")
    headers = [i for i, line in enumerate(code) if re.match(r"^  [A-Za-z0-9_.\-]+\s*:", line)]
    gate = next((i for i, line in enumerate(code) if re.match(r"^  gate-contract\s*:", line)), None)
    if gate is None:
        return failures + ["contract workflow must keep the gate-contract job"]
    later = [i for i in headers if i > gate]
    block = code[gate : (later[0] if later else len(code))]
    if any(re.match(r"^\s*permissions\s*:", line) for line in block):
        failures.append("contract workflow job must not override permissions")
    steps = [line for line in block if re.match(r"^      -(\s|$)", line)]
    if len(steps) != 2:
        return failures + [f"contract workflow job must keep exactly its two steps (found {len(steps)})"]
    runs = [i for i, line in enumerate(code) if re.match(r"^\s*run\s*:", line)]
    if len(runs) != 1:
        return failures + [f"contract workflow must have exactly one run step (found {len(runs)})"]
    if not re.match(r"^\s*run\s*:\s*\|\s*$", code[runs[0]]):
        return failures + ["contract workflow run step must stay a block run"]
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
