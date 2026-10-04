import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import stat
import subprocess
from typing import Callable, Optional, Sequence
from worker_contract import (
    ACCOUNT,
    CA_CREDENTIAL,
    CA_PATH,
    CHECK_SERVICE,
    CONTAINER,
    DATABASE,
    DATABASE_ROLE,
    DEADLINE_TIMER,
    EXPIRY_EPOCH,
    EXPIRES_AT,
    GROUP,
    InstallError,
    SECRET_PATH,
    SERVICE,
    SYSTEM_IDENTIFIER,
    TIMER,
    WORKER_PATH,
    database_url,
    provision_sql,
    role_preflight_sql,
    unit_files,
    validate_database_url,
)
from worker_install_io import ensure_directory, read_fixed, write_fixed


ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LANG': 'C', 'LC_ALL': 'C'}


@dataclass(frozen=True)
class Paths:
    root: Path = Path('/')

    def at(self, absolute: str) -> Path:
        return self.root / absolute.lstrip('/')


def _run(runner: Callable[..., subprocess.CompletedProcess], command: list[str], input_text: Optional[str] = None) -> str:
    try:
        options = {'env': ENV, 'capture_output': True, 'text': True, 'timeout': 90, 'check': False}
        if input_text is None:
            options['stdin'] = subprocess.DEVNULL
        else:
            options['input'] = input_text
        result = runner(command, **options)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise InstallError('Restricted installer command failed') from error
    if result.returncode != 0 or len(result.stdout) > 8192 or len(result.stderr) > 8192:
        raise InstallError('Restricted installer command failed')
    return result.stdout


def _local_docker(runner: Callable[..., subprocess.CompletedProcess]) -> None:
    context = _run(runner, ['docker', 'context', 'show']).strip()
    output = _run(runner, ['docker', 'context', 'inspect', '--format', '{{json .Endpoints.docker}}', context])
    try:
        host = json.loads(output).get('Host', '')
    except json.JSONDecodeError as error:
        raise InstallError('Docker endpoint could not be verified') from error
    if not isinstance(host, str) or not host.startswith('unix:///'):
        raise InstallError('Remote Docker endpoint refused')


def _docker_sql(runner: Callable[..., subprocess.CompletedProcess], sql: str) -> str:
    command = [
        'docker', 'exec', '-i', '-u', 'postgres', CONTAINER,
        'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres',
        '--dbname', DATABASE, '-A', '-t',
    ]
    return _run(runner, command, sql)


def read_worker(source: Path, expected_sha256: str, owner: int = 0) -> bytes:
    if re.fullmatch(r'[0-9a-f]{64}', expected_sha256) is None:
        raise InstallError('Reviewed worker SHA-256 is required')
    try:
        directory = source.parent.lstat()
        info = source.lstat()
        if (
            not stat.S_ISDIR(directory.st_mode)
            or directory.st_uid != owner
            or stat.S_IMODE(directory.st_mode) != 0o700
            or not stat.S_ISREG(info.st_mode)
            or info.st_uid != owner
            or info.st_nlink != 1
            or stat.S_IMODE(info.st_mode) != 0o400
        ):
            raise InstallError('Root-private reviewed worker bundle required')
        content = read_fixed(source, source.parent.parent, owner, 0o400, 20_000_000)
    except OSError as error:
        raise InstallError('Reviewed worker bundle unavailable') from error
    if hashlib.sha256(content).hexdigest() != expected_sha256:
        raise InstallError('Reviewed worker SHA-256 mismatch')
    if b'\x00' in content:
        raise InstallError('Invalid worker bundle bytes')
    return content


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description='Install the restricted savings-notification worker without enabling it.')
    parser.add_argument('--install', action='store_true', required=True)
    parser.add_argument('--worker-sha256', required=True)
    arguments = parser.parse_args(argv)
    if os.geteuid() != 0:
        print(json.dumps({'status': 'refused', 'error': 'root-required'}))
        return 1
    if datetime.now(timezone.utc).timestamp() >= EXPIRY_EPOCH:
        print(json.dumps({'status': 'refused', 'error': 'approval-expired'}))
        return 1
    try:
        bundle = read_worker(Path(__file__).with_name('worker.mjs'), arguments.worker_sha256)
        print(json.dumps(install(bundle, arguments.worker_sha256, Paths(Path('/')))))
    except InstallError as error:
        print(json.dumps({'status': 'refused', 'error': str(error)}))
        return 1
    return 0


def install(
    worker: bytes,
    expected_sha256: str,
    paths: Paths = Paths(),
    runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
    owner: int = 0,
    now: Optional[datetime] = None,
) -> dict[str, object]:
    instant = now or datetime.now(timezone.utc)
    if instant.timestamp() >= EXPIRY_EPOCH:
        raise InstallError('Approval expiry reached')
    digest = hashlib.sha256(worker).hexdigest()
    if re.fullmatch(r'[0-9a-f]{64}', expected_sha256) is None or digest != expected_sha256:
        raise InstallError('Reviewed worker SHA-256 mismatch')
    root = paths.root
    code = paths.at('/opt/baci-savings-notifications')
    installed_worker = paths.at(WORKER_PATH)
    worker_ca_path = paths.at(CA_CREDENTIAL)
    secret = paths.at(SECRET_PATH)
    ca = paths.at(CA_PATH)
    units = unit_files()
    unit_paths = {name: paths.at('/etc/systemd/system/' + name) for name in units}
    ca_bytes = read_fixed(ca, root, owner, 0o444, 1_000_000)
    if not ca_bytes:
        raise InstallError('PostgreSQL CA is empty')
    existing_worker_ca = None
    try:
        existing_worker_ca = read_fixed(worker_ca_path, root, owner, 0o444, 1_000_000)
    except FileNotFoundError:
        pass
    if existing_worker_ca is not None and existing_worker_ca != ca_bytes:
        raise InstallError('Existing worker CA does not match pinned source CA')
    existing_worker = None
    try:
        existing_worker = read_fixed(installed_worker, root, owner, 0o444, 20_000_000)
    except FileNotFoundError:
        pass
    if existing_worker is not None and existing_worker != worker:
        raise InstallError('Nonmatching worker artifact refused')
    if code.exists():
        existing_names = set(os.listdir(code))
        allowed_names = {'worker.mjs', 'postgres-ca.pem'}
        if not code.is_dir() or not existing_names.issubset(allowed_names):
            raise InstallError('Nonmatching worker directory refused')
        if 'worker.mjs' in existing_names and existing_worker is None:
            raise InstallError('Nonmatching worker directory refused')
        if 'postgres-ca.pem' in existing_names and existing_worker_ca is None:
            raise InstallError('Nonmatching worker directory refused')
    existing_units = {}
    for name, path in unit_paths.items():
        try:
            existing_units[name] = read_fixed(path, root, owner, 0o444, 200_000)
        except FileNotFoundError:
            existing_units[name] = None
        if existing_units[name] is not None and existing_units[name] != units[name]:
            raise InstallError('Nonmatching systemd unit refused')
    existing_secret = None
    try:
        existing_secret = read_fixed(secret, root, owner, 0o600, 8192)
    except FileNotFoundError:
        pass
    password = validate_database_url(existing_secret) if existing_secret is not None else secrets.token_urlsafe(48)
    secret_bytes = (database_url(password) + '\n').encode('ascii')
    if existing_secret is not None and existing_secret != secret_bytes:
        raise InstallError('Nonmatching database credential refused')
    fixed_config = (
        existing_worker == worker
        and existing_worker_ca == ca_bytes
        and all(existing_units.get(name) == data for name, data in units.items())
        and existing_secret == secret_bytes
    )
    _local_docker(runner)
    role_state = _docker_sql(runner, role_preflight_sql()).splitlines()
    if role_state != ['BACI_WORKER_ROLE=NOLOGIN'] and not (
        fixed_config and role_state == ['BACI_WORKER_ROLE=LOGIN']
    ):
        raise InstallError('Existing PostgreSQL worker login is not owned fixed configuration')
    _validate_or_create_account(runner, owner)
    ensure_directory(code, root, owner, 0o755)
    ensure_directory(secret.parent, root, owner, 0o700)
    write_fixed(secret, secret_bytes, root, owner, 0o600)
    write_fixed(installed_worker, worker, root, owner, 0o444)
    write_fixed(worker_ca_path, ca_bytes, root, owner, 0o444)
    for name, path in unit_paths.items():
        write_fixed(path, units[name], root, owner, 0o444)
    _run(runner, ['/usr/bin/systemd-analyze', 'verify', *[str(path) for path in unit_paths.values()]])
    _run(runner, ['/usr/bin/systemctl', 'daemon-reload'])
    provisioned = _docker_sql(runner, provision_sql(password, fixed_config)).splitlines()
    if provisioned != ['BACI_WORKER_ROLE_PROVISIONED']:
        raise InstallError('PostgreSQL worker provisioning was not confirmed')
    return {
        'status': 'installed-disabled',
        'workerSha256': digest,
        'workerPath': WORKER_PATH,
        'service': SERVICE,
        'checkService': CHECK_SERVICE,
        'timer': TIMER,
        'deadlineTimer': DEADLINE_TIMER,
        'expiresAt': EXPIRES_AT,
        'enableStartNext': [TIMER, DEADLINE_TIMER],
        'healthProofNext': f'systemctl start {CHECK_SERVICE}; verify successful read-only DB identity and role check',
    }


def _validate_or_create_account(runner: Callable[..., subprocess.CompletedProcess], owner: int) -> None:
    try:
        group = grp.getgrnam(GROUP)
    except KeyError:
        _run(runner, ['/usr/sbin/groupadd', '--system', GROUP]); group = grp.getgrnam(GROUP)
    try:
        account = pwd.getpwnam(ACCOUNT)
    except KeyError:
        _run(runner, ['/usr/sbin/useradd', '--system', '--no-create-home', '--no-user-group', '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin', '--gid', GROUP, '--password', '!', ACCOUNT]); account = pwd.getpwnam(ACCOUNT)
    unsafe = (account.pw_uid == 0 or account.pw_gid != group.gr_gid or account.pw_dir != '/nonexistent' or account.pw_shell != '/usr/sbin/nologin' or group.gr_mem or any(ACCOUNT in item.gr_mem for item in grp.getgrall()))
    if unsafe: raise InstallError('Existing worker account or group is unsafe')
    status = _run(runner, ['/usr/bin/passwd', '-S', ACCOUNT]).split()
    if len(status) < 2 or status[1] != 'L': raise InstallError('Worker account must remain password-locked')


if __name__ == '__main__':
    raise SystemExit(main())
