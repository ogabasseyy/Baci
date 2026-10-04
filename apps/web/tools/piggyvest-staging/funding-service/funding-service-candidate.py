#!/usr/bin/env python3
"""Owner-run candidate for an inactive hosted savings funding service."""

import argparse
import grp
import hashlib
import os
import pwd
import stat
import sys
from pathlib import Path

UNIT_NAME = 'baci-savings-funding.service'
DEADLINE_SERVICE_NAME = 'baci-savings-funding-deadline.service'
DEADLINE_TIMER_NAME = 'baci-savings-funding-deadline.timer'
LEASE_DEADLINE = '2026-09-29 15:59:10 UTC'
LEASE_DEADLINE_EPOCH = '1790697550'
ARTIFACT_ROOT = Path('/opt/baci-savings-funding')
SERVICE_ACCOUNT = 'baci-savings-funding'
SERVICE_GROUP = 'baci-savings-funding'
CONFIG_PATH = Path('/etc/baci/piggyvest-staging/funding-service.env')
DB_CA_PATH = Path('/etc/baci/piggyvest-staging/postgres-ca.pem')
DB_CA_CREDENTIAL = 'PIGGYVEST_SAVINGS_FUNDING_DB_CA'
UNIT_DIRECTORY = Path('/etc/systemd/system')
# sha256 of the service unit installed on isolated staging by the candidate
# revision before the CREDENTIALS_DIRECTORY unset. The update mode rewrites
# the unit only when the on-disk bytes match this pin or are already current.
PRIOR_UNIT_SHA256 = '4a010621766ed0740b3ac11c3692692012558771e4a40ede71b20def07b41453'


class Refused(RuntimeError):
    pass


def _require_safe_path(
    path: Path, expected_type: int, label: str, owner_uid: int = 0
) -> None:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise Refused(f'{label} is required.') from error
    if (
        stat.S_IFMT(metadata.st_mode) != expected_type
        or metadata.st_uid != owner_uid
        or metadata.st_mode & 0o022
    ):
        raise Refused(f'{label} is unsafe.')


def _verify_root_owned_ancestors(path: Path, label: str) -> None:
    for ancestor in reversed((path, *path.parents)):
        _require_safe_path(ancestor, stat.S_IFDIR, label)


def _is_environment_file(path: Path) -> bool:
    return path.name == '.env' or path.name.startswith('.env.')


def _verify_resolved_artifact_path(root: Path, path: Path, owner_uid: int) -> None:
    try:
        relative_path = path.relative_to(root)
    except ValueError as error:
        raise Refused('Funding artifact link escapes the fixed root.') from error
    target_type = stat.S_IFDIR if path.is_dir() else stat.S_IFREG
    for index in range(len(relative_path.parts) + 1):
        ancestor = root.joinpath(*relative_path.parts[:index])
        expected_type = stat.S_IFDIR if ancestor != path else target_type
        _require_safe_path(ancestor, expected_type, 'Funding artifact link target', owner_uid)


def _verify_relative_link(entry: Path, root: Path, owner_uid: int) -> None:
    try:
        target = os.readlink(entry)
    except OSError as error:
        raise Refused('Funding artifact link is unreadable.') from error
    if Path(target).is_absolute():
        raise Refused('Funding artifact link must be relative.')
    lexical_target = Path(os.path.normpath(entry.parent / target))
    try:
        lexical_target.relative_to(root)
    except ValueError as error:
        raise Refused('Funding artifact link escapes the fixed root.') from error
    try:
        resolved = entry.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise Refused('Funding artifact link is dangling or cyclic.') from error
    if _is_environment_file(resolved):
        raise Refused('Funding artifact link targets an environment file.')
    _verify_resolved_artifact_path(root, resolved, owner_uid)


def _verify_artifact_tree(root: Path, owner_uid: int = 0) -> None:
    try:
        resolved_root = root.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise Refused('Funding artifact root is unreadable.') from error
    _require_safe_path(resolved_root, stat.S_IFDIR, 'Funding artifact tree', owner_uid)
    for current_root, directories, files in os.walk(resolved_root, followlinks=False):
        current = Path(current_root)
        _require_safe_path(current, stat.S_IFDIR, 'Funding artifact tree', owner_uid)
        for name in (*directories, *files):
            entry = current / name
            try:
                metadata = entry.lstat()
            except OSError as error:
                raise Refused('Funding artifact tree is unreadable.') from error
            if stat.S_ISLNK(metadata.st_mode):
                _verify_relative_link(entry, resolved_root, owner_uid)
                continue
            expected_type = stat.S_IFDIR if name in directories else stat.S_IFREG
            _require_safe_path(entry, expected_type, 'Funding artifact tree', owner_uid)


def _service_identity() -> tuple[int, int]:
    try:
        account = pwd.getpwnam(SERVICE_ACCOUNT)
        group = grp.getgrnam(SERVICE_GROUP)
    except KeyError as error:
        raise Refused('Funding service account and group are required.') from error
    if account.pw_uid == 0 or group.gr_gid == 0:
        raise Refused('Funding service must not run as root.')
    return account.pw_uid, group.gr_gid


def _require_service_access(path: Path, required: int, uid: int, gid: int) -> None:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise Refused('Funding artifact access cannot be verified.') from error
    shift = 6 if metadata.st_uid == uid else 3 if metadata.st_gid == gid else 0
    if ((metadata.st_mode >> shift) & required) != required:
        raise Refused('Funding service cannot read or traverse the artifact.')


def _verify_service_artifact_access(root: Path) -> None:
    uid, gid = _service_identity()
    for ancestor in reversed((root, *root.parents)):
        _require_service_access(ancestor, 0o1, uid, gid)
    for current_root, directories, files in os.walk(root, followlinks=False):
        current = Path(current_root)
        _require_service_access(current, 0o5, uid, gid)
        for name in (*directories, *files):
            entry = current / name
            if entry.is_symlink():
                try:
                    entry = entry.resolve(strict=True)
                except (OSError, RuntimeError) as error:
                    raise Refused('Funding artifact access cannot be verified.') from error
            required = 0o5 if entry.is_dir() else 0o4
            _require_service_access(entry, required, uid, gid)


def verify_artifact(root: Path = ARTIFACT_ROOT) -> None:
    if root != ARTIFACT_ROOT:
        raise Refused('Artifact root must be the fixed funding service path.')
    _verify_root_owned_ancestors(root, 'Funding artifact path')
    _verify_artifact_tree(root)
    _verify_service_artifact_access(root)
    required = (
        root / 'apps/web/server.js',
        root / 'apps/web/public',
        root / 'apps/web/.next/static',
        root / 'node_modules',
    )
    if not required[0].is_file() or not all(path.is_dir() for path in required[1:]):
        raise Refused('Standalone artifact is incomplete.')
    if any(_is_environment_file(path) for path in root.rglob('*')):
        raise Refused('Standalone artifact contains an environment file.')


def _verify_secret_config(path: Path, owner_uid: int = 0) -> None:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise Refused('Root-managed funding configuration is required.') from error
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_uid != owner_uid
        or metadata.st_nlink != 1
        or stat.S_IMODE(metadata.st_mode) not in (0o400, 0o600)
    ):
        raise Refused('Funding configuration permissions are unsafe.')


def _verify_ca_config(path: Path, owner_uid: int = 0) -> None:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise Refused('Root-managed funding CA certificate is required.') from error
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_uid != owner_uid
        or metadata.st_nlink != 1
        or stat.S_IMODE(metadata.st_mode) != 0o444
    ):
        raise Refused('Funding CA certificate permissions are unsafe.')


def verify_config_metadata() -> None:
    _verify_root_owned_ancestors(CONFIG_PATH.parent, 'Funding configuration path')
    _verify_secret_config(CONFIG_PATH)
    _verify_root_owned_ancestors(DB_CA_PATH.parent, 'Funding CA path')
    _verify_ca_config(DB_CA_PATH)


def verify_unit_directory() -> None:
    _verify_root_owned_ancestors(UNIT_DIRECTORY, 'Systemd unit path')


def render_unit() -> str:
    return f'''[Unit]
Description=Bounded hosted savings funding server (staging loopback)
After=network-online.target

[Service]
Type=simple
User={SERVICE_ACCOUNT}
Group={SERVICE_GROUP}
WorkingDirectory={ARTIFACT_ROOT}/apps/web
BindReadOnlyPaths={ARTIFACT_ROOT}
EnvironmentFile={CONFIG_PATH}
LoadCredential={DB_CA_CREDENTIAL}:{DB_CA_PATH}
ExecCondition=/bin/sh -c 'test "$BACI_SAVINGS_LEASE_EXPIRES_AT" = "{LEASE_DEADLINE_EPOCH}" && test "$(/bin/date -u +%%s)" -lt "{LEASE_DEADLINE_EPOCH}"'
ExecStart=/bin/sh -c 'export {DB_CA_CREDENTIAL}="$(cat $CREDENTIALS_DIRECTORY/{DB_CA_CREDENTIAL})"; unset CREDENTIALS_DIRECTORY; exec /usr/bin/env NODE_ENV=production BACI_WORKER_PROFILE=hosted-savings-funding PORT=4795 HOSTNAME=127.0.0.1 /usr/bin/node server.js'
Restart=no
KillMode=control-group
TimeoutStopSec=5s
LimitCORE=0
RuntimeMaxSec=7d
NoNewPrivileges=yes
CapabilityBoundingSet=
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
UMask=0007
StandardOutput=journal
StandardError=journal
'''


def render_deadline_service() -> str:
    return f'''[Unit]
Description=Stop hosted savings funding at the staging lease deadline

[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl stop {UNIT_NAME}
'''


def render_deadline_timer() -> str:
    return f'''[Unit]
Description=Absolute staging lease deadline for hosted savings funding

[Timer]
OnCalendar={LEASE_DEADLINE}
AccuracySec=1s
Unit={DEADLINE_SERVICE_NAME}

[Install]
WantedBy=timers.target
'''


def install_unit() -> None:
    if os.geteuid() != 0:
        raise Refused('Owner-reviewed root execution is required.')
    verify_artifact()
    verify_config_metadata()
    verify_unit_directory()
    units = {
        UNIT_NAME: render_unit(),
        DEADLINE_SERVICE_NAME: render_deadline_service(),
        DEADLINE_TIMER_NAME: render_deadline_timer(),
    }
    for name in units:
        target = UNIT_DIRECTORY / name
        if target.exists() or target.is_symlink():
            raise Refused('Funding service unit already exists; refusing overwrite.')
    for name, content in units.items():
        target = UNIT_DIRECTORY / name
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            handle.write(content)
        os.chown(target, 0, 0)
        os.chmod(target, 0o644)


def _remove_stale_update_staging(staging: Path) -> None:
    try:
        metadata = staging.lstat()
    except FileNotFoundError:
        return
    except OSError as error:
        raise Refused('Funding service update staging is unreadable.') from error
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_uid != 0
        or metadata.st_nlink != 1
    ):
        raise Refused('Funding service update staging is unsafe.')
    try:
        staging.unlink()
    except OSError as error:
        raise Refused('Funding service update staging cannot be cleared.') from error


def update_unit() -> str:
    if os.geteuid() != 0:
        raise Refused('Owner-reviewed root execution is required.')
    verify_artifact()
    verify_config_metadata()
    verify_unit_directory()
    target = UNIT_DIRECTORY / UNIT_NAME
    try:
        metadata = target.lstat()
    except OSError as error:
        raise Refused('Funding service unit is required for update.') from error
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_uid != 0
        or metadata.st_nlink != 1
        or stat.S_IMODE(metadata.st_mode) != 0o644
    ):
        raise Refused('Funding service unit permissions are unsafe for update.')
    try:
        existing = target.read_bytes()
    except OSError as error:
        raise Refused('Funding service unit is unreadable for update.') from error
    current = render_unit().encode('utf-8')
    if existing == current:
        return 'already current'
    if hashlib.sha256(existing).hexdigest() != PRIOR_UNIT_SHA256:
        raise Refused('Funding service unit changed outside the candidate; refusing update.')
    staging = UNIT_DIRECTORY / (UNIT_NAME + '.candidate-update')
    _remove_stale_update_staging(staging)
    try:
        descriptor = os.open(staging, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    except OSError as error:
        raise Refused('Funding service update staging failed.') from error
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(current)
    os.chown(staging, 0, 0)
    os.chmod(staging, 0o644)
    os.replace(staging, target)
    return 'updated'


def main(arguments: list[str]) -> int:
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--check', action='store_true')
    modes.add_argument('--install', action='store_true')
    modes.add_argument('--update-unit', action='store_true')
    parsed = parser.parse_args(arguments)
    try:
        verify_artifact()
        verify_config_metadata()
        verify_unit_directory()
        if parsed.install:
            install_unit()
        elif parsed.update_unit:
            print(f'Funding service unit {update_unit()}; no service was started or enabled.')
            return 0
    except (OSError, RuntimeError):
        print('Funding service candidate refused; no service was started or enabled.', file=sys.stderr)
        return 1
    print('Funding service candidate checked; no service was started or enabled.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
