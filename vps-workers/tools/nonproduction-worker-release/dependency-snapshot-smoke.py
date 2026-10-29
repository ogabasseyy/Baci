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


class SmokeFailure(RuntimeError):
    def __init__(self, category: str, relative: str = "") -> None:
        super().__init__(category)
        self.category = category
        self.relative = relative


def snapshot_digest(root: Path, label: str) -> str:
    root = root.resolve(strict=True)
    digest = hashlib.sha256()
    entries = 0
    total_bytes = 0
    for current, directories, files in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        for name in sorted(directories + files):
            path = current_path / name
            try:
                info = path.lstat()
            except OSError as exc:
                raise SmokeFailure(f"{label}-stat-{type(exc).__name__}", path.relative_to(root).as_posix()) from exc
            relative = path.relative_to(root).as_posix()
            entries += 1
            if entries > MAX_FILES:
                raise SmokeFailure(f"{label}-entry-limit", relative)
            if stat.S_ISLNK(info.st_mode):
                raise SmokeFailure(f"{label}-symlink", relative)
            if stat.S_ISDIR(info.st_mode):
                kind = b"d"
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                kind = b"f"
                total_bytes += info.st_size
                if total_bytes > MAX_BYTES:
                    raise SmokeFailure(f"{label}-byte-limit", relative)
            else:
                raise SmokeFailure(f"{label}-special-file", relative)
            digest.update(kind + b"\0" + relative.encode("utf-8") + b"\0")
            digest.update(f"{stat.S_IMODE(info.st_mode):04o}:{info.st_size}\0".encode("ascii"))
            if kind == b"f":
                with path.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(chunk)
    return digest.hexdigest()


def materialized_snapshot_digest(release_root: Path, label: str) -> str:
    combined = hashlib.sha256()
    for root, component in (
        (release_root / "apps" / "web" / "node_modules", "web"),
        (release_root / "node_modules", "worker"),
    ):
        combined.update(bytes.fromhex(snapshot_digest(root, f"{label}-{component}")))
    return combined.hexdigest()


def main() -> int:
    if len(sys.argv) != 5:
        sys.stderr.write("dependency-smoke-failure category=invocation-or-privilege\n")
        return 64
    release_root = Path(sys.argv[1])
    expected_uid, expected_gid, forbidden_gid = map(int, sys.argv[2:5])
    web_root = release_root / "apps" / "web"
    stage = "snapshot-before"
    environment = {"PATH": "/usr/bin:/bin", "HOME": "/nonexistent", "NODE_ENV": "production"}
    try:
        if (os.geteuid() != expected_uid or os.getegid() != expected_gid
                or forbidden_gid in os.getgroups()):
            raise SmokeFailure("identity-or-group-boundary")
        if not os.path.isfile("/usr/bin/node") or not os.access("/usr/bin/node", os.X_OK):
            raise SmokeFailure("node-runtime-unavailable", "/usr/bin/node")
        if not (web_root / "node_modules").is_dir() or not (release_root / "node_modules").is_dir():
            raise SmokeFailure("dependency-roots-missing")
        before = materialized_snapshot_digest(release_root, "before")
        tsx = web_root / "node_modules" / ".bin" / "tsx"
        if not tsx.is_file() or not os.access(tsx, os.X_OK):
            raise SmokeFailure("tsx-entrypoint-unavailable", "apps/web/node_modules/.bin/tsx")
        stage = "tsx-execution"
        result = subprocess.run((str(tsx), "--version"), cwd=web_root, env=environment,
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, text=True, check=True, timeout=30)
        if not result.stdout.strip():
            raise SmokeFailure("tsx-empty-output", "apps/web/node_modules/.bin/tsx")
        stage = "dotenv-resolution"
        dotenv = release_root / "node_modules" / "dotenv"
        if not dotenv.is_dir():
            raise SmokeFailure("dotenv-package-unavailable", "node_modules/dotenv")
        subprocess.run(("/usr/bin/node", "--input-type=module", "-e",
                        "import('dotenv').then(m => { if (typeof m.config !== 'function') process.exit(2) })"),
                       cwd=release_root, env=environment, stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       check=True, timeout=30)
        stage = "worker-sdk-resolution"
        worker_sdk_smoke = (
            "import { createClient } from '@supabase/supabase-js';"
            "import { Expo } from 'expo-server-sdk';"
            "const client = createClient('https://example.invalid', 'synthetic-smoke-key');"
            "const expo = new Expo({ accessToken: 'synthetic-smoke-token' });"
            "if (typeof client.from !== 'function' ||"
            " typeof expo.sendPushNotificationsAsync !== 'function') process.exit(2);"
        )
        subprocess.run(("/usr/bin/node", "--input-type=module", "-e", worker_sdk_smoke),
                       cwd=release_root, env=environment, stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       check=True, timeout=30)
        stage = "snapshot-after"
        after = materialized_snapshot_digest(release_root, "after")
        if before != after:
            raise SmokeFailure("snapshot-mutated")
    except SmokeFailure as exc:
        detail = f" relative={exc.relative}" if exc.relative else ""
        sys.stderr.write(f"dependency-smoke-failure category={exc.category}{detail}\n")
        return 1
    except subprocess.CalledProcessError as exc:
        sys.stderr.write(f"dependency-smoke-failure category={stage}-exit-{exc.returncode}\n")
        return 1
    except subprocess.TimeoutExpired:
        sys.stderr.write(f"dependency-smoke-failure category={stage}-timeout\n")
        return 1
    except OSError as exc:
        sys.stderr.write(f"dependency-smoke-failure category={stage}-{type(exc).__name__}\n")
        return 1
    except RuntimeError:
        sys.stderr.write(f"dependency-smoke-failure category={stage}-runtime-error\n")
        return 1
    sys.stdout.write(json.dumps({"snapshot_sha256": before, "tsx": "passed", "dotenv": "passed",
                                 "worker_sdks": "passed"},
                                sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
