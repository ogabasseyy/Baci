#!/usr/bin/env python3
"""Install the fixed offline Node/pnpm runtime from hash-pinned archives."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
import subprocess

from worker_release_pinned_runtime import NODE_PATH, NODE_VERSION, PNPM_PATH, PNPM_VERSION
from worker_release_pinned_runtime_install import install_pinned_runtime
from worker_release_pinned_runtime import PinnedRuntimeRejected


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node-archive", type=Path)
    parser.add_argument("--pnpm-archive", type=Path)
    parser.add_argument("--apply", action="store_true",
                        help="install validated local archives (requires root)")
    args = parser.parse_args(argv)
    if not args.apply:
        print(json.dumps({"status": "planned", "node": NODE_VERSION, "pnpm": PNPM_VERSION,
                          "nodePath": str(NODE_PATH), "pnpmPath": str(PNPM_PATH),
                          "network": "disabled"}, sort_keys=True))
        return 0
    if args.node_archive is None or args.pnpm_archive is None:
        print("pinned runtime install refused: exact local archives are required", file=sys.stderr)
        return 2
    try:
        install_pinned_runtime(args.node_archive, args.pnpm_archive)
    except (PinnedRuntimeRejected, OSError, subprocess.SubprocessError):
        print("pinned runtime install refused: validation failed", file=sys.stderr)
        return 2
    print("pinned Node/pnpm runtime installed and verified; no service was activated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
