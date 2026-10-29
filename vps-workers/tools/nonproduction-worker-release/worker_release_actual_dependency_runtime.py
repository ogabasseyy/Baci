"""Pinned runtime discovery and independent smoke for the disposable experiment."""
from __future__ import annotations

import hashlib
import importlib.util
import os
import shutil
import stat
import subprocess
from pathlib import Path

from worker_release_actual_dependency_guard import run_monitored


def pinned_pnpm(node: str, expected_version: str) -> str:
    launcher = shutil.which("pnpm")
    if not launcher:
        raise RuntimeError("pinned pnpm launcher is unavailable")
    search_root = (Path(launcher).parent.parent).resolve(strict=True)
    candidates = []
    seen = 0
    for current, directories, files in os.walk(search_root, topdown=True, followlinks=False):
        directories[:] = [name for name in directories if not (Path(current) / name).is_symlink()]
        seen += len(directories) + len(files)
        if seen > 100_000:
            raise RuntimeError("pnpm installation exceeds entry bound")
        if not current.endswith("/pnpm/bin") or "pnpm.cjs" not in files:
            continue
        candidate = Path(current) / "pnpm.cjs"
        info = candidate.lstat()
        if not stat.S_ISREG(info.st_mode) or candidate.is_symlink():
            continue
        try:
            candidate.resolve(strict=True).relative_to(search_root)
        except (OSError, ValueError):
            continue
        result = subprocess.run((node, str(candidate), "--version"), stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                text=True, timeout=15, check=False)
        if result.returncode == 0 and result.stdout.strip() == expected_version:
            candidates.append(candidate.resolve(strict=True))
    if len(candidates) != 1:
        raise RuntimeError("could not identify exactly one pinned pnpm package entrypoint")
    return str(candidates[0])


def tree_size(root: Path, *, max_entries: int, max_bytes: int) -> tuple[int, int]:
    count = 0
    total = 0
    for current, directories, files in os.walk(root, topdown=True, followlinks=False):
        for name in directories + files:
            path = Path(current) / name
            info = path.lstat()
            count += 1
            entry_type = stat.S_IFMT(info.st_mode)
            if count > max_entries or entry_type not in (stat.S_IFDIR, stat.S_IFREG):
                raise RuntimeError("measured tree contains an unsafe entry or exceeds entry bound")
            if entry_type == stat.S_IFREG:
                if info.st_nlink != 1:
                    raise RuntimeError("measured tree contains a shared file inode")
                total += info.st_size
                if total > max_bytes:
                    raise RuntimeError("measured tree exceeds configured size bound")
    return count, total


def load_smoke_module(repo_root: Path):
    path = repo_root / "vps-workers/tools/nonproduction-worker-release/dependency-snapshot-smoke.py"
    spec = importlib.util.spec_from_file_location("actual_dependency_smoke", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("independent smoke module is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def independent_smoke(release: Path, node: str, smoke, resource_root: Path) -> str:
    before = hashlib.sha256()
    before.update(bytes.fromhex(smoke.snapshot_digest(release / "apps/web/node_modules", "web")))
    before.update(bytes.fromhex(smoke.snapshot_digest(release / "node_modules", "worker")))
    environment = {"PATH": f"{Path(node).parent}:/usr/bin:/bin", "HOME": "/nonexistent", "NODE_ENV": "production"}
    tsx = release / "apps/web/node_modules/.bin/tsx"
    if not tsx.is_file() or not os.access(tsx, os.X_OK):
        raise RuntimeError("materialized web tsx entrypoint is unavailable")
    run_monitored((str(tsx), "--version"), cwd=release / "apps/web", env=environment, timeout=30,
                  stage="independent-smoke", resource_root=resource_root)
    dotenv = release / "node_modules/dotenv"
    if not dotenv.is_dir():
        raise RuntimeError("materialized worker dotenv package is unavailable")
    run_monitored((node, "--input-type=module", "-e",
                   "import('dotenv').then(m => { if (typeof m.config !== 'function') process.exit(2) })"),
                  cwd=release, env=environment, timeout=30, stage="independent-smoke",
                  resource_root=resource_root)
    after = hashlib.sha256()
    after.update(bytes.fromhex(smoke.snapshot_digest(release / "apps/web/node_modules", "web-after")))
    after.update(bytes.fromhex(smoke.snapshot_digest(release / "node_modules", "worker-after")))
    if before.digest() != after.digest():
        raise RuntimeError("independent smoke modified the materialized dependency snapshot")
    return before.hexdigest()
