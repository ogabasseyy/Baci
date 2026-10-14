"""Repository-path helpers for the capability gate.

Pure path logic: map citations, filename resolution, and matching. The
policy layer (freshness, re-review, main) lives in capability_gate.py.
"""
import hashlib
import os
import re
import subprocess
from pathlib import Path


REGISTER_PATH = "docs/product/baci-capabilities.json"
MAP_PATH = "docs/product/agent-access-map.md"
SUITE_DIR = "vps-workers/baci-editorial-context"
ACTION_PATH = ".github/actions/capability-gate/action.yml"
FRESHNESS_WORKFLOW = ".github/workflows/capability-register-freshness.yml"
CONTRACT_WORKFLOW = ".github/workflows/capability-gate-contract.yml"
CONTRACT_CHECK = ".github/scripts/capability_gate_contract_check.py"

def map_cited_paths(text):
    paths = set()
    for token in re.findall(r"`([^`]+)`", text):
        token = token.strip().strip(",;")
        if re.match(r"^(apps|docs|packages|vps-workers|\.github)/", token) and "/" in token:
            paths.add(token)
    return paths


def map_cited_filenames(text):
    names = set()
    for token in re.findall(r"`([^`]+)`", text):
        token = token.strip().strip(",;")
        if "/" not in token and re.search(r"\.(ts|tsx|js|jsx|py|json)$", token):
            names.add(token)
    return names


def map_link_targets(text, map_dir="docs/product"):
    """Repository-local Markdown link destinations, normalized to repo paths."""
    targets = set()
    for match in re.finditer(r"\]\(", text):
        # Balanced-parenthesis scan: link destinations such as
        # ../../apps/web/src/app/(platform)/features/page.tsx contain
        # parentheses, so a [^)] character class truncates them.
        depth = 1
        i = match.end()
        while i < len(text) and depth:
            if text[i] == "(":
                depth += 1
            elif text[i] == ")":
                depth -= 1
            i += 1
        target = text[match.end() : i - 1].strip()
        if not target or "://" in target or target.startswith(("#", "mailto:")):
            continue
        # Optional quoted title after the destination; angle-bracket form.
        target = target.split()[0].strip().strip("<>")
        normalized = Path(map_dir, target).as_posix()
        parts = []
        for part in normalized.split("/"):
            if part == "..":
                if parts:
                    parts.pop()
            elif part not in ("", "."):
                parts.append(part)
        targets.add("/".join(parts))
    return targets


def _tracked_paths(command):
    """Tracked repo paths via git, or None when git is unavailable."""
    try:
        proc = subprocess.run(command, capture_output=True, text=True)
    except OSError:
        return None
    if proc.returncode != 0:
        return None
    return {line for line in proc.stdout.split("\0") if line}


def _resolve_cited_filenames(names, cwd=".", base=None):
    """Resolve bare map-cited filenames to tracked repo paths.

    A bare name (no directory) would otherwise match any same-basename path
    via _matches — one generic citation such as `page.tsx` would make almost
    every PR run the suite. Resolving against tracked paths keeps exact-path
    matching wherever history is available; unresolvable names fall back to
    the legacy basename behavior. The base tree is included so a deleted or
    renamed same-basename file stays relevant for the change that removed it.
    """
    if not names:
        return set(), set()
    # -z/NUL: whitespace splitting would truncate tracked paths with spaces.
    head = _tracked_paths(["git", "-C", str(cwd), "ls-files", "-z"])
    if head is None:
        return set(), set(names)
    paths = set(head)
    if base and set(str(base)) != {"0"}:
        at_base = _tracked_paths(["git", "-C", str(cwd), "ls-tree", "-r", "--name-only", "-z", str(base)])
        if at_base is not None:
            paths |= at_base
    # Every tracked path sharing a cited basename stays relevant: keeping
    # only the first match would silently drop the real cited file once a
    # same-basename file sorts earlier.
    resolved = {path for path in paths if Path(path).name in names}
    unresolved = set(names) - {Path(path).name for path in resolved}
    return resolved, unresolved


def _merge_base_out(base, head, cwd):
    try:
        proc = subprocess.run(
            ["git", "-C", str(cwd), "merge-base", str(base), str(head)],
            capture_output=True, text=True,
        )
    except Exception:
        return None
    if proc.returncode != 0 or not proc.stdout.strip():
        return None
    return proc.stdout.strip()


def _is_ancestor(older, newer, cwd):
    try:
        proc = subprocess.run(
            ["git", "-C", str(cwd), "merge-base", "--is-ancestor", str(older), str(newer)],
            capture_output=True, text=True,
        )
    except Exception:
        return False
    return proc.returncode == 0


def _comparison_base(base, cwd="."):
    """The baseline the change is measured against.

    Pull requests diff against the merge-base (three-dot), so the baseline
    register must come from there too — comparing against the raw base tip
    would fail a genuine re-review whenever main advanced the register after
    the PR branched. Pushes compare tip-to-tip (two-dot): the base is used
    directly. Falls back to the raw base when the merge-base is unresolvable.
    In CI, pull_request HEAD is GitHub's synthetic merge commit whose second
    parent is the actual PR head: the candidates from both are considered and
    the older (ancestor-of-the-other) wins, so the baseline is the feature
    branch's fork point rather than the already-advanced base tip.
    """
    if os.environ.get("GITHUB_EVENT_NAME") == "push":
        return base
    # Best-effort probes: callers fall back to the raw base.
    candidates = []
    for head in ("HEAD^2", "HEAD"):
        rev = _merge_base_out(base, head, cwd)
        if rev is not None:
            candidates.append(rev)
    if not candidates:
        return base
    if len(candidates) == 1:
        return candidates[0]
    older, newer = candidates
    return older if _is_ancestor(older, newer, cwd) else newer


def _touches_unverified_refs(register, changed):
    try:
        refs = {_canon(ref) for row in register["capabilities"] if row.get("status") == "unverified" for ref in row["source_refs"]}
    except (KeyError, TypeError, AttributeError):
        return True
    return any(_matches(p, refs) for p in changed)


def _touches_cited_refs(register, changed):
    """Any cited source_refs, regardless of row status.

    Content-bound rows are digest-enforced, but a redigest alone (new
    source_revision, same reviewed_at) must still count as pending re-review:
    the digest proves the content was seen, not that the claims were reviewed.
    """
    try:
        refs = {_canon(ref) for row in register["capabilities"] for ref in row["source_refs"]}
    except (KeyError, TypeError, AttributeError):
        return True
    return any(_matches(p, refs) for p in changed)


def _changed_refs_unbound(register, changed, cwd="."):
    """Changed cited sources must match their blobs at the bound revision.

    Ancestry alone accepts an intermediate descendant that predates the
    reviewed edit. For every cited path this diff touches, the blob at
    source_revision must equal the checkout copy — otherwise the recorded
    revision does not contain the reviewed change.
    """
    try:
        refs = {_canon(ref) for row in register["capabilities"] for ref in row["source_refs"]}
    except (KeyError, TypeError, AttributeError):
        return ["register references unavailable"]
    # Directory citations cover their descendants: expand through the same
    # matcher the touch detection uses, or a changed file under a cited
    # directory binds nothing while the metadata still advances.
    touched = {p for p in (_canon(p) for p in (changed or ())) if _matches(p, refs)}
    if not touched:
        return []
    revision = register.get("source_revision")
    if not isinstance(revision, str):
        return ["source_revision missing"]
    failures = []
    for path in sorted(touched):
        probe = subprocess.run(
            ["git", "-C", str(cwd), "show", f"{revision}:{path}"],
            capture_output=True,
        )
        if probe.returncode != 0:
            failures.append(f"cited change absent at source_revision: {path}")
            continue
        try:
            current = Path(cwd, path).read_bytes()
        except OSError:
            failures.append(f"cited change missing from checkout: {path}")
            continue
        if hashlib.sha256(probe.stdout).hexdigest() != hashlib.sha256(current).hexdigest():
            failures.append(f"cited change not bound at source_revision: {path}")
    return failures


def relevant_paths(register, cwd=".", base=None):
    # The enforcement layer itself (suite code, the composite action that
    # invokes it, and the scheduled workflow that asserts it) is always
    # relevant: a change confined to those files must still run the suite.
    paths = {REGISTER_PATH, MAP_PATH, ACTION_PATH, FRESHNESS_WORKFLOW, CONTRACT_WORKFLOW, CONTRACT_CHECK}
    try:
        paths |= {_canon(ref) for row in register["capabilities"] for ref in row["source_refs"]}
    except (KeyError, TypeError, AttributeError):
        pass  # Structurally invalid register: base set still triggers the suite.
    # The map is resolved against the target checkout, never the process cwd:
    # invoking the gate from elsewhere must not silently drop map citations.
    map_file = Path(cwd, MAP_PATH)
    if map_file.exists():
        text = map_file.read_text()
        paths |= map_cited_paths(text)
        resolved, unresolved = _resolve_cited_filenames(map_cited_filenames(text), cwd, base)
        paths |= resolved
        paths |= unresolved
        paths |= map_link_targets(text)
    return paths


def _canon(ref):
    """Strip leading ./ segments: git diff never emits them, citations might."""
    if not isinstance(ref, str):
        return ref
    while ref.startswith("./"):
        ref = ref[2:]
    return ref


def _matches(path, relevant):
    if path in relevant or Path(path).name in relevant:
        return True
    # Directory citations (trailing slash or not) cover everything under them.
    return any(path.startswith(r.rstrip("/") + "/") for r in relevant)

