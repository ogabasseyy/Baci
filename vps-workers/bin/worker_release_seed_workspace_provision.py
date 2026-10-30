"""Provision or recover the fixed quota-backed seed-generation filesystem."""
from __future__ import annotations

import os
import stat
import subprocess
import sys
from pathlib import Path
from typing import Callable

from worker_release_dependency_artifacts import BuilderRejected
from worker_release_seed_workspace_journal import SeedWorkspaceJournal
from worker_release_seed_workspace_recovery import recover_interrupted_setup
import worker_release_seed_workspace as policy
from worker_release_seed_workspace_paths import (
    ensure_seed_collection,
    ensure_seed_workspace_directories,
    trusted_directory,
)


def provision_seed_workspace(*, runner: Callable[..., object] = subprocess.run,
                             fallocate: Callable[[int, int, int], None] | None = None) -> None:
    if os.geteuid() != 0 or sys.platform != "linux":
        raise BuilderRejected("seed workspace provisioning requires root on Linux")
    if fallocate is None:
        fallocate = getattr(os, "posix_fallocate", None)
    if not callable(fallocate):
        raise BuilderRejected("host filesystem lacks bounded image allocation support")
    if (policy.EXPECTED_OBSERVED_BYTES >= policy.IMAGE_BYTES
            or policy.EXPECTED_OBSERVED_INODES >= policy.INODE_COUNT):
        raise BuilderRejected("seed workspace ceiling is below observed graph evidence")
    owner_uid = os.geteuid()

    cache_root = policy.IMAGE.parent.parent
    trusted_directory(cache_root)
    if not os.path.lexists(policy.WORK_ROOT):
        ensure_seed_workspace_directories(cache_root, owner_uid=owner_uid)
    else:
        trusted_directory(policy.IMAGE.parent)
    trusted_directory(policy.UNIT_DIR)

    with SeedWorkspaceJournal(policy.IMAGE.parent, owner_uid=owner_uid) as journal:
        recovered = recover_interrupted_setup(
            journal, runner=runner, image=policy.IMAGE, workspace=policy.WORK_ROOT,
            unit_dir=policy.UNIT_DIR, unit_name=policy.UNIT_NAME,
            unit_payload=policy.mount_unit_contents(), image_bytes=policy.IMAGE_BYTES,
            verify_complete=lambda identity: policy._verify_mount(
                runner, image_identity=identity),
            owner_uid=owner_uid,
        )
        if recovered == "complete":
            ensure_seed_collection(policy.WORK_ROOT, owner_uid=owner_uid)
            return
        if recovered == "absent" and (
            os.path.lexists(policy.IMAGE) or os.path.lexists(policy.UNIT_DIR / policy.UNIT_NAME)
            or os.path.ismount(policy.WORK_ROOT)
        ):
            raise BuilderRejected("unrecorded seed workspace artifacts cannot be adopted")

        trusted_directory(policy.IMAGE.parent)
        trusted_directory(policy.WORK_ROOT, exact_mode=0o700, require_empty=True)
        policy.host_capacity(parent=cache_root)
        record = journal.begin()
        image_fd = -1
        try:
            image_fd = os.open(policy.IMAGE, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            image_info = os.fstat(image_fd)
            image_identity = image_info.st_dev, image_info.st_ino
            record = journal.update(record, phase="image_created", image_identity=image_identity)
            fallocate(image_fd, 0, policy.IMAGE_BYTES)
            os.fsync(image_fd)
            image_info = os.fstat(image_fd)
            if (not stat.S_ISREG(image_info.st_mode) or image_info.st_uid != owner_uid
                    or image_info.st_nlink != 1 or image_info.st_size != policy.IMAGE_BYTES
                    or (image_info.st_dev, image_info.st_ino) != image_identity):
                raise BuilderRejected("seed image identity is unsafe")
            policy.host_capacity(
                parent=cache_root,
                minimum_bytes=policy.PUBLISHED_SEED_ROOT_MAX_BYTES + policy.HOST_RESERVE_BYTES,
            )
            os.close(image_fd)
            image_fd = -1

            record = journal.update(record, phase="formatting")
            _assert_image_identity(policy.IMAGE, image_identity, policy.IMAGE_BYTES)
            policy._run(runner, ("/usr/sbin/mkfs.ext4", "-F", "-m", "0", "-N",
                                 str(policy.INODE_COUNT), "-L", "baci-seed-work",
                                 str(policy.IMAGE)), timeout=300)

            record = journal.update(record, phase="unit_installing")
            policy._write_unit(
                policy.UNIT_DIR / policy.UNIT_NAME, policy.mount_unit_contents(),
                transaction_id=str(record["transaction_id"]))
            policy._run(runner, ("/usr/bin/systemctl", "daemon-reload"), timeout=10)
            record = journal.update(record, phase="enabling")
            policy._run(runner, ("/usr/bin/systemctl", "enable", "--now", policy.UNIT_NAME), timeout=90)
            policy._secure_mounted_root()
            policy._verify_mount(runner, image_identity=image_identity)
            ensure_seed_collection(policy.WORK_ROOT, owner_uid=owner_uid)
            journal.update(record, phase="complete", image_identity=image_identity)
        except BaseException as error:
            if image_fd >= 0:
                os.close(image_fd)
            try:
                recover_interrupted_setup(
                    journal, runner=runner, image=policy.IMAGE,
                    workspace=policy.WORK_ROOT, unit_dir=policy.UNIT_DIR,
                    unit_name=policy.UNIT_NAME, unit_payload=policy.mount_unit_contents(),
                    image_bytes=policy.IMAGE_BYTES,
                    verify_complete=lambda identity: policy._verify_mount(
                        runner, image_identity=identity),
                    owner_uid=owner_uid,
                )
            except BaseException as recovery_error:
                raise BuilderRejected(
                    "seed workspace setup failed; durable recovery record was preserved"
                ) from recovery_error
            raise error


def _assert_image_identity(path: Path, identity: tuple[int, int], expected_size: int) -> None:
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_nlink != 1
            or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size != expected_size
            or (info.st_dev, info.st_ino) != identity):
        raise BuilderRejected("seed workspace image changed before formatting")
