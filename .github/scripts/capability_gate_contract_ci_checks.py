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
SUITE_DIR = "vps-workers/baci-editorial-context"

STEP_NAME_LINE = "      - name: Test capability register binding"
STEP_USES_LINE = "        uses: ./.github/actions/capability-gate"

def _on_block_subs(lines):
    """Parse an on: block into ({trigger: [(subkey, rest, line_idx)]}, end)."""
    try:
        on = next(i for i, line in enumerate(lines) if line == "on:")
    except StopIteration:
        return None, 0
    end = len(lines)
    for i in range(on + 1, len(lines)):
        line = lines[i]
        if line and not line[0].isspace() and not line.startswith("#"):
            end = i
            break
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
            subs[current] = []
            continue
        sub = _TRIGGER_SUBKEY.match(line)
        if sub and current is not None:
            subs[current].append((sub.group(1), sub.group(2), i))
    return subs, end


def _ordered_branch_match(subs, trig, lines, end):
    """Ordered GitHub glob evaluation; None when no branches key is present
    (unfiltered matches everything). A later !pattern excludes main even
    after an earlier positive hit."""
    if "branches" not in [k for k, _, _ in subs.get(trig, [])]:
        return None
    matched = False
    for key, rest, idx in subs.get(trig, []):
        if key != "branches":
            continue
        pats = [rest] if rest.strip() else []
        j = idx + 1
        while j < end:
            item = _TRIGGER_ITEM.match(lines[j])
            if not item:
                break
            pats.append(item.group(1))
            j += 1
        for raw in pats:
            for part in _strip_comment(raw).strip().strip("[]").split(","):
                pat = part.strip().strip("'\"")
                if not pat:
                    continue
                if pat.startswith("!"):
                    if fnmatch.fnmatchcase("main", pat[1:]):
                        matched = False
                elif fnmatch.fnmatchcase("main", pat):
                    matched = True
    return matched


def _norm(line):
    """Normalize YAML spacing without changing semantics: valid YAML permits
    whitespace before a mapping colon (``if : false`` is the same ``if``
    key), so structural patterns must tolerate it."""
    return re.sub(r"\s+:", ":", line.strip())


def _strip_comment(value):
    """Cut a trailing YAML comment: '#' starts one outside quotes when it
    begins the value or follows whitespace (a quoted '#' stays literal)."""
    in_single = in_double = False
    for i, ch in enumerate(value):
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif ch == "#" and not in_single and not in_double and (i == 0 or value[i - 1] in " \t"):
            return value[:i]
    return value


_JOB_HEADER = re.compile(r"^  [A-Za-z0-9_.\-]+\s*:")
_JOB_CONDITION = re.compile(r"^    [\"']?(if|needs|continue-on-error)[\"']?\s*:")
EXPECTED_PRECEDING_CHECKOUT = "- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1"
# Interpreter/shell startup preloads: inheriting one of these at workflow
# scope runs PR-controlled code before the gate's python3 starts.
_STARTUP_ENV = frozenset({
    "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "BASH_ENV", "ENV",
    "LD_PRELOAD", "NODE_OPTIONS", "JAVA_TOOL_OPTIONS", "PERL5LIB",
    "PERLLIB", "RUBYLIB", "RUBYOPT",
})
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
    subs, end = _on_block_subs(lines)
    if subs is None:
        return ["ci.yml must declare workflow triggers"]
    failures = [f"ci.yml must keep the {name} trigger" for name in sorted({"push", "pull_request", "merge_group"} - set(subs))]
    try:
        on_at = next(i for i, line in enumerate(lines) if line == "on:")
    except StopIteration:
        on_at = None
    if on_at is not None:
        for line in lines[on_at + 1 : end]:
            inline = re.match(r"^  (push|pull_request|merge_group)\s*:\s*(.*)$", line)
            if inline and _strip_comment(inline.group(2)).strip():
                failures.append(f"ci.yml must not carry inline {inline.group(1)} trigger filters:")
    for trig in ("push", "pull_request", "merge_group"):
        for key, rest, idx in subs.get(trig, []):
            if key in ("paths", "paths-ignore", "branches-ignore"):
                failures.append(f"ci.yml must not narrow the {trig} trigger with {key}:")
            if key == "types":
                # Any activity allowlist risks dropping events (e.g. types:
                # [opened] silences synchronize); the gate must run on all
                # of them, so the key must stay absent.
                failures.append(f"ci.yml must not narrow the {trig} trigger with types:")
        if _ordered_branch_match(subs, trig, lines, end) is False:
            failures.append(f"ci.yml must keep an exact main match in the {trig} branches:")
    return failures


def ci_failures(ci_text):
    """Exact invocation block bound to an unconditional executing job."""
    lines = ci_text.splitlines()
    failures = trigger_failures(ci_text)
    # Top-level env inherits into every job including the gate: a PR-added
    # startup variable preloads code before the gate runs.
    try:
        top = next(i for i, line in enumerate(lines) if line == "env:")
    except StopIteration:
        top = None
    if top is not None:
        for line in lines[top + 1 :]:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if not line.startswith("  ") or line.startswith("   "):
                break
            if stripped.split(":")[0] in _STARTUP_ENV:
                failures.append(f"ci.yml top-level env must not preload startup code ({stripped.split(':')[0]})")
                break
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
    # PR-controlled code must not run before the gate: a preceding step
    # could overwrite the checked-out gate code, which then runs while the
    # contract (separate checkout) still sees pristine files. Only the exact
    # pinned checkout may precede it — a local action runs PR code the same
    # way a run: step does. Startup environments are rejected too: job- or
    # step-level env can preload PR code (PYTHONPATH/sitecustomize, BASH_ENV)
    # before the gate's python3 starts.
    for line in lines[job_start:start]:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if re.match(r"^-\s+uses\s*:", stripped):
            if stripped != EXPECTED_PRECEDING_CHECKOUT:
                return failures + ["only the pinned checkout may precede the capability gate"]
            continue
        if re.match(r"^run\s*:", stripped):
            return failures + ["no PR-controlled steps may precede the capability gate"]
        if re.match(r"^env\s*:", stripped):
            return failures + ["capability gate job must not set environment (startup injection)"]
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
