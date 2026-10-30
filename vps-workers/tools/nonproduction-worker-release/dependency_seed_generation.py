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

from dependency_seed_filesystem import open_directory
from dependency_seed_generation_contract import GenerationAttestation, SeedGenerationRejected, _issue_generation_capability
from dependency_seed_generation_files import root_own_frozen_tree
from dependency_seed_generation_journal import SeedGenerationJournal
from dependency_seed_generation_source import digest_pinned_stage_source
from dependency_seed_generation_workspace import create_seed_scratch, remove_seed_scratch
from dependency_seed_generation_workspace_gate import validate_seed_collection
from dependency_seed_generation_unit import (
    BIN as TRUSTED_BIN, CGROUP_ROOT, EGRESS_SOCKET, MAX_UNIT_OUTPUT, MAX_UNIT_SECONDS,
    PYTHON, TOOLS as TRUSTED_TOOLS, drain_unit,
    identity as runtime_identity, validate_active_unit,
    trusted_directory_chain,
    mount_egress_source_alias, prepare_egress_source_alias, release_egress_source_alias,
    preflight_cgroup_root, systemd_command, trusted_code_tree, trusted_file, trusted_socket,
)
from dependency_seed_publisher import _publish_seed, verify_seed
from worker_release_dependency_consumer import _archive_from_dispatch_response
from worker_release_dependency_policy_cache import (
    EXPECTED_PNPM, MAX_CACHE_BYTES, RECEIPT_NAME, validate_receipt,
)
from worker_release_dependency_seed_consumer import SEED_ROOT
from worker_release_lifecycle import AuthenticatedRun, ReleaseLockProof
from worker_release_seed_workspace_mount import verify_bounded_seed_workspace

WORK_ROOT = Path("/var/cache/baci-worker-release/seed-work")
RELEASE_LOCK = Path("/srv/baci-workers/release.lock")
MAX_STORE_BYTES = 4 * 1024 * 1024 * 1024


def _revalidate_authenticated_fence(
    identity: AuthenticatedRun,
    revalidate_identity: Callable[[], AuthenticatedRun],
    release_lock_proof: ReleaseLockProof,
) -> None:
    try:
        release_lock_proof.require_active(RELEASE_LOCK)
    except Exception as error:
        raise SeedGenerationRejected("broker release-lock proof is inactive") from error
    try:
        current_identity = revalidate_identity()
    except Exception as error:
        raise SeedGenerationRejected("authenticated run fence could not be revalidated") from error
    if (not isinstance(current_identity, AuthenticatedRun)
            or current_identity != identity
            or current_identity.status != "in_progress"):
        raise SeedGenerationRejected("authenticated run fence changed before publication")
    try:
        release_lock_proof.require_active(RELEASE_LOCK)
    except Exception as error:
        raise SeedGenerationRejected("broker release-lock proof expired during revalidation") from error


def _check_workspace() -> None:
    trusted_directory_chain(WORK_ROOT.parent)
    work_fd = open_directory(WORK_ROOT, owner_uid=0)
    try:
        if stat.S_IMODE(os.fstat(work_fd).st_mode) != 0o700:
            raise SeedGenerationRejected("fixed seed workspace mode is unsafe")
    finally:
        os.close(work_fd)


@contextmanager
def _locked_workspace(workspace: Path, *, owner_uid: int,
                      release_lock_proof: ReleaseLockProof | None = None,
                      request_sha: str | None = None):
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
        # Existing SHA seeds are expected persistent state. Validate them under
        # the nested publisher lock; every other workspace entry is crash debris.
        validate_seed_collection(
            root_fd, release_lock_proof=release_lock_proof,
            worker_root=RELEASE_LOCK.parent if release_lock_proof is not None else None,
            request_sha=request_sha,
        )
        leftovers = set(os.listdir(root_fd)) - {".seed-generation.lock", "seeds"}
        if leftovers:
            raise SeedGenerationRejected("unresolved seed-generation scratch blocks new runs")
        yield
    finally:
        if lock_fd >= 0:
            os.close(lock_fd)
        os.close(root_fd)


@contextmanager
def _generation_lock(release_lock_proof: ReleaseLockProof, request_sha: str):
    """Use only the provisioned workspace; preserve and block on crash debris."""
    _check_workspace()
    with _locked_workspace(WORK_ROOT, owner_uid=0,
                           release_lock_proof=release_lock_proof, request_sha=request_sha):
        yield


def _generate_authenticated_seed(
    response: dict[str, object], identity: AuthenticatedRun, *,
    expected_archive_sha256: str, pnpm: Path, node: Path,
    source_path: Path, source_pin: object, resource_root: Path,
    transaction_id: str,
    revalidate_identity: Callable[[], AuthenticatedRun],
    release_lock_proof: ReleaseLockProof,
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
    try:
        verify_bounded_seed_workspace()
    except Exception as error:
        raise SeedGenerationRejected("seed generation requires the exact bounded workspace mount") from error
    _revalidate_authenticated_fence(identity, revalidate_identity, release_lock_proof)
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
    source_path = Path(source_path)
    source_digest = digest_pinned_stage_source(source_path, source_pin)

    unit = f"baci-worker-seed-{identity.sha[:12]}-{secrets.token_hex(16)}.service"
    journal_root = Path(resource_root)
    journal_info = journal_root.lstat()
    if (not stat.S_ISDIR(journal_info.st_mode) or journal_info.st_uid != 0
            or stat.S_IMODE(journal_info.st_mode) != 0o700 or list(journal_root.iterdir())):
        raise SeedGenerationRejected("stage result journal resource is not empty and private")
    alias = None
    unit_may_be_active = False
    with SeedGenerationJournal(journal_root, scratch_root=WORK_ROOT, owner_uid=0) as journal:
      journal.begin(
          transaction_id=transaction_id, fence={**identity.fence(), "status": identity.status},
          unit=unit, source=source_path,
          alias_name=f"baci-seed-egress-{transaction_id}.sock",
          scratch_name=f"seed-{transaction_id}",
          builder_uid=uid, builder_gid=gid,
      )
      run_dir, cache, store = create_seed_scratch(WORK_ROOT, transaction_id, journal, uid, gid)

      def drain_exact_unit() -> None:
          nonlocal unit_may_be_active
          drain_unit(unit, uid, trusted_cgroup, failed=True)
          unit_may_be_active = False
          journal.mark_drained()

      def release_alias() -> None:
          if alias is None:
              return
          journal.mark_alias_removing()
          release_egress_source_alias(alias, gid)
          journal.mark_alias_removed()

      try:
        if trusted_socket(EGRESS_SOCKET, gid) != socket_identity:
            raise SeedGenerationRejected("egress broker socket changed before launch")
        alias = prepare_egress_source_alias(gid, transaction_id=transaction_id)
        journal.mark_alias_prepared(alias.source_identity, alias.placeholder_identity)
        mount_egress_source_alias(alias, gid)
        journal.mark_alias_mounted()
        command = systemd_command(
            unit, identity.sha[:12], uid, gid, source=source_path,
            cache=cache, store=store, pnpm=pnpm, node=node,
            egress_source=alias.path,
        )
        try:
            from worker_release_bounded_process import run_bounded_capture
            journal.mark_running()
            unit_may_be_active = True
            result = run_bounded_capture(command, timeout=MAX_UNIT_SECONDS + 15,
                                         max_stream_bytes=MAX_UNIT_OUTPUT)
            returncode = result.returncode
        except Exception as error:
            drain_exact_unit()
            raise SeedGenerationRejected("seed verifier unit failed or timed out") from error
        if returncode != 0:
            drain_exact_unit()
            raise SeedGenerationRejected("seed verifier unit reported failure")
        try:
            validate_active_unit(
                _systemctl, unit, uid, gid, source=source_path, cache=cache,
                store=store, pnpm=pnpm, node=node, egress_source=alias.path,
            )
        except Exception:
            drain_exact_unit()
            raise
        drain_exact_unit()
        release_alias()
        alias = None
        if trusted_socket(EGRESS_SOCKET, gid) != socket_identity:
            raise SeedGenerationRejected("egress broker socket changed during verification")
        policy_receipt = validate_receipt(
            source_path, cache, store / RECEIPT_NAME, EXPECTED_PNPM,
            owner_uid=uid, expected_sha=identity.sha,
            cache_max_bytes=MAX_CACHE_BYTES, cache_owner_uid=uid,
        )
        if digest_pinned_stage_source(source_path, source_pin) != source_digest:
            raise SeedGenerationRejected("stage source changed during verification")
        root_own_frozen_tree(cache, uid=uid, max_bytes=MAX_CACHE_BYTES)
        root_own_frozen_tree(store, uid=uid, max_bytes=MAX_STORE_BYTES)
        _revalidate_authenticated_fence(identity, revalidate_identity, release_lock_proof)
        if digest_pinned_stage_source(source_path, source_pin) != source_digest:
            raise SeedGenerationRejected("stage source changed before publication")
        attestation = GenerationAttestation(
            schema=1, fence={**identity.fence(), "status": identity.status},
            archive_sha256=expected_archive_sha256,
            source_tree_sha256=source_digest, unit=unit,
            unit_quiescence="systemd-collected-cgroup-and-uid-absence-proved",
            policy_receipt=policy_receipt,
        )
        generation_capability = _issue_generation_capability(
            policy_receipt, attestation.as_dict(),
            lambda: _revalidate_authenticated_fence(
                identity, revalidate_identity, release_lock_proof),
        )
        seed = _publish_seed(source_path, cache, store, SEED_ROOT, identity.sha,
                             generation_capability=generation_capability,
                             move_inputs=True, transaction_id=transaction_id)
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
        record = journal.read()
        remove_seed_scratch(
            WORK_ROOT, record["scratch_name"],
            (record["scratch_dev"], record["scratch_ino"]),
            (record["cache_dev"], record["cache_ino"]),
            (record["store_dev"], record["store_ino"]),
            outputs_moved=True,
        )
        journal.mark_outputs_removed()
        journal.mark_scratch_removed()
        journal.clear()
        return seed, stored_generation
      finally:
        # Any failure preserves scratch for inspection. Successful cleanup is
        # descriptor-relative and occurs only after the unit proof above.
        if alias is not None and not unit_may_be_active:
            # This handles a pre-launch failure only after exact unit absence
            # is proven. If any proof fails, the journal/resource are retained.
            drain_exact_unit()
            release_alias()
            alias = None


def generate_authenticated_seed(
    response: dict[str, object], identity: AuthenticatedRun, *,
    expected_archive_sha256: str, pnpm: Path, node: Path,
    source_path: Path, source_pin: object,
    resource_root: Path, transaction_id: str,
    revalidate_identity: Callable[[], AuthenticatedRun],
    release_lock_proof: ReleaseLockProof,
) -> tuple[Path, GenerationAttestation]:
    """Run one serialized seed generation; stale scratch blocks later runs."""
    with _generation_lock(release_lock_proof, identity.sha):
        return _generate_authenticated_seed(
            response, identity, expected_archive_sha256=expected_archive_sha256,
            pnpm=pnpm, node=node, source_path=source_path, source_pin=source_pin,
            resource_root=resource_root, transaction_id=transaction_id,
            revalidate_identity=revalidate_identity, release_lock_proof=release_lock_proof,
        )


__all__ = ["GenerationAttestation", "SeedGenerationRejected", "generate_authenticated_seed"]
