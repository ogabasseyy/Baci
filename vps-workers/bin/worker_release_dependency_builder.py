#!/usr/bin/env python3
"""Build dependency payload candidates in a secretless transient systemd sandbox.

This proposal is intentionally not called by the release broker. In particular,
its manifest records symlinks but does not certify them for release installation.
The broker's current regular-file-only freeze contract remains authoritative.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import pwd
import grp
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Sequence

from worker_release_dependency_artifacts import (
    BuilderRejected,
    MANIFEST_NAME,
    SHA_RE,
    copy_source_tree,
    make_read_only_input,
    payload_manifest,
    sha256_file,
    validate_payload,
    verify_runtime_candidates,
)
from worker_release_dependency_fs import (
    read_smoke_evidence,
    snapshot_payload,
    write_manifest,
)
from worker_release_dependency_sandbox import (
    run_sandbox,
    run_sandbox_worker,
    systemd_command as _systemd_command,
)


BUILDER_USER = "baci-release-build"
BUILDER_GROUP = "baci-release-build"
LOCK_GROUP = "baci-locks"
WORKER_ROOT = Path("/srv/baci-workers")
PNPM_STORE = Path("/var/cache/baci-worker-release/pnpm-store")
BUILD_ROOT = Path("/run/baci-worker-release-build")
BUILD_INPUT_ROOT = BUILD_ROOT
BUILD_RESULTS_ROOT = BUILD_ROOT / "results"
MAX_BUILD_SCRATCH_BYTES = 1536 * 1024 * 1024
MAX_BUILD_SCRATCH_ENTRIES = 200_000
MIN_BUILD_FILESYSTEM_BYTES = 3 * 1024 * 1024 * 1024
MAX_BUILD_FILESYSTEM_BYTES = 4 * 1024 * 1024 * 1024
MAX_SOURCE_BYTES = 512 * 1024 * 1024
def _safe_source(source: Path, expected_sha: str) -> Path:
    if not SHA_RE.fullmatch(expected_sha):
        raise BuilderRejected("expected commit SHA is invalid")
    try:
        source_info = source.lstat()
    except OSError as exc:
        raise BuilderRejected("source root is unavailable") from exc
    if not stat.S_ISDIR(source_info.st_mode):
        raise BuilderRejected("source root must be a real directory")
    source = source.resolve(strict=True)
    if not source.is_dir():
        raise BuilderRejected("source root must be a real directory")
    if source == WORKER_ROOT or WORKER_ROOT in source.parents:
        raise BuilderRejected("source tree must be outside the production worker root")
    # This marker is a consistency check only. It is not proof of OIDC or source
    # provenance; the broker must supply and verify a signed attestation before
    # this builder can be connected to release staging.
    marker = source / ".baci-source-sha"
    try:
        marker_fd = os.open(marker, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError as exc:
        raise BuilderRejected("source SHA marker is unavailable or unsafe") from exc
    try:
        marker_info = os.fstat(marker_fd)
        marker_bytes = os.read(marker_fd, 65)
        marker_after = os.fstat(marker_fd)
        if not stat.S_ISREG(marker_info.st_mode) or marker_info.st_nlink != 1 or marker_info.st_size > 64 or marker_info.st_size != len(marker_bytes) or marker_info.st_mtime_ns != marker_after.st_mtime_ns or marker_info.st_ctime_ns != marker_after.st_ctime_ns:
            raise BuilderRejected("source SHA marker is not a stable bounded regular file")
    finally:
        os.close(marker_fd)
    try:
        marker_value = marker_bytes.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise BuilderRejected("source SHA marker is malformed") from exc
    if marker_value != expected_sha:
        raise BuilderRejected("source SHA marker does not match requested release")
    required = (source / "pnpm-lock.yaml", source / "vps-workers" / "pnpm-lock.yaml")
    if any(not item.is_file() or item.is_symlink() for item in required):
        raise BuilderRejected("required frozen lockfiles are missing or unsafe")
    return source


def _is_root() -> bool:
    return os.geteuid() == 0


def _builder_identity() -> tuple[int, int]:
    try:
        user = pwd.getpwnam(BUILDER_USER)
        group = grp.getgrnam(BUILDER_GROUP)
        lock_gid = grp.getgrnam(LOCK_GROUP).gr_gid
    except KeyError as exc:
        raise BuilderRejected("dedicated dependency build identity is not provisioned") from exc
    if user.pw_gid != group.gr_gid or user.pw_uid == 0:
        raise BuilderRejected("dependency build identity has an unexpected primary identity")
    groups = os.getgrouplist(BUILDER_USER, user.pw_gid)
    if lock_gid in groups:
        raise BuilderRejected("dependency build identity has the protected lock group")
    if groups != [user.pw_gid]:
        raise BuilderRejected("dependency build identity has unexpected supplementary groups")
    try:
        worker_uid = pwd.getpwnam("baci-worker").pw_uid
    except KeyError as exc:
        raise BuilderRejected("worker runtime identity is not provisioned") from exc
    if user.pw_uid == worker_uid:
        raise BuilderRejected("dependency build identity must differ from the worker identity")
    return user.pw_uid, group.gr_gid


def _validate_offline_store(*, owner_uid: int = 0) -> tuple[tuple[int, int], frozenset[str]]:
    try:
        info = PNPM_STORE.lstat()
    except OSError as exc:
        raise BuilderRejected("fixed offline pnpm store is unavailable") from exc
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid or info.st_mode & 0o022:
        raise BuilderRejected("fixed offline pnpm store ownership or mode is unsafe")
    root_identity = (info.st_dev, info.st_ino)
    entries = 0
    total_bytes = 0
    excluded_project_indexes: set[str] = set()
    for current, directories, files in os.walk(PNPM_STORE, topdown=True, followlinks=False):
        relative_parent = Path(current).relative_to(PNPM_STORE).parts
        for name in list(directories):
            path = Path(current) / name
            child = path.lstat()
            entries += 1
            if entries > MAX_BUILD_SCRATCH_ENTRIES:
                raise BuilderRejected("offline pnpm store has too many entries")
            if child.st_uid != owner_uid or child.st_mode & 0o022:
                raise BuilderRejected("offline pnpm store contains an untrusted entry")
            if stat.S_ISDIR(child.st_mode):
                relative = "/".join((*relative_parent, name))
                if (len(relative_parent) == 1 and re.fullmatch(r"v[0-9]+", relative_parent[0])
                        and name == "projects"):
                    excluded_project_indexes.add(relative)
                    directories.remove(name)
                continue
            raise BuilderRejected("offline pnpm store contains a symlink or special file")
        for name in files:
            path = Path(current) / name
            child = path.lstat()
            entries += 1
            if entries > MAX_BUILD_SCRATCH_ENTRIES:
                raise BuilderRejected("offline pnpm store has too many entries")
            if child.st_uid != owner_uid or child.st_mode & 0o022:
                raise BuilderRejected("offline pnpm store contains an untrusted entry")
            if not stat.S_ISREG(child.st_mode) or child.st_nlink < 1:
                raise BuilderRejected("offline pnpm store contains a symlink or special file")
            total_bytes += child.st_size
            if total_bytes > MAX_BUILD_SCRATCH_BYTES:
                raise BuilderRejected("offline pnpm store exceeds the private-copy size limit")
    try:
        after = PNPM_STORE.lstat()
    except OSError as exc:
        raise BuilderRejected("fixed offline pnpm store changed during validation") from exc
    if ((after.st_dev, after.st_ino) != root_identity
            or after.st_mtime_ns != info.st_mtime_ns or after.st_ctime_ns != info.st_ctime_ns):
        raise BuilderRejected("fixed offline pnpm store changed during validation")
    return root_identity, frozenset(excluded_project_indexes)


def _copy_private_offline_store(scratch: Path, uid: int, gid: int) -> Path:
    """Copy the immutable shared store into a bounded, writable per-build tree."""
    root_identity, excluded_project_indexes = _validate_offline_store()
    destination = scratch / "pnpm-store"
    copy_source_tree(PNPM_STORE, destination, max_bytes=MAX_BUILD_SCRATCH_BYTES,
                     max_entries=MAX_BUILD_SCRATCH_ENTRIES, preserve_executable=True,
                     allow_hardlinks=True,
                     exclude_relative_directories=excluded_project_indexes,
                     expected_root_identity=root_identity)
    for current, directories, files in os.walk(destination, topdown=False, followlinks=False):
        current_path = Path(current)
        for name in files:
            path = current_path / name
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise BuilderRejected("private offline store copy contains an unsafe file")
            os.chown(path, uid, gid, follow_symlinks=False)
            os.chmod(path, 0o700 if info.st_mode & 0o111 else 0o600, follow_symlinks=False)
        for name in directories:
            path = current_path / name
            info = path.lstat()
            if not stat.S_ISDIR(info.st_mode):
                raise BuilderRejected("private offline store copy contains an unsafe directory")
            os.chown(path, uid, gid, follow_symlinks=False)
            os.chmod(path, 0o700, follow_symlinks=False)
        os.chown(current_path, uid, gid, follow_symlinks=False)
        os.chmod(current_path, 0o700, follow_symlinks=False)
    return destination


def _validate_build_roots(gid: int) -> None:
    try:
        info = BUILD_ROOT.lstat()
    except OSError as exc:
        raise BuilderRejected("fixed bounded build filesystem is unavailable") from exc
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != gid or stat.S_IMODE(info.st_mode) != 0o710:
        raise BuilderRejected("build filesystem ownership or mode is unsafe")
    if not os.path.ismount(BUILD_ROOT):
        raise BuilderRejected("build filesystem must be a dedicated bounded mount")
    filesystem = os.statvfs(BUILD_ROOT)
    capacity = filesystem.f_blocks * filesystem.f_frsize
    if capacity < MIN_BUILD_FILESYSTEM_BYTES or capacity > MAX_BUILD_FILESYSTEM_BYTES:
        raise BuilderRejected("build filesystem capacity is outside configured bounds")
    try:
        results = BUILD_RESULTS_ROOT.lstat()
    except OSError as exc:
        raise BuilderRejected("root-owned result directory is unavailable") from exc
    if not stat.S_ISDIR(results.st_mode) or results.st_uid != 0 or stat.S_IMODE(results.st_mode) != 0o700:
        raise BuilderRejected("root-owned result directory ownership or mode is unsafe")


def _acquire_build_lock() -> int:
    path = BUILD_ROOT / ".builder.lock"
    fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    info = os.fstat(fd)
    if info.st_uid != 0 or not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600:
        os.close(fd)
        raise BuilderRejected("build lock ownership or mode is unsafe")
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        os.close(fd)
        raise BuilderRejected("another dependency build is active") from exc
    return fd


def _remove_private_tree(path: Path) -> None:
    try:
        info = path.lstat()
    except OSError as exc:
        raise BuilderRejected("private build directory disappeared before cleanup") from exc
    if not stat.S_ISDIR(info.st_mode):
        raise BuilderRejected("private build directory changed before cleanup")
    if os.geteuid() == 0:
        if not shutil.rmtree.avoids_symlink_attacks:
            raise BuilderRejected("safe descriptor-based recursive cleanup is unavailable")
        os.chown(path, 0, 0, follow_symlinks=False)
        os.chmod(path, 0o700, follow_symlinks=False)
    else:
        # Test-only cleanup for non-root local fixtures. Production always uses
        # shutil's descriptor-based rmtree after taking ownership of the root.
        for current, _, _ in os.walk(path, followlinks=False):
            Path(current).chmod(0o700)
    shutil.rmtree(path)


def build(source_arg: str, expected_sha: str, *, runner=None) -> tuple[dict[str, object], Path]:
    if not _is_root():
        raise BuilderRejected("sandbox orchestration must run as root")
    source = _safe_source(Path(source_arg), expected_sha)
    uid, gid = _builder_identity()
    _validate_offline_store()
    _validate_build_roots(gid)
    lock_fd = _acquire_build_lock()
    scratch = input_copy = result_dir = None
    unit = f"baci-worker-deps-{expected_sha[:12]}-{uuid.uuid4().hex}.service"
    success = False
    try:
        scratch = Path(tempfile.mkdtemp(prefix=f"{expected_sha}.", dir=BUILD_ROOT))
        os.chown(scratch, uid, gid)
        os.chmod(scratch, 0o700)
        input_copy = Path(tempfile.mkdtemp(prefix=f"{expected_sha}.input.", dir=BUILD_INPUT_ROOT))
        result_dir = Path(tempfile.mkdtemp(prefix=f"{expected_sha}.", dir=BUILD_RESULTS_ROOT))
        source_copy = input_copy / "source"
        copy_source_tree(source, source_copy, max_bytes=MAX_SOURCE_BYTES)
        make_read_only_input(source_copy)
        input_copy.chmod(0o555)
        _copy_private_offline_store(scratch, uid, gid)
        (scratch / "home").mkdir(mode=0o700)
        os.chown(scratch / "home", uid, gid)
        lockfiles = {
            "pnpm-lock.yaml": sha256_file(source_copy / "pnpm-lock.yaml"),
            "vps-workers/pnpm-lock.yaml": sha256_file(source_copy / "vps-workers" / "pnpm-lock.yaml"),
        }
        command = _systemd_command(source_copy, scratch, expected_sha, uid, gid, unit)
        if runner is None:
            run_sandbox(command, scratch, unit)
        else:
            runner(command, scratch, unit)
        smoke = read_smoke_evidence(scratch, uid)
        snapshot = snapshot_payload(scratch, result_dir, uid)
        manifest = payload_manifest(snapshot, expected_sha, lockfiles, smoke)
        write_manifest(result_dir, manifest)
        success = True
        return manifest, result_dir
    finally:
        if scratch is not None and scratch.exists():
            _remove_private_tree(scratch)
        if input_copy is not None and input_copy.exists():
            _remove_private_tree(input_copy)
        if not success and result_dir is not None and result_dir.exists():
            _remove_private_tree(result_dir)
        os.close(lock_fd)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", help="broker-verified, immutable source tree")
    parser.add_argument("--sha", help="verified 40-character release commit SHA")
    parser.add_argument("--sandbox-worker", nargs=3, metavar=("SOURCE", "SCRATCH", "SHA"), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        if args.sandbox_worker:
            source, scratch, sha = args.sandbox_worker
            return run_sandbox_worker(Path(source), Path(scratch), sha)
        if not args.source or not args.sha:
            parser.error("--source and --sha are required")
        manifest, result_dir = build(args.source, args.sha)
        print(json.dumps({"requested_commit_sha": manifest["requested_commit_sha"], "exact_sha_provenance_verified": False, "runtime_ready": False, "artifact_directory": str(result_dir), "manifest": str(result_dir / MANIFEST_NAME)}, sort_keys=True))
        return 0
    except (BuilderRejected, OSError, subprocess.SubprocessError) as exc:
        print(f"dependency build rejected: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
