"""Crash-safe first-generation broker bootstrap."""
from __future__ import annotations

import os
import time
from pathlib import Path

from worker_release_broker_generation import (
    clear_generation_pointer, current_generation, switch_generation, verify_generation,
)
from worker_release_broker_upgrade_control import BrokerControl, READY_TIMEOUT_SECONDS
from worker_release_broker_upgrade_errors import BrokerUpgradeRecoveryRequired, BrokerUpgradeRejected
from worker_release_broker_upgrade_journal import (
    JOURNAL_PATH, clear_upgrade_journal, read_upgrade_journal, write_upgrade_journal,
)

NO_PREVIOUS_GENERATION = "0" * 64


def bootstrap_generation(root: Path, new_digest: str, *, control: BrokerControl,
                         journal_path: Path = JOURNAL_PATH, owner_uid: int = 0,
                         root_gid: int = 0, state_root: Path,
                         state_mode: int = 0o711, transaction_root: Path,
                         ready_timeout: int = READY_TIMEOUT_SECONDS) -> str:
    """Publish and health-check the first generation with a durable no-rollback fence."""
    # Runtime import avoids a module cycle: the normal upgrade controller
    # re-exports this operation as part of its public API.
    from worker_release_broker_upgrade import _generation, _journal, _lock

    if (owner_uid == 0 and os.geteuid() != 0) or not _generation(new_digest):
        raise BrokerUpgradeRejected("broker bootstrap requires root and a valid generation")
    verify_generation(root, new_digest, owner_uid=owner_uid, root_gid=root_gid)
    root_fd, lock_fd = _lock(transaction_root, owner_uid=owner_uid,
                             root_gid=root_gid, mode=0o700)
    txid = os.urandom(16).hex()
    try:
        if read_upgrade_journal(journal_path, owner_uid=owner_uid,
                                owner_gid=root_gid) is not None:
            raise BrokerUpgradeRejected("an unresolved broker upgrade already exists")
        if current_generation(root, owner_uid=owner_uid, root_gid=root_gid,
                              state_root=state_root, state_mode=state_mode) is not None:
            raise BrokerUpgradeRejected("broker bootstrap requires an empty pointer")
        control.prove_stopped()
        write_upgrade_journal(_journal("bootstrap_prepared", txid,
                                       NO_PREVIOUS_GENERATION, new_digest),
                              journal_path, owner_uid=owner_uid, owner_gid=root_gid)
        try:
            switch_generation(root, new_digest, expected_current=None,
                              owner_uid=owner_uid, root_gid=root_gid,
                              state_root=state_root, state_mode=state_mode)
            write_upgrade_journal(_journal("bootstrap_started", txid,
                                           NO_PREVIOUS_GENERATION, new_digest),
                                  journal_path, owner_uid=owner_uid, owner_gid=root_gid)
            control.start()
            control.wait_ready(new_digest, time.monotonic() + ready_timeout)
            if current_generation(root, owner_uid=owner_uid, root_gid=root_gid,
                                  state_root=state_root, state_mode=state_mode) != new_digest:
                raise BrokerUpgradeRejected("broker bootstrap pointer changed before commit")
            clear_upgrade_journal(journal_path, owner_uid=owner_uid,
                                  owner_gid=root_gid, transaction_id=txid)
            return new_digest
        except BaseException as error:
            try:
                write_upgrade_journal(_journal("bootstrap_recovery", txid,
                                               NO_PREVIOUS_GENERATION, new_digest),
                                      journal_path, owner_uid=owner_uid,
                                      owner_gid=root_gid)
                control.stop_and_prove()
                current = current_generation(root, owner_uid=owner_uid, root_gid=root_gid,
                                             state_root=state_root, state_mode=state_mode)
                if current == new_digest:
                    clear_generation_pointer(root, expected_current=new_digest,
                                             owner_uid=owner_uid, root_gid=root_gid,
                                             state_root=state_root, state_mode=state_mode)
                elif current is not None:
                    raise BrokerUpgradeRecoveryRequired(
                        "bootstrap pointer is outside its transaction fence")
                clear_upgrade_journal(journal_path, owner_uid=owner_uid,
                                      owner_gid=root_gid, transaction_id=txid)
            except BaseException as recovery_error:
                raise BrokerUpgradeRecoveryRequired(
                    "first broker generation failed health; bootstrap recovery is required"
                ) from recovery_error
            raise BrokerUpgradeRejected(
                "first broker generation failed health; service left stopped"
            ) from error
    finally:
        os.close(lock_fd)
        os.close(root_fd)


__all__ = ["NO_PREVIOUS_GENERATION", "bootstrap_generation"]
