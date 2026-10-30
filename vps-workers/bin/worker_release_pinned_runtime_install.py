#!/usr/bin/env python3
"""Install the fixed offline Node/pnpm runtime from hash-pinned archives."""
from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable

from worker_release_pinned_runtime import (
    MANIFEST_NAME, NODE_ARCHIVE_SHA256, NODE_VERSION, PNPM_ARCHIVE_SHA256,
    PNPM_ARCHIVE_SHA512_B64, PNPM_VERSION, RELEASE_NAME, RUNTIME_ROOT,
    verify_installed_runtime,
)
from worker_release_pinned_runtime_archive import (
    MAX_NODE_ARCHIVE, MAX_PNPM_ARCHIVE, RuntimeInstallRejected, extract_node, extract_pnpm,
    read_pinned_archive,
)


def _write_manifest(stage: Path) -> None:
    node = stage / "node/bin/node"
    pnpm = stage / "pnpm/bin/pnpm.cjs"
    manifest = {
        "schema": 1,
        "nodeVersion": NODE_VERSION,
        "pnpmVersion": PNPM_VERSION,
        "nodeArchiveSha256": NODE_ARCHIVE_SHA256,
        "pnpmArchiveSha256": PNPM_ARCHIVE_SHA256,
        "nodeSha256": hashlib.sha256(node.read_bytes()).hexdigest(),
        "pnpmSha256": hashlib.sha256(pnpm.read_bytes()).hexdigest(),
    }
    path = stage / MANIFEST_NAME
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o444)
    try:
        payload = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
        view = memoryview(payload)
        while view:
            count = os.write(fd, view)
            if count <= 0:
                raise RuntimeInstallRejected("runtime manifest write was incomplete")
            view = view[count:]
        os.fchown(fd, 0, 0)
        os.fchmod(fd, 0o444)
        os.fsync(fd)
    finally:
        os.close(fd)


def install_pinned_runtime(node_archive: Path, pnpm_archive: Path, *,
                           root: Path = RUNTIME_ROOT,
                           runner: Callable[..., object] = subprocess.run) -> tuple[Path, Path]:
    """Atomically install the fixed Linux x64 runtime; never fetch or activate it."""
    if os.geteuid() != 0 or sys.platform != "linux" or platform.machine() not in {"x86_64", "amd64"}:
        raise RuntimeInstallRejected("pinned runtime installation requires root on Linux x64")
    if Path(root) != RUNTIME_ROOT:
        raise RuntimeInstallRejected("runtime installation root differs from fixed policy")
    node_bytes = read_pinned_archive(Path(node_archive), expected_sha256=NODE_ARCHIVE_SHA256,
                                     max_bytes=MAX_NODE_ARCHIVE)
    pnpm_bytes = read_pinned_archive(Path(pnpm_archive), expected_sha256=PNPM_ARCHIVE_SHA256,
                                     max_bytes=MAX_PNPM_ARCHIVE,
                                     expected_sha512_b64=PNPM_ARCHIVE_SHA512_B64)
    return _install_bytes(node_bytes, pnpm_bytes, root=RUNTIME_ROOT, runner=runner)


def _install_bytes(node_bytes: bytes, pnpm_bytes: bytes, *, root: Path,
                   runner: Callable[..., object]) -> tuple[Path, Path]:
    """Private transaction seam for root-only tests using tiny synthetic archives."""
    root = Path(root)
    _trusted_dirs(root)
    parent = root / "releases"
    release = parent / RELEASE_NAME
    lock_path = root / ".provision.lock"
    lock_fd = -1
    lock_info = None
    try:
        lock_fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    except FileExistsError as error:
        raise RuntimeInstallRejected("pinned runtime provisioning is already active or unresolved") from error
    try:
        lock_info = os.fstat(lock_fd)
        os.fchown(lock_fd, 0, 0)
        os.fchmod(lock_fd, 0o600)
        if release.exists():
            return verify_installed_runtime(root=root, runner=runner)
        stage = Path(tempfile.mkdtemp(prefix=".runtime-stage-", dir=parent))
        try:
            extract_node(node_bytes, stage)
            extract_pnpm(pnpm_bytes, stage)
            _write_manifest(stage)
            for directory, subdirs, _files in os.walk(stage, topdown=False, followlinks=False):
                for name in subdirs:
                    os.chown(Path(directory) / name, 0, 0, follow_symlinks=False)
                    os.chmod(Path(directory) / name, 0o755, follow_symlinks=False)
                os.chown(directory, 0, 0)
                os.chmod(directory, 0o755)
                directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            _verify_stage(stage, runner=runner)
            os.rename(stage, release)
            parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(parent_fd)
            finally:
                os.close(parent_fd)
            return verify_installed_runtime(root=root, runner=runner)
        except BaseException:
            if stage.exists():
                shutil.rmtree(stage)
            raise
    except FileExistsError as error:
        raise RuntimeInstallRejected("pinned runtime release appeared during install") from error
    finally:
        if lock_fd >= 0:
            os.close(lock_fd)
        try:
            named_lock = lock_path.lstat()
            if (lock_info is not None and named_lock.st_uid == 0 and stat.S_ISREG(named_lock.st_mode)
                    and (named_lock.st_dev, named_lock.st_ino) ==
                    (lock_info.st_dev, lock_info.st_ino)):
                lock_path.unlink()
        except FileNotFoundError:
            pass


def _trusted_dirs(root: Path) -> None:
    root = Path(root)
    chain = [Path("/")]
    current = Path("/")
    for component in root.parts[1:]:
        current = current / component
        chain.append(current)
        if current == root:
            break
    if chain[-1] != root:
        raise RuntimeInstallRejected("runtime installation root is not absolute")
    for path in chain:
        try:
            info = path.lstat()
        except FileNotFoundError:
            path.mkdir(mode=0o755)
            info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeInstallRejected("runtime installation parent is unsafe")
    for path in (root, root / "releases"):
        try:
            path.mkdir(mode=0o755)
        except FileExistsError:
            pass
        info = path.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0
                or stat.S_IMODE(info.st_mode) != 0o755):
            raise RuntimeInstallRejected("runtime installation root is unsafe")


def _verify_stage(stage: Path, *, runner: Callable[..., object]) -> None:
    node = stage / "node/bin/node"
    pnpm = stage / "pnpm/bin/pnpm.cjs"
    for command, expected in (((str(node), "--version"), NODE_VERSION),
                              ((str(node), str(pnpm), "--version"), PNPM_VERSION)):
        result = runner(command, check=False, stdin=subprocess.DEVNULL,
                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                        timeout=10, cwd=str(stage),
                        env={"PATH": "/usr/bin:/bin", "HOME": "/nonexistent", "LC_ALL": "C"})
        if result.returncode != 0 or result.stdout.strip() != expected:
            raise RuntimeInstallRejected("staged pinned runtime version probe failed")
