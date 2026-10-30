"""Root-owned bridge from an authenticated stage into the seed generator."""
from __future__ import annotations

import os
import stat
from pathlib import Path

from worker_release_lifecycle import AuthenticatedRun, ReleaseLockProof
from worker_release_result_root import pin_result_root
from worker_release_seed_workspace_mount import verify_bounded_seed_workspace

RESOURCE_NAME = "seed-generation"
SEED_ROOT = Path("/var/cache/baci-worker-release/seed-work/seeds")
RELEASE_ROOT = Path("/srv/baci-workers")


class StageSeedGenerationRejected(RuntimeError):
    """A stage could not safely generate or recover its immutable seed."""


def generate_for_stage(response: dict[str, object], identity: AuthenticatedRun, *,
                       expected_archive_sha256: str, source_path: Path, source_pin: object,
                       transaction_id: str, result_resource: Path, resource_owner_uid: int,
                       revalidate_identity, release_lock_proof: ReleaseLockProof) -> bool:
    """Generate under the stage fence; result resource remains journal-owned by StageJournal."""
    _validate_transaction(transaction_id)
    result_info = _validate_result_resource(result_resource, resource_owner_uid)
    if _reuse_existing_seed(identity, source_path, source_pin, release_lock_proof):
        return False
    parent_identity = (result_info.st_dev, result_info.st_ino)
    generation_root, identity_pair = _create_generation_root(
        result_resource, expected_parent=parent_identity,
        resource_owner_uid=resource_owner_uid,
    )
    try:
        from worker_release_pinned_runtime import verify_installed_runtime
        from dependency_seed_generation import generate_authenticated_seed

        node, pnpm = verify_installed_runtime()
        generate_authenticated_seed(
            response, identity, expected_archive_sha256=expected_archive_sha256,
            pnpm=pnpm, node=node, source_path=source_path, source_pin=source_pin,
            resource_root=generation_root, transaction_id=transaction_id,
            revalidate_identity=revalidate_identity, release_lock_proof=release_lock_proof,
        )
        _remove_empty_generation_root(
            result_resource, identity_pair, expected_parent=parent_identity,
            resource_owner_uid=resource_owner_uid,
        )
        return True
    except BaseException:
        # A durable generation record or empty intent root belongs to recovery.
        raise


def generate_for_stage_journal(journal, response: dict[str, object],
                               identity: AuthenticatedRun, **kwargs) -> bool:
    """Bind the generation resource lifetime to the existing StageJournal record."""
    resource = journal.create_builder_result()
    result = generate_for_stage(
        response, identity, result_resource=resource,
        resource_owner_uid=journal.resource_uid, **kwargs,
    )
    journal.remove_builder_result()
    return result


def _reuse_existing_seed(identity: AuthenticatedRun, source_path: Path, source_pin: object,
                         release_lock_proof: ReleaseLockProof) -> bool:
    try:
        verify_bounded_seed_workspace()
        from dependency_seed_generation_contract import validate_generation_attestation
        from dependency_seed_generation_workspace_gate import validate_seed_collection
        from dependency_seed_publisher import MAX_STORE_BYTES, verify_seed
        from dependency_seed_filesystem import open_directory
        from worker_release_dependency_policy_cache import MAX_CACHE_BYTES

        workspace_fd = open_directory(SEED_ROOT.parent, owner_uid=0)
        try:
            names = validate_seed_collection(
                workspace_fd, release_lock_proof=release_lock_proof,
                worker_root=RELEASE_ROOT, request_sha=identity.sha,
            )
        finally:
            os.close(workspace_fd)
        source_pin.verify_unchanged()
        if identity.sha not in names:
            return False
        manifest = verify_seed(SEED_ROOT / identity.sha, source_path,
                               authenticated_source_sha=identity.sha,
                               max_cache_bytes=MAX_CACHE_BYTES,
                               max_store_bytes=MAX_STORE_BYTES)
        receipt = manifest.get("verificationReceipt")
        attestation = manifest.get("generationAttestation")
        validate_generation_attestation(
            attestation, source_sha=identity.sha,
            source_tree_sha256=manifest.get("sourceTreeSha256"), policy_receipt=receipt,
        )
        source_pin.verify_unchanged()
        return True
    except Exception as error:
        raise StageSeedGenerationRejected("existing per-SHA seed cannot be reused safely") from error


def recover_for_stage(record: dict[str, object], *, resource_root: Path,
                      resource_owner_uid: int, source_path: Path,
                      source_identity: tuple[int, int]) -> bool:
    """Recover this stage's exact generation journal before StageJournal removes resources."""
    txid = record.get("transaction_id")
    _validate_transaction(txid)
    state, name = record.get("result_state"), record.get("result_name")
    if state in (None, "disabled", "reserved", "removed"):
        return False
    if (state != "created" or not isinstance(name, str)
            or name != f".{record.get('fence', {}).get('sha')}.result.{txid}"):
        raise StageSeedGenerationRejected("stage generation resource identity is invalid")
    parent_fd, parent_pin = _open_result_resource(resource_root, name, record, resource_owner_uid)
    try:
        try:
            child = os.open(RESOURCE_NAME, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=parent_fd)
        except FileNotFoundError:
            return False
        try:
            child_info = os.fstat(child)
            if (child_info.st_uid != 0 or stat.S_IMODE(child_info.st_mode) != 0o700):
                raise StageSeedGenerationRejected("stage generation journal root is unsafe")
        finally:
            os.close(child)
        generation_root = Path(resource_root) / name / RESOURCE_NAME
        try:
            from dependency_seed_generation_recovery import recover_seed_generation
            recover_seed_generation(
                generation_root, transaction_id=txid, expected_fence=record["fence"],
                expected_source=source_path, expected_source_identity=source_identity,
            )
        except Exception as error:
            raise StageSeedGenerationRejected("stage seed generation recovery failed closed") from error
        return _remove_empty_generation_root(Path(resource_root) / name,
                                             (child_info.st_dev, child_info.st_ino),
                                             parent_fd=parent_fd,
                                             expected_parent=(record["result_dev"], record["result_ino"]),
                                             parent_pin=parent_pin,
                                             resource_owner_uid=resource_owner_uid)
    finally:
        os.close(parent_fd)
        parent_pin.close()


def _validate_transaction(value: object) -> None:
    if (not isinstance(value, str) or len(value) != 32
            or any(char not in "0123456789abcdef" for char in value)):
        raise StageSeedGenerationRejected("stage seed transaction identity is invalid")


def _validate_result_resource(path: Path, owner_uid: int) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError as error:
        raise StageSeedGenerationRejected("stage result resource is unavailable") from error
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid
            or stat.S_IMODE(info.st_mode) != 0o700):
        raise StageSeedGenerationRejected("stage result resource ownership or mode is unsafe")
    return info


def _create_generation_root(parent: Path, *, expected_parent: tuple[int, int],
                            resource_owner_uid: int) -> tuple[Path, tuple[int, int]]:
    try:
      with pin_result_root(parent, owner_uid=resource_owner_uid) as pin:
        parent_fd = pin.fd
        parent_info = os.fstat(parent_fd)
        if (parent_info.st_dev, parent_info.st_ino) != expected_parent:
            raise StageSeedGenerationRejected("stage result resource changed before generation")
        os.mkdir(RESOURCE_NAME, 0o700, dir_fd=parent_fd)
        os.fsync(parent_fd)
        fd = os.open(RESOURCE_NAME, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                     dir_fd=parent_fd)
        try:
            os.fchown(fd, 0, 0)
            os.fchmod(fd, 0o700)
            os.fsync(fd)
            info = os.fstat(fd)
            named = os.stat(RESOURCE_NAME, dir_fd=parent_fd, follow_symlinks=False)
            parent_after = os.fstat(parent_fd)
            if (info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700
                    or (info.st_dev, info.st_ino) != (named.st_dev, named.st_ino)
                    or (parent_info.st_dev, parent_info.st_ino) !=
                    (parent_after.st_dev, parent_after.st_ino)):
                raise StageSeedGenerationRejected("stage generation journal root changed")
            pin.verify_unchanged()
            return parent / RESOURCE_NAME, (info.st_dev, info.st_ino)
        finally:
            os.close(fd)
    except (OSError, RuntimeError) as error:
        raise StageSeedGenerationRejected("stage generation journal root cannot be created") from error


def _open_result_resource(root: Path, name: str, record: dict[str, object],
                          resource_owner_uid: int):
    try:
      pin = pin_result_root(root, owner_uid=resource_owner_uid)
    except Exception as error:
        raise StageSeedGenerationRejected("stage generation resource root is unavailable") from error
    try:
        root_fd = pin.fd
        root_info = os.fstat(root_fd)
        if ((root_info.st_dev, root_info.st_ino) !=
                (record.get("resource_root_dev"), record.get("resource_root_ino"))
                or root_info.st_uid != resource_owner_uid):
            raise StageSeedGenerationRejected("stage generation resource root changed")
        fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd)
        info = os.fstat(fd)
        if ((info.st_dev, info.st_ino) != (record.get("result_dev"), record.get("result_ino"))
                or info.st_uid != resource_owner_uid or stat.S_IMODE(info.st_mode) != 0o700):
            os.close(fd)
            raise StageSeedGenerationRejected("stage result resource inode changed")
        pin.verify_unchanged()
        return fd, pin
    except BaseException:
        pin.close()
        raise


def _remove_empty_generation_root(parent: Path, expected: tuple[int, int], *,
                                  expected_parent: tuple[int, int], resource_owner_uid: int,
                                  parent_fd: int | None = None, parent_pin=None) -> bool:
    owned_pin = parent_pin is None
    close_fd = parent_fd is not None and parent_pin is None
    if parent_pin is None:
        parent_pin = pin_result_root(parent, owner_uid=resource_owner_uid)
    fd = parent_pin.fd if parent_fd is None else parent_fd
    try:
        parent_info = os.fstat(fd)
        if (parent_info.st_dev, parent_info.st_ino) != expected_parent:
            raise StageSeedGenerationRejected("stage generation parent inode changed")
        child_fd = os.open(RESOURCE_NAME, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                           dir_fd=fd)
        try:
            info = os.fstat(child_fd)
            named = os.stat(RESOURCE_NAME, dir_fd=fd, follow_symlinks=False)
            if ((info.st_dev, info.st_ino) != expected or info.st_uid != 0
                    or stat.S_IMODE(info.st_mode) != 0o700 or os.listdir(child_fd)
                    or (named.st_dev, named.st_ino) != expected):
                raise StageSeedGenerationRejected("stage generation resources remain unresolved")
        finally:
            os.close(child_fd)
        os.rmdir(RESOURCE_NAME, dir_fd=fd)
        os.fsync(fd)
        parent_pin.verify_unchanged()
        return True
    except FileNotFoundError:
        return False
    finally:
        if close_fd:
            os.close(fd)
        if owned_pin:
            parent_pin.close()
