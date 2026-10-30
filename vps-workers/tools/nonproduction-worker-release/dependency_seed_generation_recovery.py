"""Proof-gated cleanup for interrupted seed generation resources."""
from __future__ import annotations

import os
import re
import stat
from pathlib import Path

from dependency_seed_generation_contract import SeedGenerationRejected
from dependency_seed_generation_journal import NAME, SeedGenerationJournal
from dependency_seed_generation_unit import (
    CGROUP_ROOT, drain_unit, identity as runtime_identity,
    preflight_cgroup_root,
)
from dependency_seed_generation_workspace import recover_seed_scratch
from dependency_seed_generation_publication_recovery import recover_seed_publication
from worker_release_dependency_policy_cache import MAX_CACHE_BYTES
from worker_release_seed_workspace_mount import verify_bounded_seed_workspace

WORK_ROOT = Path("/var/cache/baci-worker-release/seed-work")
_TXID = re.compile(r"^[0-9a-f]{32}$")
_UNIT = re.compile(r"^baci-worker-seed-([0-9a-f]{12})-([0-9a-f]{32})\.service$")


def recover_seed_generation(resource: Path, *, transaction_id: str,
                            expected_fence: dict[str, object],
                            expected_source: Path, expected_source_identity: tuple[int, int]) -> bool:
    """Recover one StageJournal result resource; caller holds release.lock."""
    if os.geteuid() != 0 or not _TXID.fullmatch(transaction_id):
        raise SeedGenerationRejected("seed recovery requires root and exact transaction identity")
    try:
        verify_bounded_seed_workspace()
    except Exception as error:
        raise SeedGenerationRejected("seed recovery requires the exact bounded workspace mount") from error
    uid, gid = runtime_identity()
    trusted_cgroup = preflight_cgroup_root(CGROUP_ROOT)
    with SeedGenerationJournal(resource, scratch_root=WORK_ROOT, owner_uid=0) as journal:
        _reject_legacy_alias(journal, transaction_id)
        value = journal.read()
        if value is None:
            _recover_interrupted_begin(journal, transaction_id)
            return False
        expected = {**expected_fence, "status": "in_progress"}
        source_info = expected_source.lstat()
        if (value["transaction_id"] != transaction_id or value["fence"] != expected
                or value["source_path"] != str(expected_source)
                or (value["source_dev"], value["source_ino"]) != expected_source_identity
                or (source_info.st_dev, source_info.st_ino) != expected_source_identity
                or (value["builder_uid"], value["builder_gid"]) != (uid, gid)):
            raise SeedGenerationRejected("seed recovery journal differs from its stage transaction")
        unit = value["unit"]
        match = _UNIT.fullmatch(unit)
        if match is None or match.group(1) != expected["sha"][:12]:
            raise SeedGenerationRejected("seed recovery unit name is not journal-derived")
        drain_unit(unit, uid, trusted_cgroup, failed=True)
        journal.remove_stale_temp(transaction_id)
        journal.mark_drained()
        recover_seed_publication(
            WORK_ROOT / "seeds", expected_source, expected["sha"], transaction_id,
            WORK_ROOT / value["scratch_name"], value,
            max_cache_bytes=MAX_CACHE_BYTES, max_store_bytes=32 * 1024**3,
        )
        recover_seed_scratch(
            WORK_ROOT, value, builder_uid=uid, builder_gid=gid,
            max_bytes=32 * 1024**3, max_entries=2_000_000,
        )
        journal.mark_outputs_removed()
        journal.mark_scratch_removed()
        journal.clear()
        if os.listdir(journal.fd):
            raise SeedGenerationRejected("seed recovery resource contains unjournaled files")
        return True


def _reject_legacy_alias(journal: SeedGenerationJournal, transaction_id: str) -> None:
    """Preserve pre-redesign aliases as evidence; they have no safe journaled owner."""
    name = f"baci-seed-egress-{transaction_id}.sock"
    try:
        os.stat(name, dir_fd=journal.scratch_fd, follow_symlinks=False)
    except FileNotFoundError:
        return
    raise SeedGenerationRejected("legacy seed egress alias blocks recovery")


def _recover_interrupted_begin(journal: SeedGenerationJournal, transaction_id: str) -> None:
    """A crash before the first atomic journal link cannot have launched work."""
    temp_name = f".{NAME}.{transaction_id}.tmp"
    try:
        temp_info = os.stat(temp_name, dir_fd=journal.fd, follow_symlinks=False)
    except FileNotFoundError:
        temp_info = None
    if temp_info is not None and (not stat.S_ISREG(temp_info.st_mode) or temp_info.st_uid != 0
            or temp_info.st_nlink != 1 or stat.S_IMODE(temp_info.st_mode) != 0o600):
        raise SeedGenerationRejected("interrupted seed journal temporary file is unsafe")
    scratch_name = f"seed-{transaction_id}"
    for name in (scratch_name,):
        try:
            os.stat(name, dir_fd=journal.scratch_fd, follow_symlinks=False)
        except FileNotFoundError:
            continue
        raise SeedGenerationRejected("seed resources exist without their durable unit journal")
    if temp_info is not None:
        os.unlink(temp_name, dir_fd=journal.fd)
        os.fsync(journal.fd)
    if os.listdir(journal.fd):
        raise SeedGenerationRejected("seed result resource contains unjournaled files")


__all__ = ["WORK_ROOT", "recover_seed_generation"]
