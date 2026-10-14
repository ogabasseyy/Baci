"""Base-owned capability-gate contract check.

Runs from the BASE revision (see capability-gate-contract.yml) and only
EVER reads PR-head files as data — it hashes and parses them, never imports
or executes them — so a PR that weakens enforcement cannot silence this
guard by editing the running copy.

Two guarantees:

1. Invocation: ci.yml must contain the gate step exactly once, as the exact
   pinned two-line block, inside a job with no job-level ``if:``/``needs:``.
   A crafted comment can neither satisfy the match (comments never execute)
   nor hide an extra key, and moving the block into a never-running job
   fails the job-condition assertion even though the block bytes match.

2. Declared pins: BASE_PINS records the last-reviewed sha256 of every
   enforcement file (the composite action, the gate and its helpers, the
   digest/runtime modules, and the suite files that produce the verdict).
   An unchanged file passes silently. A changed file passes only when the
   PR-head copy of THIS file declares the new hash — the weakening is then a
   visible, reviewable diff, never silent. A changed file with a stale pin
   fails with the refresh instruction. This keeps same-PR enforcement work
   green (declare the new pins in the same change) without letting an
   undeclared hollowing pass.

After a reviewed enforcement change, refresh the declarations with:
  sha256sum <each file in BASE_PINS>
and paste the hashes into BASE_PINS in the same change. After a reviewed
change to THIS script, record its new hash in the workflow's
PINNED_CHECKER_SHA256 env in the same change (a self-hash is a fixed point,
so the baseline lives in the base-owned workflow, which passes it as
argv[1]). Run from the repo root: the tree under test is the working
directory, never the script's own location.
"""
import ast
import hashlib
import re
import sys
from pathlib import Path

CI_YML = ".github/workflows/ci.yml"
CHECKER = ".github/scripts/capability_gate_contract_check.py"
WORKFLOW = ".github/workflows/capability-gate-contract.yml"

STEP_NAME_LINE = "      - name: Test capability register binding"
STEP_USES_LINE = "        uses: ./.github/actions/capability-gate"

BASE_PINS = {
    ".github/actions/capability-gate/action.yml": "257823346da306434103d77e3a4facbcee0e536ee8b342678e14a73aa9d0b8b9",
    # The workflow itself is asserted structurally (workflow_failures), not
    # pinned: it carries PINNED_CHECKER_SHA256, so a hash pin here would
    # deadlock against checker edits the same way a self-pin would.
    "vps-workers/baci-editorial-context/capability_gate.py": "0f3a9a31e3cf0514e4fbf88d50d4dcdc0b27572d2ce796645334e5e8a75a332f",
    "vps-workers/baci-editorial-context/capability_gate_paths.py": "6bca40bea2577c7b3ec336e26aca2494e9cdee3409af797cd5c2d944baa48fd2",
    "vps-workers/baci-editorial-context/register_digests.py": "aae14e6e045e67fd2331e8ca5afd15926b96291bcb5408a2c2d2e41e07ce8767",
    "vps-workers/baci-editorial-context/platform_capabilities.py": "113a575d81f4af2e61182db47b2489d9a4ca0137d6457e76c6522a38a6ce394a",
    "vps-workers/baci-editorial-context/register_status.py": "6b3b6e87392da5662c31029db144bc86a08d4ae6e50481bb5a4a67c68621219a",
    "vps-workers/baci-editorial-context/prompt-builder.patch": "4a5454701c14a0beae4471bc6952885baa3a3152ff733998202400751f0b5c8e",
    "vps-workers/baci-editorial-context/test_capability_agent_access_map.py": "a697cd05c1107268219490c23797e283cb9a3c03482f1e3dbfc590d949583687",
    "vps-workers/baci-editorial-context/test_capability_gate.py": "39d62daac22dadf8efd04eb815dea0f32237cee3ba689397205f68546e560e18",
    "vps-workers/baci-editorial-context/test_capability_gate_contract.py": "0422bbfed8f705adbb778aa47b6b1506798d3e0fb7e7e20cba00c1f2539860bd",
    "vps-workers/baci-editorial-context/test_capability_gate_main.py": "1b9fb9f7af6f8de7177b6183559f621e2f40e450c16c8f1aefa417a3b50e7f3a",
    "vps-workers/baci-editorial-context/test_capability_register_binding.py": "243fab8b2e83d618e74226f7f3d88e3397740846ced58d3efcfd0993d3421c79",
    "vps-workers/baci-editorial-context/test_capability_register_status.py": "d0e6e5130a9504b0d89b6e1377240f606e2538e650d290a8a7b91c1de4143418",
    "vps-workers/baci-editorial-context/test_platform_capabilities.py": "7e05d5b4c325ffe55aa36a3812e1ed67d3d8646bdaa0b425c511dab2115bc987",
    "vps-workers/baci-editorial-context/test_platform_capability_prompt.py": "0c3b79f20946ecb17bd0684ed54d3cb97b0c2d7dcf3b0cebced76d9c25caccad",
    "vps-workers/baci-editorial-context/tests/fixtures/writer_stub/codex_content_agent/__init__.py": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "vps-workers/baci-editorial-context/tests/fixtures/writer_stub/codex_content_agent/prompt_builder.py": "59997648a8c05f9fdbba5d4a9849e96a066ae4d316a2a9d465e0e1ef58aed3ae",
    "vps-workers/baci-editorial-context/tests/fixtures/writer_stub/codex_content_agent/platform_capabilities.py": "e384cac8f670c565c2f767cd790d661c8ddad6627ecb17747cb82fa894c5d47b",
}

_JOB_HEADER = re.compile(r"^  [A-Za-z0-9_.\-]+:")
_JOB_CONDITION = re.compile(r"^    (if|needs|continue-on-error):")
_NEXT_STEP = re.compile(r"^      - ")
_TRIGGER_KEY = re.compile(r"^\s+([A-Za-z_]+):")


def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def declared_pins(checker_path):
    """Read the BASE_PINS declaration from a checker copy without executing it."""
    tree = ast.parse(Path(checker_path).read_text())
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id == "BASE_PINS"
        ):
            value = ast.literal_eval(node.value)
            if not isinstance(value, dict) or not all(
                isinstance(k, str) and isinstance(v, str) for k, v in value.items()
            ):
                raise ValueError("pin declaration malformed")
            return value
    raise ValueError("pin declaration missing")


def trigger_failures(ci_text):
    """The gate must stay wired to the events that need it.

    Keeping the step bytes identical while dropping the ``pull_request`` (or
    ``push``) trigger silences the gate without touching the asserted block.
    Commented trigger lines never fire, so they cannot satisfy the check.
    """
    lines = ci_text.splitlines()
    try:
        on = next(i for i, line in enumerate(lines) if line == "on:")
    except StopIteration:
        return ["ci.yml must declare workflow triggers"]
    keys = set()
    for line in lines[on + 1 :]:
        if line and not line[0].isspace() and not line.startswith("#"):
            break
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            match = _TRIGGER_KEY.match(line)
            if match:
                keys.add(match.group(1))
    missing = {"push", "pull_request"} - keys
    return [f"ci.yml must keep the {name} trigger" for name in sorted(missing)]


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


def pin_failures(repo_root, base_pins, declared):
    """Undeclared enforcement changes fail; declared ones pass with a notice.

    Declarations must track the files: advancing a pin before its file
    changes (a precomputed hash for a future weakening) fails, so the
    two-PR sequence of declare-early then weaken-silently cannot pass.
    """
    failures, notices = [], []
    for rel in base_pins:
        try:
            actual = sha256_of(Path(repo_root, rel))
        except OSError:
            failures.append(f"enforcement file missing: {rel}")
            continue
        if actual == base_pins[rel]:
            if declared.get(rel, base_pins[rel]) != base_pins[rel]:
                failures.append(
                    f"pin advanced without a file change: {rel} "
                    f"(declare the new hash only in the change that makes it)"
                )
            continue
        if declared.get(rel) == actual:
            notices.append(f"declared enforcement change (needs review): {rel}")
        else:
            failures.append(
                f"enforcement file changed without a pin update: {rel} "
                f"(refresh BASE_PINS in {CHECKER})"
            )
    for rel in declared:
        if rel not in base_pins:
            failures.append(f"unknown pin declaration: {rel}")
    return failures, notices


def workflow_failures(workflow_text):
    """The contract workflow must keep executing base-owned logic.

    The running workflow always comes from the base revision, but its
    PR-head text is data worth asserting: dropping the base fetch while
    keeping a direct script run would silently switch the guard to
    executing head code.
    """
    # Comment lines never execute: keeping the markers only as comments while
    # switching to head-owned execution must still fail.
    code = "\n".join(
        line for line in workflow_text.splitlines() if not line.strip().startswith("#")
    )
    missing = [
        marker
        for marker in (
            "git show FETCH_HEAD:.github/scripts/capability_gate_contract_check.py",
            "python3 /tmp/contract_check.py",
        )
        if marker not in code
    ]
    return [f"contract workflow must keep base-owned execution ({m})" for m in missing]


def declared_checker_pin(workflow_text):
    """The PR-head workflow's declared checker hash, if any."""
    match = re.search(r"PINNED_CHECKER_SHA256:\s*([0-9a-f]{64})", workflow_text)
    return match.group(1) if match else None


def checker_file_failures(repo_root, base_pin, declared_pin):
    """The checker's own logic is pinned from the base-owned workflow.

    The checker cannot pin itself (a self-hash is a fixed point), so the
    baseline lives in the workflow env and same-PR updates are declared
    there: unchanged passes, changed-with-declaration passes with a notice,
    changed-without fails. Rewriting the guard logic while keeping pin
    declarations consistent still lands as a visible workflow + script diff.
    """
    try:
        actual = sha256_of(Path(repo_root, CHECKER))
    except OSError:
        return ["checker script missing"], []
    if base_pin is None:
        return [], []
    if actual == base_pin:
        if declared_pin is not None and declared_pin != base_pin:
            return ["checker pin advanced without a checker change (declare it only in the change that makes it)"], []
        return [], []
    if declared_pin is not None and actual == declared_pin:
        return [], ["declared checker change (needs review)"]
    return [f"checker script changed without a pin update (refresh PINNED_CHECKER_SHA256 in {WORKFLOW})"], []


def main(root=None, checker_pin=None):
    # Root defaults to the process working directory — never the script's own
    # path: the workflow runs a base-owned copy from /tmp, where __file__
    # ancestry cannot reach the checkout.
    if root is None:
        root = Path.cwd()
    failures = []
    try:
        failures.extend(ci_failures(Path(root, CI_YML).read_text()))
    except OSError:
        failures.append("ci.yml missing")
    try:
        workflow_text = Path(root, WORKFLOW).read_text()
    except OSError:
        failures.append("contract workflow missing")
        workflow_text = ""
    failures.extend(workflow_failures(workflow_text))
    try:
        declared = declared_pins(Path(root, CHECKER))
    except (OSError, ValueError, SyntaxError) as exc:
        failures.append(f"pin declaration unreadable: {exc}")
        declared = {}
    try:
        pin_bad, notices = pin_failures(root, BASE_PINS, declared)
    except OSError as exc:
        failures.append(f"pin check failed: {exc}")
        pin_bad, notices = [], []
    failures.extend(pin_bad)
    if checker_pin is not None or declared_checker_pin(workflow_text) is not None:
        self_bad, self_notices = checker_file_failures(
            root, checker_pin, declared_checker_pin(workflow_text)
        )
        failures.extend(self_bad)
        notices.extend(self_notices)
    for notice in notices:
        print(notice)
    for failure in failures:
        print(f"contract violation: {failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    # argv[1] is the base-recorded checker hash, passed by the workflow from
    # its own env. Local runs without it skip the checker self-check.
    sys.exit(main(checker_pin=sys.argv[1] if len(sys.argv) > 1 else None))
