"""Decide whether the capability-register binding suite must run for a change.

Runs the suite unless the change provably touches neither the register, the
binding code, nor any cited source. If the changed-path set cannot be
computed (unknown base, git error), the suite runs: fail closed, never skip.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

REGISTER_PATH = "docs/product/baci-capabilities.json"
SUITE_DIR = "vps-workers/baci-editorial-context"


def relevant_paths(register):
    refs = {ref for row in register["capabilities"] for ref in row["source_refs"]}
    return {REGISTER_PATH} | refs


def changed_paths(base, cwd="."):
    proc = subprocess.run(
        ["git", "-C", str(cwd), "diff", "--name-only", "-z", f"{base}...HEAD"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        return None
    return {p for p in proc.stdout.split("\0") if p}


def should_run(base, register, changed):
    if changed is None:
        return True
    relevant = relevant_paths(register)
    return any(
        p in relevant or p.startswith(SUITE_DIR + "/") for p in changed
    )


def main():
    base = os.environ.get("BASE_SHA", "")
    if base and set(base) != {"0"}:
        register = json.loads(Path(REGISTER_PATH).read_text())
        if not should_run(base, register, changed_paths(base)):
            print("capability register and cited sources untouched; skipping binding suite")
            return 0
    return subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", SUITE_DIR, "-p", "test_platform_capabilities.py"]
    ).returncode


if __name__ == "__main__":
    sys.exit(main())
