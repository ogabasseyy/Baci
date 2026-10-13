"""Decide whether the capability-register binding suite must run for a change.

Runs the suite unless the change provably touches neither the register, the
binding code, nor any cited source. If the changed-path set cannot be
computed (unknown base, git error), the suite runs: fail closed, never skip.
"""
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
    for target in re.findall(r"\]\(([^)\s]+)\)", text):
        if "://" in target or target.startswith(("#", "mailto:")):
            continue
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
        if register is not None and not should_run(base, register, changed):
            print("capability register and cited sources untouched; skipping binding suite")
            return 0
        if changed is not None and REGISTER_PATH not in changed and not _touches_unverified_refs(register, changed):
            # Freshness hard-gates register-carrying changes and changes to
            # unverified-row refs (no digest compensates there). For
            # content-bound cited sources the digest check already forces a
            # register re-review in the same change, so staleness must not
            # block unrelated fixes; it stays enforced by the scheduled
            # workflow and the runtime window.
            env.pop("BACI_REGISTER_REQUIRE_FRESH", None)
    return subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", SUITE_DIR, "-p", "test_*capabilit*.py"],
        env=env,
    ).returncode


if __name__ == "__main__":
    sys.exit(main())
