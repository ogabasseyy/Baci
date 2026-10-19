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
Bootstrap note: the guard cannot run base-owned on the PR that introduces
it (the base lacks the workflow), so that PR's pins were verified manually
— the committed self-consistency test plus direct and archive-extraction
runs, with evidence quoted in review — and the push leg attested the merge.
Every later PR is guarded base-owned from merge on.
"""
import ast
import fnmatch
import hashlib
import re
import sys
from pathlib import Path

# Module names that load without ever matching test discovery: the two
# interpreter auto-imports plus every stdlib top-level name (a file with one
# of these stems in the suite dir would shadow the real module at runtime).
_RESERVED_MODULE_NAMES = frozenset({"sitecustomize", "usercustomize"}) | frozenset(
    getattr(sys, "stdlib_module_names", ())
)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from capability_gate_contract_ci_checks import (
    CHECKER,
    CI_YML,
    SUITE_DIR,
    WORKFLOW,
    _strip_comment,
    ci_failures,
)
from capability_gate_contract_workflow_checks import workflow_failures

BASE_PINS = {
    ".github/actions/capability-gate/action.yml": "257823346da306434103d77e3a4facbcee0e536ee8b342678e14a73aa9d0b8b9",
    # No self-pin: a self-hash is a fixed point. The checker's own baseline
    # lives in the workflow env (PINNED_CHECKER_SHA256, passed as argv[1]).
    ".github/scripts/capability_gate_contract_ci_checks.py": "f8a3fc7989435f4e84b0278ffbb3f6f1d1a9213b9ac22acdfe2fc781fcd86f64",
    ".github/scripts/capability_gate_contract_workflow_checks.py": "f9680280cd51b1b65c58b8db42cb85843fc7687ad966d9588f019edd3f70beb6",
    ".github/workflows/capability-register-freshness.yml": "60eec995bf4da241c8aac1c3ba01fa052fb314feff547f66e423faf86aa9340e",
    "vps-workers/baci-editorial-context/capability_gate.py": "04adc883b3f551b2e7f95910be74de267962d931a5f4c3ff015893622f93f982",
    "vps-workers/baci-editorial-context/capability_gate_paths.py": "8a493b19c14f10ee3b7fd500b9d4173d524d99a37984570d45ab65320f7860a6",
    "vps-workers/baci-editorial-context/register_digests.py": "fb42b161df30abfa27d7178bdfff75dc4fbada4d65561d14168d20f7ca70b860",
    "vps-workers/baci-editorial-context/platform_capabilities.py": "113a575d81f4af2e61182db47b2489d9a4ca0137d6457e76c6522a38a6ce394a",
    "vps-workers/baci-editorial-context/register_status.py": "6b3b6e87392da5662c31029db144bc86a08d4ae6e50481bb5a4a67c68621219a",
    "vps-workers/baci-editorial-context/prompt-builder.patch": "4a5454701c14a0beae4471bc6952885baa3a3152ff733998202400751f0b5c8e",
    "vps-workers/baci-editorial-context/test_capability_agent_access_map.py": "a697cd05c1107268219490c23797e283cb9a3c03482f1e3dbfc590d949583687",
    "vps-workers/baci-editorial-context/test_capability_gate.py": "88815781ee49e265a1e94ee7a693340b77a53fef60a9cb08b2c3e9098c268fb8",
    "vps-workers/baci-editorial-context/test_capability_gate_contract.py": "5007e1d3039cfd5c3007596d72a6f12a7564674be67b724d106ffe18eac896a4",
    "vps-workers/baci-editorial-context/test_capability_gate_contract_adversarial.py": "3b0492ae60b8ce4e6c1e7ba34adb0b06f4277bf54bddbb01e03198304c389b26",
    "vps-workers/baci-editorial-context/test_capability_gate_contract_ci.py": "411de0bb193a6b7c0d75244aab9b6dbb664fae3f4a51b5f7f76a4c5a09359d5e",
    "vps-workers/baci-editorial-context/test_capability_gate_contract_workflow.py": "1381bd0b024f0e1780915ab1aab614093af2d5a61b718224310e542b9d77411b",
    "vps-workers/baci-editorial-context/test_capability_gate_main.py": "de2e01ec7fadae64bc02f0bfabc345c9677f64369ea235b09450575c8d4693e6",
    "vps-workers/baci-editorial-context/test_capability_register_binding.py": "67566abfee3947628513bf8c91049575485e46d5c35d73a8c6871f956eeb1476",
    "vps-workers/baci-editorial-context/test_capability_register_status.py": "d0e6e5130a9504b0d89b6e1377240f606e2538e650d290a8a7b91c1de4143418",
    "vps-workers/baci-editorial-context/test_platform_capabilities.py": "7e05d5b4c325ffe55aa36a3812e1ed67d3d8646bdaa0b425c511dab2115bc987",
    "vps-workers/baci-editorial-context/test_platform_capability_prompt.py": "0c3b79f20946ecb17bd0684ed54d3cb97b0c2d7dcf3b0cebced76d9c25caccad",
    "vps-workers/baci-editorial-context/tests/fixtures/writer_stub/codex_content_agent/__init__.py": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "vps-workers/baci-editorial-context/tests/fixtures/writer_stub/codex_content_agent/prompt_builder.py": "59997648a8c05f9fdbba5d4a9849e96a066ae4d316a2a9d465e0e1ef58aed3ae",
    "vps-workers/baci-editorial-context/test_capability_gate_contract_exec.py": "9a03c0eb163a4bc42780fd83ea321b792085706d8deccd74080e373e67602b6c",
    "vps-workers/baci-editorial-context/test_capability_gate_contract_scope.py": "fb234bfa1c7632894a82e91856507ab63f6a386a60f845b3e98a2670994dfe49",
    "vps-workers/baci-editorial-context/test_capability_register_binding_dirs.py": "7b4ff9c060dda11ebff997c11afe29a990c73e9fc6890cadc4855133624c2a56",
    "vps-workers/baci-editorial-context/tests/fixtures/writer_stub/codex_content_agent/platform_capabilities.py": "e384cac8f670c565c2f767cd790d661c8ddad6627ecb17747cb82fa894c5d47b",
}

def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def declared_pins(checker_path):
    """Read the BASE_PINS declaration without executing it (exactly one assignment: Python runs the last)."""
    tree = ast.parse(Path(checker_path).read_text())
    matches = [node for node in tree.body if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id == "BASE_PINS"]
    if len(matches) != 1:
        raise ValueError("pin declaration duplicated" if matches else "pin declaration missing")
    value = ast.literal_eval(matches[0].value)
    if not isinstance(value, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in value.items()
    ):
        raise ValueError("pin declaration malformed")
    return value


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
        if rel not in declared:
            failures.append(
                f"pin declaration dropped for a guarded file: {rel} "
                f"(every base pin must stay declared)"
            )
            continue
        if actual == base_pins[rel]:
            if declared[rel] != base_pins[rel]:
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
            # A brand-new file has no baseline to betray: its whole content is
            # visible in the diff, so a declaration matching the file's actual
            # digest passes with a notice. Anything else stays a failure — an
            # unmatched hash would let a benign file declare a future payload's
            # digest, then land it silently later. Test modules mirror the gate's
            # discovery pattern; non-test helpers are declarable too, except names
            # that would hijack the interpreter itself (see the membership scan).
            in_scope = (
                rel.startswith(SUITE_DIR + "/")
                and rel.endswith(".py")
                and Path(repo_root, rel).is_file()
            )
            # Any component can be an importable package (json/__init__.py shadows `import json`).
            parts = Path(rel).parent.parts + (Path(rel).stem,)
            shadow = in_scope and any(p in _RESERVED_MODULE_NAMES for p in parts)
            if in_scope and not shadow:
                kind = "suite" if fnmatch.fnmatchcase(Path(rel).name, "test_*capabilit*.py") else "helper"
                if declared[rel] == sha256_of(Path(repo_root, rel)):
                    notices.append(f"declared new {kind} file (needs review): {rel}")
                else:
                    failures.append(f"new {kind} file pin does not match its content: {rel} (declare the file's actual hash)")
            elif shadow:
                failures.append(f"pin declaration must not shadow the interpreter: {rel}")
            else:
                failures.append(f"unknown pin declaration: {rel}")
    return failures, notices


def undeclared_suite_files(repo_root, declared):
    """Discovery must not execute files the pins never saw.

    The gate discovers every matching test module in the checkout, so a
    newly added module runs even when no pin changed. Requiring every suite
    Python file to be declared forces the addition itself into review.
    Symlinks are rejected outright: a `json` directory symlink never matches
    rglob("*.py"), yet the gate's own `import json` would resolve the linked
    package first and execute its __init__ before any check runs.
    """
    root = Path(repo_root)
    try:
        entries = sorted(path.relative_to(root).as_posix() for path in root.joinpath(SUITE_DIR).rglob("*"))
    except OSError:
        return ["suite directory unreadable"]
    undeclared = [f"undeclared suite file: {rel} (declare it in BASE_PINS in {CHECKER})" for rel in entries if rel.endswith(".py") and rel not in declared]
    links = [f"suite must not contain symlinks: {rel}" for rel in entries if Path(root, rel).is_symlink()]
    shadows = []
    for rel in entries:
        p = Path(root, rel)
        base = p.name if p.is_dir() else p.name.split(".")[0]
        if base in _RESERVED_MODULE_NAMES:
            shadows.append(f"suite must not shadow the interpreter: {rel}")
    return undeclared + links + shadows


def declared_checker_pin(workflow_text):
    """The PR-head workflow's declared checker hash (comments never count; duplicates fail)."""
    stripped = [line.strip() for line in workflow_text.splitlines()]
    pins = [m.group(1) for s in stripped if s and not s.startswith("#") and (m := re.match(r"PINNED_CHECKER_SHA256:\s*([0-9a-f]{64})\s*$", s))]
    if len(pins) > 1:
        raise ValueError("checker pin duplicated")
    return pins[0] if pins else None


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


def execution_scope_failures(workflow_text):
    """The checker runs at the workspace root on GitHub-hosted runners: any override would run attacker-influenced code while the pinned text matches."""
    code = [line for line in workflow_text.splitlines() if line.strip() and not line.strip().startswith("#")]
    for line in code:
        if re.match(r"^\s*[\"']?(working-directory|defaults|strategy|services|environment|outputs)[\"']?\s*:", line):
            return ["contract workflow must not override execution context"]
    for line in code:
        runs = re.match(r"^    [\"']?runs-on[\"']?\s*:\s*(.*)$", line)
        if runs and _strip_comment(runs.group(1)).strip().strip("\"'") != "ubuntu-24.04":
            return ["contract workflow jobs must stay on ubuntu-24.04 runners"]
    return []


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
    failures.extend(execution_scope_failures(workflow_text))
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
    failures.extend(undeclared_suite_files(root, declared))
    try:
        declared_pin = declared_checker_pin(workflow_text)
    except ValueError as exc:
        failures.append(f"checker pin invalid: {exc}")
        declared_pin = None
    if checker_pin is not None or declared_pin is not None:
        self_bad, self_notices = checker_file_failures(root, checker_pin, declared_pin)
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
