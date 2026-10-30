#!/usr/bin/env python3
"""Authenticated, egress-restricted seed-generation orchestration prototype.

This remains disconnected from the production broker. Its API accepts an
authenticated dispatcher response, never a claimed success or policy receipt.
"""
from __future__ import annotations

import hashlib
import fcntl
import os
from contextlib import contextmanager
from pathlib import Path
import secrets
import stat
import sys
from collections.abc import Callable

TOOLS = Path(__file__).resolve().parent
BIN = TOOLS.parents[1] / "bin"
sys.path.insert(0, str(BIN))

from dependency_seed_filesystem import open_directory, remove_tree
from dependency_seed_generation_contract import (
    GenerationAttestation, SeedGenerationRejected, _issue_generation_capability,
)
from dependency_seed_generation_files import root_own_frozen_tree
from dependency_seed_generation_unit import (
    BIN as TRUSTED_BIN, CGROUP_ROOT, EGRESS_SOCKET, MAX_UNIT_OUTPUT, MAX_UNIT_SECONDS,
    PYTHON, TOOLS as TRUSTED_TOOLS, drain_unit,
    identity as runtime_identity, validate_active_unit,
    trusted_directory_chain,
    preflight_cgroup_root, systemd_command, trusted_code_tree, trusted_file, trusted_socket,
)
from dependency_seed_publisher import _publish_seed, verify_seed
from dependency_seed_source import source_snapshot_digest
from worker_release_dependency_consumer import _archive_from_dispatch_response
from worker_release_dependency_policy_cache import (
    EXPECTED_PNPM, MAX_CACHE_BYTES, RECEIPT_NAME, validate_receipt,
)
from worker_release_dependency_seed_consumer import SEED_ROOT
from worker_release_lifecycle import AuthenticatedRun
from worker_release_staging_pipeline_prototype import _make_source_snapshot, _remove_source_snapshot

WORK_ROOT = Path("/var/cache/baci-worker-release/seed-work")
MAX_STORE_BYTES = 4 * 1024 * 1024 * 1024


def _revalidate_authenticated_fence(
    identity: AuthenticatedRun,
    revalidate_identity: Callable[[], AuthenticatedRun],
) -> None:
    try:
        current_identity = revalidate_identity()
    except Exception as error:
        raise SeedGenerationRejected("authenticated run fence could not be revalidated") from error
    if (not isinstance(current_identity, AuthenticatedRun)
            or current_identity != identity
            or current_identity.status != "in_progress"):
        raise SeedGenerationRejected("authenticated run fence changed before publication")


def _check_workspace() -> None:
    trusted_directory_chain(WORK_ROOT.parent)
    work_fd = open_directory(WORK_ROOT, owner_uid=0)
    try:
        if stat.S_IMODE(os.fstat(work_fd).st_mode) != 0o700:
            raise SeedGenerationRejected("fixed seed workspace mode is unsafe")
    finally:
        os.close(work_fd)


@contextmanager
def _locked_workspace(workspace: Path, *, owner_uid: int):
    """Serialize generation and refuse unresolved crash leftovers."""
    root_fd = os.open(workspace, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    lock_fd = -1
    try:
        root_info = os.fstat(root_fd)
        if (root_info.st_uid != owner_uid or stat.S_IMODE(root_info.st_mode) != 0o700):
            raise SeedGenerationRejected("generation workspace owner or mode is unsafe")
        try:
            lock_fd = os.open(".seed-generation.lock", os.O_CREAT | os.O_RDWR
                              | os.O_NOFOLLOW, 0o600, dir_fd=root_fd)
        except OSError as error:
            raise SeedGenerationRejected("generation workspace lock is unavailable") from error
        info = os.fstat(lock_fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != owner_uid or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) != 0o600):
            raise SeedGenerationRejected("generation workspace lock is unsafe")
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SeedGenerationRejected("another seed generation is active") from None
        leftovers = set(os.listdir(root_fd)) - {".seed-generation.lock"}
        if leftovers:
            raise SeedGenerationRejected("unresolved seed-generation scratch blocks new runs")
        yield
    finally:
        if lock_fd >= 0:
            os.close(lock_fd)
        os.close(root_fd)


@contextmanager
def _generation_lock():
    """Use only the provisioned workspace; preserve and block on crash debris."""
    _check_workspace()
    with _locked_workspace(WORK_ROOT, owner_uid=0):
        yield


def _generate_authenticated_seed(
    response: dict[str, object], identity: AuthenticatedRun, *,
    expected_archive_sha256: str, pnpm: Path, node: Path,
    revalidate_identity: Callable[[], AuthenticatedRun],
) -> tuple[Path, GenerationAttestation]:
    """Run real online pnpm checks, prove unit quiescence, and publish a seed.

    `pnpm` and `node` are fixed root-trusted runtime files selected by the
    provisioner. No success receipt or command result is accepted from callers.
    The root broker must supply a callback that re-reads the authenticated
    in-progress run immediately before publication; a directly constructed
    AuthenticatedRun alone is not an authentication capability.
    The function requires root on Linux/systemd and the fixed egress broker.
    """
    if os.geteuid() != 0 or sys.platform != "linux":
        raise SeedGenerationRejected("seed generation requires root on Linux")
    if Path("/proc/1/comm").read_text().strip() != "systemd":
        raise SeedGenerationRejected("seed generation requires systemd as PID 1")
    if (not isinstance(identity, AuthenticatedRun)
            or not callable(revalidate_identity)):
        raise SeedGenerationRejected("authenticated run identity is required")
    uid, gid = runtime_identity()
    socket_identity = trusted_socket(EGRESS_SOCKET, gid)
    trusted_file(Path(PYTHON), executable=True)
    trusted_file(pnpm, executable=False)
    trusted_file(node, executable=True)
    if (pnpm.is_symlink() or node.is_symlink() or pnpm == node
            or not isinstance(expected_archive_sha256, str)
            or len(expected_archive_sha256) != 64):
        raise SeedGenerationRejected("trusted pnpm runtime or archive digest is invalid")
    _check_workspace()
    trusted_file(Path(SYSTEMD_RUN), executable=True)
    trusted_file(Path(SYSTEMCTL), executable=True)
    trusted_code_tree(TRUSTED_TOOLS)
    trusted_code_tree(TRUSTED_BIN)
    trusted_cgroup = preflight_cgroup_root(CGROUP_ROOT)
    archive = _archive_from_dispatch_response(response, identity, expected_archive_sha256)
    if hashlib.sha256(archive.data).hexdigest() != expected_archive_sha256:
        raise SeedGenerationRejected("authenticated archive bytes do not match digest")
    source_snapshot = _make_source_snapshot(
        archive.data, sha=identity.sha, archive_sha256=expected_archive_sha256,
        source_temp_root=WORK_ROOT, owner_uid=0, worker_gid=gid,
    )
    source_path = source_snapshot.path
    source_fd = os.open(source_path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        source_digest = source_snapshot_digest(source_fd)
    finally:
        os.close(source_fd)

    run_name = f"seed-{secrets.token_hex(16)}"
    run_dir = WORK_ROOT / run_name
    unit = f"baci-worker-seed-{identity.sha[:12]}-{secrets.token_hex(16)}.service"
    run_dir.mkdir(mode=0o700, exist_ok=False)
    cache, store = run_dir / "cache", run_dir / "store"
    for path in (cache, store):
        path.mkdir(mode=0o700)
        os.chown(path, uid, gid)
    run_identity = run_dir.lstat()
    published = False
    try:
        if trusted_socket(EGRESS_SOCKET, gid) != socket_identity:
            raise SeedGenerationRejected("egress broker socket changed before launch")
        command = systemd_command(
            unit, identity.sha[:12], uid, gid, source=source_path,
            cache=cache, store=store, pnpm=pnpm, node=node,
        )
        try:
            from worker_release_bounded_process import run_bounded_capture
            result = run_bounded_capture(command, timeout=MAX_UNIT_SECONDS + 15,
                                         max_stream_bytes=MAX_UNIT_OUTPUT)
            returncode = result.returncode
        except Exception as error:
            drain_unit(unit, uid, trusted_cgroup, failed=True)
            raise SeedGenerationRejected("seed verifier unit failed or timed out") from error
        if returncode != 0:
            drain_unit(unit, uid, trusted_cgroup, failed=True)
            raise SeedGenerationRejected("seed verifier unit reported failure")
        try:
            validate_active_unit(
                _systemctl, unit, uid, gid, source=source_path, cache=cache,
                store=store, pnpm=pnpm, node=node,
            )
        except Exception:
            drain_unit(unit, uid, trusted_cgroup, failed=True)
            raise
        drain_unit(unit, uid, trusted_cgroup, failed=True)
        if trusted_socket(EGRESS_SOCKET, gid) != socket_identity:
            raise SeedGenerationRejected("egress broker socket changed during verification")
        policy_receipt = validate_receipt(
            source_path, cache, store / RECEIPT_NAME, EXPECTED_PNPM,
            owner_uid=uid, expected_sha=identity.sha,
            cache_max_bytes=MAX_CACHE_BYTES, cache_owner_uid=uid,
        )
        source_fd = os.open(source_path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            if source_snapshot_digest(source_fd) != source_digest:
                raise SeedGenerationRejected("authenticated source changed during verification")
        finally:
            os.close(source_fd)
        root_own_frozen_tree(cache, uid=uid, max_bytes=MAX_CACHE_BYTES)
        root_own_frozen_tree(store, uid=uid, max_bytes=MAX_STORE_BYTES)
        _revalidate_authenticated_fence(identity, revalidate_identity)
        attestation = GenerationAttestation(
            schema=1, fence={**identity.fence(), "status": identity.status},
            archive_sha256=expected_archive_sha256,
            source_tree_sha256=source_digest, unit=unit,
            unit_quiescence="systemd-collected-cgroup-and-uid-absence-proved",
            policy_receipt=policy_receipt,
        )
        generation_capability = _issue_generation_capability(
            policy_receipt, attestation.as_dict(),
            lambda: _revalidate_authenticated_fence(identity, revalidate_identity),
        )
        seed = _publish_seed(source_path, cache, store, SEED_ROOT, identity.sha,
                             generation_capability=generation_capability)
        stored_manifest = verify_seed(
            seed, source_path, authenticated_source_sha=identity.sha,
            max_cache_bytes=MAX_CACHE_BYTES, max_store_bytes=MAX_STORE_BYTES,
        )
        stored_attestation = stored_manifest.get("generationAttestation")
        validate_generation_attestation(
            stored_attestation, source_sha=identity.sha,
            source_tree_sha256=source_digest, policy_receipt=policy_receipt,
        )
        if not isinstance(stored_attestation, dict):
            raise SeedGenerationRejected("published seed omitted its durable attestation")
        stored_generation = GenerationAttestation.from_dict(stored_attestation)
        published = True
        return seed, stored_generation
    finally:
        # Any failure preserves scratch for inspection. Successful cleanup is
        # descriptor-relative and occurs only after the unit proof above.
        if published:
            root_fd = open_directory(WORK_ROOT, owner_uid=0)
            try:
                remove_tree(root_fd, run_name,
                            expected_identity=(run_identity.st_dev, run_identity.st_ino))
            finally:
                os.close(root_fd)
            _remove_source_snapshot(source_path, owner_uid=0)


def generate_authenticated_seed(
    response: dict[str, object], identity: AuthenticatedRun, *,
    expected_archive_sha256: str, pnpm: Path, node: Path,
    revalidate_identity: Callable[[], AuthenticatedRun],
) -> tuple[Path, GenerationAttestation]:
    """Run one serialized seed generation; stale scratch blocks later runs."""
    with _generation_lock():
        return _generate_authenticated_seed(
            response, identity, expected_archive_sha256=expected_archive_sha256,
            pnpm=pnpm, node=node, revalidate_identity=revalidate_identity,
        )


__all__ = ["GenerationAttestation", "SeedGenerationRejected", "generate_authenticated_seed"]
