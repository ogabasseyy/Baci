"""Pinned runtime discovery and independent smoke for the disposable experiment."""
from __future__ import annotations

import hashlib
import importlib.util
import os
import re
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


def _open_directory_path(root: Path) -> int:
    requested = Path(root)
    if ".." in requested.parts:
        raise RuntimeError("measured tree path contains parent traversal")
    absolute = requested if requested.is_absolute() else Path.cwd() / requested
    try:
        requested_info = absolute.lstat()
        if not stat.S_ISDIR(requested_info.st_mode):
            raise RuntimeError("measured tree root is not a real directory")
        absolute = absolute.resolve(strict=True)
    except OSError as exc:
        raise RuntimeError("measured tree root is unavailable") from exc
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open("/", flags)
    try:
        for component in absolute.parts[1:]:
            child = os.open(component, flags, dir_fd=fd)
            os.close(fd)
            fd = child
        opened = os.fstat(fd)
        if (opened.st_dev, opened.st_ino) != (requested_info.st_dev, requested_info.st_ino):
            os.close(fd)
            raise RuntimeError("measured tree root changed during open")
        if opened.st_uid != os.geteuid() or opened.st_mode & 0o022:
            os.close(fd)
            raise RuntimeError("measured tree root ownership or mode is unsafe")
        return fd
    except OSError as exc:
        os.close(fd)
        raise RuntimeError("measured tree root cannot be opened without following links") from exc


def tree_size(root: Path, *, max_entries: int, max_bytes: int,
              excluded_relative_directories: frozenset[str] = frozenset()) -> tuple[int, int]:
    """Measure a tree by dirfd; only validator-approved pnpm project indexes may be pruned."""
    if any(not re.fullmatch(r"v[0-9]+/projects", path)
           for path in excluded_relative_directories):
        raise RuntimeError("measured tree has an invalid excluded index path")
    root_fd = _open_directory_path(root)
    count = 0
    total = 0
    found_exclusions: set[str] = set()

    def visit(directory_fd: int, prefix: str = "") -> None:
        nonlocal count, total
        before = os.fstat(directory_fd)
        for name in sorted(os.listdir(directory_fd)):
            if not name or name in {".", ".."} or "/" in name or "\\" in name:
                raise RuntimeError("measured tree contains an unsafe entry or exceeds entry bound")
            info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            count += 1
            entry_type = stat.S_IFMT(info.st_mode)
            if (count > max_entries or entry_type not in (stat.S_IFDIR, stat.S_IFREG)
                    or info.st_uid != os.geteuid() or info.st_mode & 0o022):
                raise RuntimeError("measured tree contains an unsafe entry or exceeds entry bound")
            relative = f"{prefix}/{name}" if prefix else name
            if entry_type == stat.S_IFDIR:
                child_fd = os.open(name, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
                                   | getattr(os, "O_NOFOLLOW", 0), dir_fd=directory_fd)
                try:
                    opened = os.fstat(child_fd)
                    if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
                        raise RuntimeError("measured tree changed during measurement")
                    if relative in excluded_relative_directories:
                        found_exclusions.add(relative)
                    else:
                        visit(child_fd, relative)
                finally:
                    os.close(child_fd)
                continue
            if entry_type == stat.S_IFREG:
                if info.st_nlink != 1:
                    raise RuntimeError("measured tree contains a shared file inode")
                file_fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
                                  dir_fd=directory_fd)
                try:
                    opened = os.fstat(file_fd)
                    if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
                        raise RuntimeError("measured tree changed during measurement")
                    total += opened.st_size
                    if total > max_bytes:
                        raise RuntimeError("measured tree exceeds configured size bound")
                    after_file = os.fstat(file_fd)
                    if (opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) != (
                            after_file.st_size, after_file.st_mtime_ns, after_file.st_ctime_ns):
                        raise RuntimeError("measured tree changed during measurement")
                finally:
                    os.close(file_fd)
        after = os.fstat(directory_fd)
        if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns):
            raise RuntimeError("measured tree changed during measurement")

    try:
        visit(root_fd)
    finally:
        os.close(root_fd)
    if found_exclusions != set(excluded_relative_directories):
        raise RuntimeError("measured tree excluded index changed after validation")
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
    worker_sdk_smoke = (
        "import { createClient } from '@supabase/supabase-js';"
        "import { Expo } from 'expo-server-sdk';"
        "const client = createClient('https://example.invalid', 'synthetic-smoke-key');"
        "const expo = new Expo({ accessToken: 'synthetic-smoke-token' });"
        "if (typeof client.from !== 'function' ||"
        " typeof expo.sendPushNotificationsAsync !== 'function') process.exit(2);"
    )
    run_monitored((node, "--input-type=module", "-e", worker_sdk_smoke), cwd=release,
                  env=environment, timeout=30, stage="independent-smoke",
                  resource_root=resource_root)
    after = hashlib.sha256()
    after.update(bytes.fromhex(smoke.snapshot_digest(release / "apps/web/node_modules", "web-after")))
    after.update(bytes.fromhex(smoke.snapshot_digest(release / "node_modules", "worker-after")))
    if before.digest() != after.digest():
        raise RuntimeError("independent smoke modified the materialized dependency snapshot")
    return before.hexdigest()
