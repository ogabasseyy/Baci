"""Root orchestration for authenticated worker archive staging.

The response and AuthenticatedRun must come directly from the fixed broker
dispatcher. Their Python shapes are constructible and are not authentication
tokens. The fixed broker dispatch supplies them after OIDC/GitHub validation;
this module binds them to isolated extraction, dependency construction, and
prepublication runtime verification.
"""
from __future__ import annotations

import hashlib
import os
import stat
from functools import partial
from pathlib import Path
from typing import Callable

from worker_release_dependency_artifacts import copy_source_tree
from worker_release_dependency_consumer import (
    BrokerFrozenSourceSnapshot, _archive_from_dispatch_response,
    build_and_install_dependencies,
)
from worker_release_lifecycle import AuthenticatedRun, release_lock
from worker_release_dependency_supervisor_journal import BuilderUnitJournal
from worker_release_dependency_supervisor_lifecycle import (
    clear_completed_builder, fixed_builder_runner_factory,
)
from worker_release_authenticated_staging_layout import (
    enable_install_parents, freeze_release,
)
from worker_release_source_snapshot import pin_source_snapshot
from worker_release_source_view_journal import SourceViewJournal
from worker_release_stage_journal import StageJournal
from worker_release_systemd_extractor import RESOURCE_ROOT, extract_frozen_source
from worker_release_runtime_verifier import (
    RuntimeVerificationQuiescenceUnproven, RuntimeVerificationRejected,
    validate_runtime_receipt, verify_materialized_candidate,
)

OWNER_UID = 0
MAX_COPY_BYTES = 512 * 1024 * 1024
MAX_COPY_ENTRIES = 200_000
RUNTIME_DIRS = ("bin", "jobs", "lib", "config", "systemd")


class StagingOrchestrationRejected(RuntimeError):
    """The disconnected staging sequence could not preserve a trust boundary."""


def _copy_contents(source_fd: int, destination_fd: int) -> None:
    totals = {"entries": 0, "bytes": 0}

    def visit(input_fd: int, output_fd: int) -> None:
        before_dir = os.fstat(input_fd)
        for name in sorted(os.listdir(input_fd)):
            if name in ("", ".", "..") or "/" in name or "\\" in name:
                raise StagingOrchestrationRejected("source snapshot contains an unsafe entry name")
            entry = os.stat(name, dir_fd=input_fd, follow_symlinks=False)
            totals["entries"] += 1
            if totals["entries"] > MAX_COPY_ENTRIES:
                raise StagingOrchestrationRejected("source snapshot exceeds entry limit")
            if stat.S_ISDIR(entry.st_mode):
                child_in = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=input_fd)
                try:
                    opened = os.fstat(child_in)
                    if (opened.st_dev, opened.st_ino) != (entry.st_dev, entry.st_ino):
                        raise StagingOrchestrationRejected("source directory changed during copy")
                    os.mkdir(name, 0o700, dir_fd=output_fd)
                    child_out = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                        dir_fd=output_fd)
                    try:
                        visit(child_in, child_out)
                    finally:
                        os.close(child_out)
                finally:
                    os.close(child_in)
            elif stat.S_ISREG(entry.st_mode) and entry.st_nlink == 1:
                totals["bytes"] += entry.st_size
                if totals["bytes"] > MAX_COPY_BYTES:
                    raise StagingOrchestrationRejected("source snapshot exceeds byte limit")
                source_file = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=input_fd)
                target_file = -1
                try:
                    opened = os.fstat(source_file)
                    if (opened.st_dev, opened.st_ino) != (entry.st_dev, entry.st_ino):
                        raise StagingOrchestrationRejected("source file changed during copy")
                    target_file = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                          0o600, dir_fd=output_fd)
                    copied = 0
                    while copied < entry.st_size:
                        data = os.read(source_file, min(1024 * 1024, entry.st_size - copied))
                        if not data:
                            raise StagingOrchestrationRejected("source file ended during copy")
                        copied += len(data)
                        if copied > entry.st_size:
                            raise StagingOrchestrationRejected("source file grew during copy")
                        view = memoryview(data)
                        while view:
                            size = os.write(target_file, view)
                            if size <= 0:
                                raise StagingOrchestrationRejected("source copy write failed")
                            view = view[size:]
                    after = os.fstat(source_file)
                    if (copied != entry.st_size or after.st_mtime_ns != entry.st_mtime_ns
                            or after.st_ctime_ns != entry.st_ctime_ns):
                        raise StagingOrchestrationRejected("source file changed during copy")
                    os.fchmod(target_file, 0o700 if entry.st_mode & 0o111 else 0o600)
                    os.fsync(target_file)
                finally:
                    if target_file >= 0:
                        os.close(target_file)
                    os.close(source_file)
            else:
                raise StagingOrchestrationRejected("source snapshot contains a link or special file")
        after_dir = os.fstat(input_fd)
        if ((before_dir.st_dev, before_dir.st_ino) != (after_dir.st_dev, after_dir.st_ino)
                or before_dir.st_mtime_ns != after_dir.st_mtime_ns
                or before_dir.st_ctime_ns != after_dir.st_ctime_ns):
            raise StagingOrchestrationRejected("source directory changed during copy")
        os.fsync(output_fd)

    visit(source_fd, destination_fd)


def _copy_snapshot_into_release(snapshot: Path, incoming: Path) -> None:
    source_fd = os.open(snapshot, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    destination_fd = os.open(incoming, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        _copy_contents(source_fd, destination_fd)
    finally:
        os.close(destination_fd)
        os.close(source_fd)
    workers = snapshot / "vps-workers"
    if not workers.is_dir() or workers.is_symlink():
        raise StagingOrchestrationRejected("worker runtime source is missing")
    for entry in RUNTIME_DIRS:
        source, target = workers / entry, incoming / entry
        if not source.is_dir() or source.is_symlink() or os.path.lexists(target):
            raise StagingOrchestrationRejected("worker runtime layout is incomplete or conflicting")
        info = source.stat(follow_symlinks=False)
        copy_source_tree(source, target, max_bytes=MAX_COPY_BYTES, max_entries=MAX_COPY_ENTRIES,
                         preserve_executable=True, expected_root_identity=(info.st_dev, info.st_ino))
    dotenv = snapshot / ".github" / "scripts" / "gigl-dotenv.sh"
    target = incoming / "bin" / "gigl-dotenv.sh"
    info = dotenv.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > MAX_COPY_BYTES
            or os.path.lexists(target)):
        raise StagingOrchestrationRejected("worker dotenv reader is missing or unsafe")
    source_fd = os.open(dotenv, os.O_RDONLY | os.O_NOFOLLOW)
    target_fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        opened = os.fstat(source_fd)
        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
            raise StagingOrchestrationRejected("worker dotenv reader changed during copy")
        copied = 0
        while copied < info.st_size:
            block = os.read(source_fd, min(1024 * 1024, info.st_size - copied))
            if not block:
                raise StagingOrchestrationRejected("worker dotenv reader truncated during copy")
            copied += len(block)
            view = memoryview(block)
            while view:
                written = os.write(target_fd, view)
                if written <= 0:
                    raise StagingOrchestrationRejected("worker dotenv reader copy failed")
                view = view[written:]
        after = os.fstat(source_fd)
        if (copied != info.st_size or after.st_mtime_ns != info.st_mtime_ns
                or after.st_ctime_ns != info.st_ctime_ns):
            raise StagingOrchestrationRejected("worker dotenv reader changed during copy")
        os.fchmod(target_fd, 0o700)
        os.fsync(target_fd)
    finally:
        os.close(source_fd)
        os.close(target_fd)


_freeze_release = partial(freeze_release, owner_uid=OWNER_UID,
                          rejected=StagingOrchestrationRejected)
_enable_install_parents = partial(enable_install_parents, owner_uid=OWNER_UID,
                                  rejected=StagingOrchestrationRejected)


def _verify_runtime_before_publish(candidate: Path, identity: AuthenticatedRun,
                                   archive_sha256: str, worker_gid: int):
    """Require a sealed verifier receipt for this unchanged incoming candidate."""
    try:
        receipt = verify_materialized_candidate(
            candidate, identity, archive_sha256=archive_sha256,
            owner_uid=OWNER_UID, owner_gid=worker_gid,
        )
    except RuntimeVerificationQuiescenceUnproven:
        raise
    except (RuntimeVerificationRejected, OSError) as error:
        raise StagingOrchestrationRejected(
            "materialized release runtime verification failed") from error
    if not validate_runtime_receipt(
            receipt, candidate, identity, archive_sha256,
            owner_uid=OWNER_UID, owner_gid=worker_gid):
        raise StagingOrchestrationRejected(
            "materialized release runtime receipt does not match candidate")
    return receipt


def stage_authenticated_archive(
    response: dict[str, object], identity: AuthenticatedRun, *, expected_archive_sha256: str,
    worker_root: Path, lock_path: Path, result_root: Path, worker_gid: int,
    builder: Callable[..., tuple[dict[str, object], Path]],
    builder_runner_factory: Callable[[AuthenticatedRun, BuilderUnitJournal], object] = fixed_builder_runner_factory,
    builder_build_root: Path | None = None,
    builder_results_root: Path | None = None,
    extractor: Callable[[StageJournal, bytes, str], dict[str, object]] = extract_frozen_source,
    builder_quiesced: Callable[[dict[str, object]], bool] | None = None,
) -> dict[str, object]:
    """Compose authenticated bytes, isolated extraction, source pinning and dependency build.

    `response` must be the immediate result of the trusted dispatcher callback.
    The drained builder journal must match the exact authenticated fence before
    temporary output cleanup. The builder must accept and invoke the supplied
    supervised `runner=` callback. This API does not itself authenticate the
    dispatcher callback.
    """
    if os.geteuid() != OWNER_UID or not isinstance(identity, AuthenticatedRun):
        raise StagingOrchestrationRejected("root broker and authenticated run identity are required")
    try:
        identity = AuthenticatedRun.from_broker(identity.fence() | {"status": identity.status},
                                                expected_sha=identity.sha)
        archive = _archive_from_dispatch_response(response, identity, expected_archive_sha256)
    except Exception as error:
        raise StagingOrchestrationRejected("dispatcher archive binding is invalid") from error
    if hashlib.sha256(archive.data).hexdigest() != expected_archive_sha256:
        raise StagingOrchestrationRejected("authenticated archive digest changed")
    fence = identity.fence()
    txid = None
    with release_lock(lock_path, expected_owner_uid=OWNER_UID):
        extractor_uid = os.stat(RESOURCE_ROOT, follow_symlinks=False).st_uid
        with StageJournal(worker_root, owner_uid=OWNER_UID, stage_uid=extractor_uid,
                          stage_gid=worker_gid, resource_root=RESOURCE_ROOT,
                          resource_uid=extractor_uid) as journal, BuilderUnitJournal(
                worker_root, owner_uid=OWNER_UID
        ) as builder_journal:
            record = journal.begin(fence, expected_archive_sha256)
            txid = record["transaction_id"]
            extraction = extractor(journal, archive.data, expected_archive_sha256)
            source_path = Path(extraction["snapshot"])
            if extraction.get("source_sha") != identity.sha:
                raise StagingOrchestrationRejected("isolated extractor returned a mismatched SHA")
            with pin_source_snapshot(source_path, trusted_root=RESOURCE_ROOT,
                                     owner_uid=extractor_uid) as source_pin:
                source_pin.verify_unchanged()
                source_view_journal = SourceViewJournal(worker_root, result_root)
                try:
                    view = source_view_journal.begin(txid, fence, identity.sha,
                                                     expected_archive_sha256)
                    view_fd = os.open(view, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                    try:
                        _copy_contents(source_pin._fds[-1], view_fd)
                    finally:
                        os.close(view_fd)
                    source_pin.verify_unchanged()
                    # pin_source_snapshot requires the exact frozen 0440/0550 contract.
                    _freeze_release(view, worker_gid=0)
                    with pin_source_snapshot(view, trusted_root=result_root,
                                             owner_uid=OWNER_UID) as view_pin:
                        view_pin.verify_unchanged()
                        source_view_journal.mark_ready()
                        incoming = journal.create_incoming()
                        _copy_snapshot_into_release(view, incoming)
                        journal.begin_ownership_transfer()
                        _freeze_release(incoming, worker_gid=worker_gid)
                        _enable_install_parents(incoming)
                        # Record the distinct builder-result resource before builder output exists.
                        journal.create_builder_result()
                        journal.remove_builder_result()

                        def run_builder(source: str, sha: str):
                            runner = builder_runner_factory(identity, builder_journal)
                            return builder(source, sha, runner=runner)

                        def prove_builder_quiesced(expected_fence: dict[str, object]) -> bool:
                            record = builder_journal.read()
                            if (record is None or record.get("fence") != expected_fence
                                    or record.get("phase") != "drained"):
                                return False
                            return (builder_quiesced is None
                                    or builder_quiesced(expected_fence) is True)

                        build_and_install_dependencies(
                            response, identity,
                            source_snapshot=BrokerFrozenSourceSnapshot(
                                view, identity.sha, expected_archive_sha256),
                            expected_bundle_sha256=expected_archive_sha256,
                            result_root=result_root, release_root=incoming,
                            builder=run_builder, builder_quiesced=prove_builder_quiesced,
                            owner_uid=OWNER_UID,
                        )
                        view_pin.verify_unchanged()
                        source_pin.verify_unchanged()
                        _freeze_release(incoming, worker_gid=worker_gid)
                        # An unproven verifier cgroup raises a preserve-required
                        # exception, leaving this journaled candidate recoverable.
                        runtime_receipt = _verify_runtime_before_publish(
                            incoming, identity, expected_archive_sha256, worker_gid)
                        journal.remove_source_snapshot()
                        source_view_journal.cleanup(fence=fence, current_owner_proven=True,
                                                    processes_quiesced=True)
                        if builder_journal.read() is None:
                            raise StagingOrchestrationRejected(
                                "supervised builder did not leave its durable unit journal")
                        clear_completed_builder(builder_journal, fence,
                                                build_root=(builder_build_root or Path(
                                                    "/run/baci-worker-release-build")),
                                                result_root=(builder_results_root or result_root))
                        if not validate_runtime_receipt(
                                runtime_receipt, incoming, identity, expected_archive_sha256,
                                owner_uid=OWNER_UID, owner_gid=worker_gid):
                            raise StagingOrchestrationRejected(
                                "materialized release changed after runtime verification")
                        published = journal.publish()
                        from worker_release_staging import _validate_staged_release
                        count = _validate_staged_release(str(Path(worker_root) / "releases"),
                                                         identity.sha, worker_gid,
                                                         owner_uid=OWNER_UID)
                        journal.commit()
                        journal.finish()
                        return {"source_sha": identity.sha, "archive_sha256": expected_archive_sha256,
                                "release_path": str(published), "entry_count": count,
                                "phase": "committed"}
                finally:
                    source_view_journal.close()


__all__ = ["StagingOrchestrationRejected", "stage_authenticated_archive"]
