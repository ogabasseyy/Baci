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
    copy_source_tree,
    make_read_only_input,
    payload_manifest,
    sha256_file,
    validate_payload,
    verify_runtime_candidates,
)
from worker_release_dependency_fs import (
    directory_usage,
    read_smoke_evidence,
    snapshot_payload,
    write_manifest,
)
from worker_release_dependency_sandbox import (
    run_sandbox,
    run_sandbox_worker,
    systemd_command as _systemd_command,
)
from worker_release_dependency_policy_cache import (
    MAX_CACHE_BYTES,
    MAX_CACHE_ENTRIES,
    RECEIPT_NAME,
    validate_receipt,
)
from worker_release_dependency_input_cache import (
    copy_private_offline_store as _copy_offline_store,
    copy_private_policy_cache as _copy_policy_cache,
    copy_policy_cache_seed as _copy_policy_cache_seed,
    validate_offline_store as _validate_store,
)
from worker_release_dependency_diagnostics import PnpmStepRejected, write_diagnostic
from worker_release_dependency_source import safe_source as _safe_source


BUILDER_USER = "baci-release-build"
BUILDER_GROUP = "baci-release-build"
LOCK_GROUP = "baci-locks"
PNPM_STORE = Path("/var/cache/baci-worker-release/pnpm-store")
PNPM_CACHE = Path("/var/cache/baci-worker-release/pnpm-cache")
BUILD_ROOT = Path("/run/baci-worker-release-build")
BUILD_INPUT_ROOT = BUILD_ROOT
BUILD_RESULTS_ROOT = BUILD_ROOT / "results"
MAX_BUILD_SCRATCH_BYTES = 1536 * 1024 * 1024
MAX_BUILD_SCRATCH_ENTRIES = 200_000
MIN_BUILD_FILESYSTEM_BYTES = 3 * 1024 * 1024 * 1024
MAX_BUILD_FILESYSTEM_BYTES = 4 * 1024 * 1024 * 1024
MAX_SOURCE_BYTES = 512 * 1024 * 1024


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
    return _validate_store(PNPM_STORE, owner_uid=owner_uid,
                           max_entries=MAX_BUILD_SCRATCH_ENTRIES,
                           max_bytes=MAX_BUILD_SCRATCH_BYTES)


def _copy_private_offline_store(scratch: Path, uid: int, gid: int) -> Path:
    """Copy the immutable shared store into a bounded, writable per-build tree."""
    identity, excluded = _validate_offline_store()
    return _copy_offline_store(PNPM_STORE, scratch, uid, gid, identity, excluded,
                               max_entries=MAX_BUILD_SCRATCH_ENTRIES,
                               max_bytes=MAX_BUILD_SCRATCH_BYTES)


def _copy_private_policy_cache(seed: Path, scratch: Path, uid: int, gid: int) -> Path:
    """Copy the immutable verified seed into pnpm's writable private cache."""
    return _copy_policy_cache(seed, scratch, uid, gid,
                              max_entries=MAX_CACHE_ENTRIES, max_bytes=MAX_CACHE_BYTES)


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
    validate_receipt(source, PNPM_CACHE, PNPM_STORE / RECEIPT_NAME, expected_sha=expected_sha)
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
        seed_cache = _copy_policy_cache_seed(
            PNPM_CACHE, PNPM_STORE / RECEIPT_NAME, input_copy,
            max_entries=MAX_CACHE_ENTRIES, max_bytes=MAX_CACHE_BYTES,
        )
        input_copy.chmod(0o555)
        _copy_private_offline_store(scratch, uid, gid)
        _copy_private_policy_cache(seed_cache, scratch, uid, gid)
        validate_receipt(source_copy, seed_cache, input_copy / RECEIPT_NAME,
                         owner_uid=0, cache_owner_uid=0, expected_sha=expected_sha)
        directory_usage(BUILD_ROOT, max_entries=MAX_BUILD_SCRATCH_ENTRIES, max_bytes=MAX_BUILD_SCRATCH_BYTES)
        (scratch / "home").mkdir(mode=0o700)
        os.chown(scratch / "home", uid, gid)
        lockfiles = {
            "pnpm-lock.yaml": sha256_file(source_copy / "pnpm-lock.yaml"),
            "vps-workers/pnpm-lock.yaml": sha256_file(source_copy / "vps-workers" / "pnpm-lock.yaml"),
        }
        command = _systemd_command(source_copy, scratch, expected_sha, uid, gid, unit)
        if runner is None:
            run_sandbox(command, scratch, unit, usage_root=BUILD_ROOT, owner_uid=uid)
        else:
            runner(command, scratch, unit)
        smoke = read_smoke_evidence(scratch, uid)
        snapshot = snapshot_payload(scratch, result_dir, uid)
        directory_usage(BUILD_ROOT, max_entries=MAX_BUILD_SCRATCH_ENTRIES, max_bytes=MAX_BUILD_SCRATCH_BYTES)
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
        if isinstance(exc, PnpmStepRejected):
            if args.sandbox_worker: write_diagnostic(Path(args.sandbox_worker[1]) / ".baci-pnpm-error.json", exc.safe_stage, exc.safe_category, exc.exit_code, exc.evidence)
            print(f"dependency build rejected stage={exc.safe_stage} category={exc.safe_category} exit={exc.exit_code}", file=sys.stderr)
            return 1
        print(f"dependency build rejected: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
