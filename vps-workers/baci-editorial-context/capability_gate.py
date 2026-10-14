"""Decide whether the capability-register binding suite must run for a change.

Runs the suite unless the change provably touches neither the register, the
binding code, nor any cited source. If the changed-path set cannot be
computed (unknown base, git error), the suite runs: fail closed, never skip.
"""
import datetime as dt
import json
import os
import re
import subprocess
import sys
from pathlib import Path

REGISTER_PATH = "docs/product/baci-capabilities.json"
MAP_PATH = "docs/product/agent-access-map.md"
SUITE_DIR = "vps-workers/baci-editorial-context"


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


def relevant_paths(register):
    paths = {REGISTER_PATH, MAP_PATH}
    try:
        paths |= {ref for row in register["capabilities"] for ref in row["source_refs"]}
    except (KeyError, TypeError, AttributeError):
        pass  # Structurally invalid register: base set still triggers the suite.
    map_file = Path(MAP_PATH)
    if map_file.exists():
        text = map_file.read_text()
        paths |= map_cited_paths(text)
        paths |= map_cited_filenames(text)
        paths |= map_link_targets(text)
    return paths


def changed_paths(base, cwd=".", mode=None):
    # Push events compare the previous tip directly (two-dot): a three-dot
    # merge-base diff would hide paths removed by a force-push. Pull requests
    # keep the three-dot merge-base comparison.
    if mode is None:
        mode = "push" if os.environ.get("GITHUB_EVENT_NAME") == "push" else "pull_request"
    spec = f"{base}..HEAD" if mode == "push" else f"{base}...HEAD"
    proc = subprocess.run(
        ["git", "-C", str(cwd), "diff", "--name-status", "-z", spec],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        return None
    # -z name-status emits STATUS\0path\0, with renames as R###\0old\0new\0.
    # Both sides of a rename count: dropping the old cited path must not
    # bypass the gate just because the register still lists it.
    fields = [p for p in proc.stdout.split("\0") if p]
    paths = set()
    i = 0
    while i < len(fields):
        status = fields[i]
        i += 1
        if status.startswith(("R", "C")):
            paths.update(fields[i : i + 2])
            i += 2
        else:
            paths.add(fields[i])
            i += 1
    return paths


def _matches(path, relevant):
    if path in relevant or Path(path).name in relevant:
        return True
    # Directory citations (trailing slash or not) cover everything under them.
    return any(path.startswith(r.rstrip("/") + "/") for r in relevant)


def _touches_unverified_refs(register, changed):
    try:
        refs = {ref for row in register["capabilities"] if row.get("status") == "unverified" for ref in row["source_refs"]}
    except (KeyError, TypeError, AttributeError):
        return True
    return any(_matches(p, refs) for p in changed)


def _register_stale(register):
    try:
        reviewed = dt.datetime.fromisoformat(str(register["reviewed_at"]).replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        return True
    if reviewed.tzinfo is None:
        reviewed = reviewed.replace(tzinfo=dt.timezone.utc)
    return dt.datetime.now(dt.timezone.utc) - reviewed > dt.timedelta(days=14)


def freshness_required(register, changed):
    """Freshness hard-gates register changes, stale registers, unverified refs."""
    if changed is None or register is None:
        return True
    if REGISTER_PATH in changed or _register_stale(register):
        return True
    return _touches_unverified_refs(register, changed)


def _reviewed_moment(register):
    moment = dt.datetime.fromisoformat(str(register["reviewed_at"]).replace("Z", "+00:00"))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt.timezone.utc)
    return moment


def _base_register(base):
    probe = subprocess.run(
        ["git", "show", f"{base}:{REGISTER_PATH}"],
        capture_output=True, text=True,
    )
    if probe.returncode != 0:
        return None
    try:
        return json.loads(probe.stdout)
    except ValueError:
        return None


def requires_register_update(register, changed, base_register=None):
    """A fresh register whose unverified sources changed needs re-review.

    Freshness alone cannot catch this: the register is still inside its
    evidence window, the content digest excludes unverified refs by design,
    and provenance ignores them too. A change to an unverified cited source
    (e.g. the pricing page gaining wholesale support) can therefore leave a
    stale "not established by this audit" claim reaching writers with every
    check green. The same change must re-review the register in the same PR:
    a path touch alone (whitespace-only edit) does not count — reviewed_at
    must advance past the base revision's. When the base register cannot be
    loaded, the path touch is the only available signal and is accepted.
    Unknown inputs fail closed elsewhere; here there is nothing to enforce.
    """
    if changed is None or register is None:
        return False
    if _register_stale(register):
        return False
    if not _touches_unverified_refs(register, changed):
        return False
    if REGISTER_PATH not in changed:
        return True
    if base_register is None:
        return False
    try:
        return _reviewed_moment(register) <= _reviewed_moment(base_register)
    except (KeyError, TypeError, ValueError):
        return True


def should_run(base, register, changed):
    if changed is None:
        return True
    relevant = relevant_paths(register)
    return any(
        _matches(p, relevant) or p.startswith(SUITE_DIR + "/") for p in changed
    )


def main():
    base = os.environ.get("BASE_SHA", "")
    env = dict(os.environ)
    if base and set(base) != {"0"}:
        try:
            register = json.loads(Path(REGISTER_PATH).read_text())
        except (OSError, ValueError):
            register = None  # Broken register: run the suite for its diagnosis.
        changed = changed_paths(base)
        base_register = _base_register(base) if (register is not None and changed) else None
        if requires_register_update(register, changed, base_register):
            print(
                "unverified capability sources changed without a register re-review; "
                f"update {REGISTER_PATH} (reviewed_at + digests) in this change"
            )
            return 1
        if register is not None and not should_run(base, register, changed):
            print("capability register and cited sources untouched; skipping binding suite")
            return 0
        if not freshness_required(register, changed):
            # Fresh register + content-bound-only change: the digest check
            # already forces a register re-review in the same change, so the
            # freshness hard-fail must not block unrelated fixes. A stale
            # register keeps the hard gate everywhere (re-digesting alone
            # cannot bypass it); staleness is also enforced by the scheduled
            # workflow and the runtime window.
            env.pop("BACI_REGISTER_REQUIRE_FRESH", None)
    return subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", SUITE_DIR, "-p", "test_*capabilit*.py"],
        env=env,
    ).returncode


if __name__ == "__main__":
    sys.exit(main())
