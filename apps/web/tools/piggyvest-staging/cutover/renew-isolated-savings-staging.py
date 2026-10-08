#!/usr/bin/env python3
"""Owner-only policy primitives for one seven-day isolated-staging renewal.

This deliberately does not start services, alter Nginx, deploy an application,
or read credentials. The final root-sealed updater consumes these primitives
only after the owner has attested the predecessor installation receipt.
"""

import os
import stat
from pathlib import Path


WEEK_SECONDS = 7 * 24 * 60 * 60
OLD_DRAFT_EXPIRY = 1789989845


class Refused(RuntimeError):
    pass


def renewal_expiry(activated_at: int) -> int:
    if not isinstance(activated_at, int) or activated_at <= 0:
        raise Refused('activation time')
    return activated_at + WEEK_SECONDS


def validate_renewal_window(activated_at: int, expires_at: int) -> None:
    if renewal_expiry(activated_at) != expires_at:
        raise Refused('renewal must be exactly seven days')


def require_absent(path: Path, label: str) -> None:
    if path.exists() or path.is_symlink():
        raise Refused(f'{label} already exists')


def archive_expired_gateway_files(
    config: Path, archive: Path, owner_uid: int = 0
) -> tuple[str, ...]:
    names = ('binding.json', 'startup-evidence.json')
    require_absent(archive, 'renewal archive')
    archive.mkdir(mode=0o700)
    archived = []
    try:
        for name in names:
            source = config / name
            if not source.exists() and not source.is_symlink():
                continue
            info = source.lstat()
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_uid != owner_uid
                or info.st_nlink != 1
            ):
                raise Refused('expired gateway evidence is unsafe')
            os.replace(source, archive / name)
            archived.append(name)
    except Exception:
        for name in reversed(archived):
            os.replace(archive / name, config / name)
        archive.rmdir()
        raise
    return tuple(archived)


def renew_draft_service(service: str, expires_at: int) -> str:
    old_condition = (
        "ExecCondition=/bin/sh -c '[ \"$(/bin/date -u +%%s)\" -lt "
        f'{OLD_DRAFT_EXPIRY} ]\'\n'
    )
    if service.count(old_condition) != 1 or service.count('RuntimeMaxSec=1d\n') != 1:
        raise Refused('unexpected draft service')
    return service.replace(
        old_condition,
        "ExecCondition=/bin/sh -c '[ \"$(/bin/date -u +%%s)\" -lt "
        f'{expires_at} ]\'\n',
    ).replace('RuntimeMaxSec=1d\n', 'RuntimeMaxSec=7d\n')
