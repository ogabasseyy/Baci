"""Fenced broker generation switch, verification, and rollback controller."""
from __future__ import annotations

import fcntl
import os
import re
import stat
import time
from pathlib import Path

from worker_release_broker_generation import (
    clear_generation_pointer, current_generation, switch_generation, verify_generation,
)
from worker_release_broker_upgrade_bootstrap import (
    NO_PREVIOUS_GENERATION, bootstrap_generation,
)
from worker_release_broker_generation_fs import _open_directory
from worker_release_broker_upgrade_control import (
    BROKER_SOCKET, BROKER_UNIT, BrokerControl, READY_TIMEOUT_SECONDS,
    STOP_TIMEOUT_SECONDS, SystemdBrokerControl, read_broker_generation_status,
)
from worker_release_broker_upgrade_errors import BrokerUpgradeRecoveryRequired, BrokerUpgradeRejected
from worker_release_broker_upgrade_journal import (
    JOURNAL_PATH, clear_upgrade_journal, read_upgrade_journal, write_upgrade_journal,
)

HEX_256 = re.compile(r"^[0-9a-f]{64}$")


def _generation(value: object) -> bool:
    return isinstance(value, str) and bool(HEX_256.fullmatch(value))


def _lock(root: Path, *, owner_uid: int, root_gid: int,
          mode: int = 0o755) -> tuple[int, int]:
    root_fd = _open_directory(root, uid=owner_uid, gid=root_gid, mode=mode)
    try:
        try:
            fd = os.open(".upgrade.lock", os.O_RDWR | os.O_CREAT | os.O_CLOEXEC |
                         getattr(os, "O_NOFOLLOW", 0), 0o600, dir_fd=root_fd)
        except OSError as error:
            raise BrokerUpgradeRejected("broker upgrade lock cannot be opened safely") from error
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != owner_uid or info.st_gid != root_gid
                or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600):
            os.close(fd)
            raise BrokerUpgradeRejected("broker upgrade lock metadata is unsafe")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
        except OSError as error:
            os.close(fd)
            raise BrokerUpgradeRejected("broker upgrade lock cannot be acquired") from error
        return root_fd, fd
    except BaseException:
        os.close(root_fd)
        raise


def _journal(phase: str, txid: str, old: str, new: str) -> dict[str, object]:
    return {"version": 1, "transaction_id": txid, "phase": phase,
            "old_digest": old, "new_digest": new, "unit": BROKER_UNIT}


def upgrade_generation(root: Path, new_digest: str, *, control: BrokerControl,
                       journal_path: Path = JOURNAL_PATH, owner_uid: int = 0,
                       root_gid: int = 0,
                       state_root: Path | None = None,
                       state_mode: int = 0o700, transaction_root: Path | None = None,
                       ready_timeout: int = READY_TIMEOUT_SECONDS) -> str:
    """Stop, switch, and verify the exact digest; restore old on any failure."""
    if (owner_uid == 0 and os.geteuid() != 0) or not _generation(new_digest):
        raise BrokerUpgradeRejected("broker upgrade requires root and a valid generation")
    verify_generation(root, new_digest, owner_uid=owner_uid, root_gid=root_gid)
    if state_root is not None and transaction_root is None:
        raise BrokerUpgradeRejected("separate broker pointer and journal roots are required")
    lock_root = transaction_root or root
    root_fd, lock_fd = _lock(lock_root, owner_uid=owner_uid, root_gid=root_gid,
                             mode=0o700 if transaction_root is not None else 0o755)
    try:
        if read_upgrade_journal(journal_path, owner_uid=owner_uid, owner_gid=root_gid) is not None:
            raise BrokerUpgradeRejected("an unresolved broker upgrade already exists")
        old_digest = current_generation(root, owner_uid=owner_uid, root_gid=root_gid,
                                        state_root=state_root, state_mode=state_mode)
        if old_digest is None or old_digest == new_digest:
            raise BrokerUpgradeRejected("upgrade requires a distinct installed previous generation")
        control.wait_ready(old_digest, time.monotonic() + ready_timeout)
        txid = os.urandom(16).hex()
        record = _journal("prepared", txid, old_digest, new_digest)
        write_upgrade_journal(record, journal_path, owner_uid=owner_uid, owner_gid=root_gid)
        try:
            control.stop_and_prove()
            record = _journal("stopped", txid, old_digest, new_digest)
            write_upgrade_journal(record, journal_path, owner_uid=owner_uid, owner_gid=root_gid)
            switch_generation(root, new_digest, expected_current=old_digest,
                              owner_uid=owner_uid, root_gid=root_gid, state_root=state_root,
                              state_mode=state_mode)
            record = _journal("switched", txid, old_digest, new_digest)
            write_upgrade_journal(record, journal_path, owner_uid=owner_uid, owner_gid=root_gid)
            record = _journal("started", txid, old_digest, new_digest)
            write_upgrade_journal(record, journal_path, owner_uid=owner_uid, owner_gid=root_gid)
            # The launcher treats this phase as a one-way, mutation-blocked
            # start authorization and does not recursively acquire our lock.
            control.start()
            control.wait_ready(new_digest, time.monotonic() + ready_timeout)
            if current_generation(root, owner_uid=owner_uid, root_gid=root_gid,
                                  state_root=state_root, state_mode=state_mode) != new_digest:
                raise BrokerUpgradeRejected("current pointer changed before upgrade commit")
            clear_upgrade_journal(journal_path, owner_uid=owner_uid,
                                  owner_gid=root_gid, transaction_id=txid)
            return new_digest
        except BaseException as error:
            try:
                write_upgrade_journal(_journal("recovery_required", txid, old_digest, new_digest),
                                      journal_path, owner_uid=owner_uid, owner_gid=root_gid)
                control.stop_and_prove()
                current = current_generation(root, owner_uid=owner_uid, root_gid=root_gid,
                                             state_root=state_root, state_mode=state_mode)
                if current not in {old_digest, new_digest}:
                    raise BrokerUpgradeRejected("current generation left the transaction fence")
                if current != old_digest:
                    switch_generation(root, old_digest, expected_current=current,
                                      owner_uid=owner_uid, root_gid=root_gid, state_root=state_root,
                                      state_mode=state_mode)
                write_upgrade_journal(_journal("rollback_starting", txid, old_digest, new_digest),
                                      journal_path, owner_uid=owner_uid, owner_gid=root_gid)
                control.start()
                control.wait_ready(old_digest, time.monotonic() + ready_timeout)
                if current_generation(root, owner_uid=owner_uid, root_gid=root_gid,
                                      state_root=state_root, state_mode=state_mode) != old_digest:
                    raise BrokerUpgradeRejected("previous pointer changed before rollback commit")
                clear_upgrade_journal(journal_path, owner_uid=owner_uid,
                                      owner_gid=root_gid, transaction_id=txid)
            except BaseException as rollback_error:
                try:
                    write_upgrade_journal(_journal("recovery_required", txid,
                                                    old_digest, new_digest),
                                          journal_path, owner_uid=owner_uid,
                                          owner_gid=root_gid)
                except BaseException:
                    pass
                raise BrokerUpgradeRecoveryRequired(
                    "broker rollback could not be verified; durable journal retained"
                ) from rollback_error
            raise BrokerUpgradeRejected("broker upgrade failed; previous generation restored") from error
    finally:
        os.close(lock_fd)
        os.close(root_fd)


def recover_before_start(root: Path, *, control: BrokerControl,
                         journal_path: Path = JOURNAL_PATH, owner_uid: int = 0,
                         root_gid: int = 0, state_root: Path | None = None,
                         state_mode: int = 0o700,
                         transaction_root: Path | None = None) -> str | None:
    """Fail fast or allow only the journal-authorized, mutation-blocked start."""
    del transaction_root  # Start-time code must never wait on its parent-held lock.
    record = read_upgrade_journal(journal_path, owner_uid=owner_uid, owner_gid=root_gid)
    current = current_generation(root, owner_uid=owner_uid, root_gid=root_gid,
                                 state_root=state_root, state_mode=state_mode)
    if record is None:
        return current
    old, new = record["old_digest"], record["new_digest"]
    if record["phase"] == "started" and current == new:
        verify_generation(root, new, owner_uid=owner_uid, root_gid=root_gid)
        prestart = getattr(control, "prove_prestart_safe", None)
        if not callable(prestart):
            raise BrokerUpgradeRecoveryRequired("systemd prestart proof is unavailable")
        prestart()
        return new
    if record["phase"] == "bootstrap_started" and current == new \
            and old == NO_PREVIOUS_GENERATION:
        verify_generation(root, new, owner_uid=owner_uid, root_gid=root_gid)
        prestart = getattr(control, "prove_prestart_safe", None)
        if not callable(prestart):
            raise BrokerUpgradeRecoveryRequired("systemd prestart proof is unavailable")
        prestart()
        return new
    if record["phase"] == "rollback_starting" and current == old:
        verify_generation(root, old, owner_uid=owner_uid, root_gid=root_gid)
        prestart = getattr(control, "prove_prestart_safe", None)
        if not callable(prestart):
            raise BrokerUpgradeRecoveryRequired("systemd prestart proof is unavailable")
        prestart()
        return old
    # A journaled transaction may be owned by a live provisioner holding the
    # transaction lock. Failing fast avoids start/stop lock recursion; the
    # authorized provisioner performs terminal recovery before any mutation.
    raise BrokerUpgradeRecoveryRequired("broker upgrade requires provisioner recovery")


def recover_interrupted_upgrade(root: Path, *, control: BrokerControl,
                                journal_path: Path = JOURNAL_PATH, owner_uid: int = 0,
                                root_gid: int = 0, state_root: Path | None = None,
                                state_mode: int = 0o700,
                                transaction_root: Path | None = None,
                                ready_timeout: int = READY_TIMEOUT_SECONDS) -> str | None:
    """Stop and restore an interrupted transaction before installer changes."""
    if state_root is not None and transaction_root is None:
        raise BrokerUpgradeRejected("separate broker pointer and journal roots are required")
    lock_root = transaction_root or root
    root_fd, lock_fd = _lock(lock_root, owner_uid=owner_uid, root_gid=root_gid,
                             mode=0o700 if transaction_root is not None else 0o755)
    try:
        record = read_upgrade_journal(journal_path, owner_uid=owner_uid, owner_gid=root_gid)
        if record is None:
            return None
        old, new = record["old_digest"], record["new_digest"]
        if old == NO_PREVIOUS_GENERATION:
            control.stop_and_prove()
            current = current_generation(root, owner_uid=owner_uid, root_gid=root_gid,
                                         state_root=state_root, state_mode=state_mode)
            if current not in {None, new}:
                raise BrokerUpgradeRecoveryRequired(
                    "bootstrap pointer is outside its transaction fence")
            if current == new:
                clear_generation_pointer(root, expected_current=new, owner_uid=owner_uid,
                                         root_gid=root_gid, state_root=state_root,
                                         state_mode=state_mode)
            clear_upgrade_journal(journal_path, owner_uid=owner_uid,
                                  owner_gid=root_gid, transaction_id=record["transaction_id"])
            return None
        verify_generation(root, old, owner_uid=owner_uid, root_gid=root_gid)
        control.stop_and_prove()
        current = current_generation(root, owner_uid=owner_uid, root_gid=root_gid,
                                     state_root=state_root, state_mode=state_mode)
        if current not in {old, new}:
            raise BrokerUpgradeRecoveryRequired("current pointer is outside upgrade journal")
        if current != old:
            switch_generation(root, old, expected_current=current, owner_uid=owner_uid,
                              root_gid=root_gid, state_root=state_root, state_mode=state_mode)
        write_upgrade_journal(_journal("rollback_starting", record["transaction_id"], old, new),
                              journal_path, owner_uid=owner_uid, owner_gid=root_gid)
        control.start()
        control.wait_ready(old, time.monotonic() + ready_timeout)
        if current_generation(root, owner_uid=owner_uid, root_gid=root_gid,
                             state_root=state_root, state_mode=state_mode) != old:
            raise BrokerUpgradeRecoveryRequired("previous pointer changed during recovery")
        clear_upgrade_journal(journal_path, owner_uid=owner_uid,
                              owner_gid=root_gid, transaction_id=record["transaction_id"])
        return old
    finally:
        os.close(lock_fd)
        os.close(root_fd)


def mutations_blocked(journal_path: Path = JOURNAL_PATH, *, owner_uid: int = 0,
                      owner_gid: int = 0) -> bool:
    """Fail closed for broker operations while an upgrade is unresolved."""
    return read_upgrade_journal(journal_path, owner_uid=owner_uid, owner_gid=owner_gid) is not None


__all__ = ["BROKER_SOCKET", "BROKER_UNIT", "BrokerUpgradeRecoveryRequired",
           "BrokerUpgradeRejected", "SystemdBrokerControl", "mutations_blocked",
           "bootstrap_generation", "read_broker_generation_status", "recover_before_start",
           "recover_interrupted_upgrade", "upgrade_generation"]
