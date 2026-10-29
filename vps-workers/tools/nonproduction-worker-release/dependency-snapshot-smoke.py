#!/usr/bin/env python3
"""Execute dependency smoke checks in a systemd sandbox over one frozen tree."""
from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import sys
from pathlib import Path

MAX_FILES = 200_000
MAX_BYTES = 1024 * 1024 * 1024


def snapshot_digest(root: Path) -> str:
    root = root.resolve(strict=True)
    digest = hashlib.sha256()
    entries = 0
    total_bytes = 0
    for current, directories, files in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        for name in sorted(directories + files):
            path = current_path / name
            info = path.lstat()
            relative = path.relative_to(root).as_posix()
            entries += 1
            if entries > MAX_FILES or stat.S_ISLNK(info.st_mode):
                raise RuntimeError("materialized dependency snapshot has links or too many entries")
            if stat.S_ISDIR(info.st_mode):
                kind = b"d"
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                kind = b"f"
                total_bytes += info.st_size
                if total_bytes > MAX_BYTES:
                    raise RuntimeError("materialized dependency snapshot exceeds byte limit")
            else:
                raise RuntimeError("materialized dependency snapshot contains a special file")
            digest.update(kind + b"\0" + relative.encode("utf-8") + b"\0")
            digest.update(f"{stat.S_IMODE(info.st_mode):04o}:{info.st_size}\0".encode("ascii"))
            if kind == b"f":
                with path.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    if len(sys.argv) != 2 or os.geteuid() == 0:
        return 64
    release_root = Path(sys.argv[1])
    web_root = release_root / "apps" / "web"
    before = snapshot_digest(release_root / "apps" / "web" / "node_modules")
    before += snapshot_digest(release_root / "node_modules")
    environment = {"PATH": "/usr/bin:/bin", "HOME": "/nonexistent", "NODE_ENV": "production"}
    try:
        tsx = web_root / "node_modules" / ".bin" / "tsx"
        result = subprocess.run((str(tsx), "--version"), cwd=web_root, env=environment,
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, text=True, check=True, timeout=30)
        if not result.stdout.strip():
            raise RuntimeError("tsx returned no version")
        subprocess.run(("/usr/bin/node", "--input-type=module", "-e",
                        "import('dotenv').then(m => { if (typeof m.config !== 'function') process.exit(2) })"),
                       cwd=release_root, env=environment, stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       check=True, timeout=30)
        after = snapshot_digest(release_root / "apps" / "web" / "node_modules")
        after += snapshot_digest(release_root / "node_modules")
        if before != after:
            raise RuntimeError("dependency smoke modified the materialized snapshot")
    except (OSError, subprocess.SubprocessError, RuntimeError):
        return 1
    sys.stdout.write(json.dumps({"snapshot_sha256": before, "tsx": "passed", "dotenv": "passed"},
                                sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
