import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
from datetime import datetime, timezone

import activation_contract as contract


ROOT_DIRECTORY = Path('/root')
SYSTEMD_DIR = Path('/etc/systemd/system')
CHECKER = contract.CONTAINER + '-check'
DATABASE_SQL = """BEGIN READ ONLY;
SELECT jsonb_build_object(
 'system',(SELECT system_identifier::text FROM pg_control_system()),
 'functionExecute',has_function_privilege('prefunded_treasury_operator',
  'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)','EXECUTE'),
 'schemaUsage',has_schema_privilege('prefunded_treasury_operator',
  'piggyvest_savings_ledger','USAGE'));
ROLLBACK;"""


def execute(arguments, source=None, timeout=30):
    return subprocess.run(arguments, input=source, text=True, capture_output=True,
                          check=True, timeout=timeout,
                          env=dict(HOME='/root', PATH='/usr/sbin:/usr/bin:/sbin:/bin',
                                   LANG='C', LC_ALL='C'))


def database(source):
    return execute(['/usr/bin/docker', 'exec', '-i', 'baci-isolated-savings-db-1',
                    'psql', '-XqAt', '-U', 'postgres', '-d', 'postgres',
                    '-v', 'ON_ERROR_STOP=1'], source).stdout.strip()


def docker(arguments, checked=True):
    result = subprocess.run(['/usr/bin/docker', '--host=unix:///var/run/docker.sock',
                             *arguments], text=True, capture_output=True, timeout=30,
                            env=dict(HOME='/root', PATH='/usr/sbin:/usr/bin:/sbin:/bin',
                                     LANG='C', LC_ALL='C'))
    if checked and result.returncode:
        raise ValueError('docker-refused')
    return result


def _root_path(path):
    for parent in reversed(path.parents):
        info = parent.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0
                or stat.S_IMODE(info.st_mode) & 0o022):
            raise ValueError('unsafe-parent')


def _private_file(path, mode, digest):
    _root_path(path)
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
            or stat.S_IMODE(info.st_mode) != mode):
        raise ValueError('unsafe-private-file')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        actual = stream.read(2_000_001)
    if len(actual) > 2_000_000 or hashlib.sha256(actual).hexdigest() != digest:
        raise ValueError('private-file-pin')
    return dict(path=str(path), sha256=digest, owner=0, mode=oct(mode), links=1)


def _unit_file(path, expected):
    return _private_file(path, 0o644, hashlib.sha256(expected).hexdigest())


def _container_state(name, run_docker):
    result = run_docker(['inspect', name], checked=False)
    if result.returncode:
        raise ValueError('container-missing')
    values = json.loads(result.stdout)
    if len(values) != 1:
        raise ValueError('container-identity')
    value = values[0]
    if (value['Name'] != '/' + name or value['Image'] != contract.IMAGE
            or value['State']['Running'] or value['State']['Paused']
            or value['State']['Restarting']
            or value['HostConfig']['RestartPolicy']['Name'] != 'no'):
        raise ValueError('checker-not-owned-stopped-pinned')
    return value


def _database_guard(query):
    state = json.loads(query(DATABASE_SQL))
    if (state != dict(system='7685292944002592802', functionExecute=False,
                      schemaUsage=False)):
        raise ValueError('bridge-authority-present')
    return state


def _no_actual_runtime(run_docker):
    inspected = run_docker(['inspect', contract.CONTAINER], checked=False)
    found = run_docker(['ps', '-aq', '--filter', 'name=^/' + contract.CONTAINER + '$'])
    if not inspected.returncode or found.stdout.strip():
        raise ValueError('actual-runtime-exists')


def _verify_units(units, run_command):
    for name in units:
        path = SYSTEMD_DIR / name
        output = run_command(['/usr/bin/systemctl', 'show', name,
            '--property=LoadState', '--property=DropInPaths', '--property=NeedDaemonReload',
            '--property=FragmentPath', '--property=ActiveState']).stdout
        values = dict(line.split('=', 1) for line in output.splitlines())
        if (values.get('LoadState') != 'loaded' or values.get('DropInPaths') != ''
                or values.get('NeedDaemonReload') != 'no'
                or values.get('FragmentPath') != str(path)
                or values.get('ActiveState') != 'inactive'):
            raise ValueError('unit-runtime-state')


def _write_manifest(directory, manifest):
    path = directory / 'manifest.json'
    payload = (json.dumps(manifest, sort_keys=True, indent=2) + '\n').encode()
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())
    directory_descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(directory_descriptor)
    finally:
        os.close(directory_descriptor)
    return path


def run(query=None, run_docker=None, run_command=None):
    query = query or database
    run_docker = run_docker or docker
    run_command = run_command or execute
    if os.geteuid() != 0:
        raise ValueError('root-required')
    os.umask(0o077)
    if not ROOT_DIRECTORY.is_dir() or ROOT_DIRECTORY.is_symlink():
        raise ValueError('recovery-root-missing')
    _root_path(ROOT_DIRECTORY / 'probe')

    target_info = contract.TARGET.lstat()
    if (not stat.S_ISDIR(target_info.st_mode) or target_info.st_uid != 0
            or stat.S_IMODE(target_info.st_mode) != 0o700
            or set(item.name for item in contract.TARGET.iterdir()) != {'config.json', 'replay-daemon.mjs'}):
        raise ValueError('failed-target-shape')
    files = [
        _private_file(contract.TARGET / 'config.json', 0o440, contract.CONFIGURATION_SHA),
        _private_file(contract.TARGET / 'replay-daemon.mjs', 0o440, contract.DAEMON_SHA),
    ]
    units = contract.unit_files()
    for name, content in units.items():
        files.append(_unit_file(SYSTEMD_DIR / name, content))
    _verify_units(units, run_command)

    authority = _database_guard(query)
    checker = _container_state(CHECKER, run_docker)
    _no_actual_runtime(run_docker)

    if os.stat(contract.TARGET).st_dev != os.stat(ROOT_DIRECTORY).st_dev:
        raise ValueError('target-cross-device-archive')
    for name in units:
        if os.stat(SYSTEMD_DIR / name).st_dev != os.stat(ROOT_DIRECTORY).st_dev:
            raise ValueError('unit-cross-device-archive')

    audit = Path(tempfile.mkdtemp(prefix='baci-interest-retry.', dir=ROOT_DIRECTORY))
    os.chmod(audit, 0o700)
    recovered_target = audit / 'recovered-target'
    archived = []
    manifest = dict(status='recovery-incomplete', createdAt=datetime.now(timezone.utc).isoformat(),
                    authority=authority, checkerId=checker['Id'], files=files, archived=archived,
                    checkerRemoved=False, daemonReloaded=False)
    try:
        os.rename(contract.TARGET, recovered_target)
        archived.append(dict(source=str(contract.TARGET), destination=str(recovered_target)))
        for name in units:
            source = SYSTEMD_DIR / name
            destination = audit / name
            os.rename(source, destination)
            archived.append(dict(source=str(source), destination=str(destination)))

        current = _container_state(CHECKER, run_docker)
        if current['Id'] != checker['Id']:
            raise ValueError('checker-id-changed')
        run_docker(['rm', checker['Id']])
        if run_docker(['inspect', checker['Id']], checked=False).returncode == 0:
            raise ValueError('checker-removal-unconfirmed')
        if run_docker(['ps', '-aq', '--filter', 'name=^/' + CHECKER + '$']).stdout.strip():
            raise ValueError('checker-name-reused')
        manifest['checkerRemoved'] = True

        run_command(['/usr/bin/systemctl', 'daemon-reload'])
        manifest['daemonReloaded'] = True
        manifest['status'] = 'failed-attempt-archived-ready-for-retry'
    except Exception as error:
        manifest['errorType'] = type(error).__name__
        _write_manifest(audit, manifest)
        raise
    manifest_path = _write_manifest(audit, manifest)
    return dict(status=manifest['status'], manifest=str(manifest_path),
                recoveredTarget=str(recovered_target), archivedFiles=len(archived),
                checkerRemoved=manifest['checkerRemoved'], daemonReloaded=manifest['daemonReloaded'])


if __name__ == '__main__':
    try:
        print(json.dumps(run()))
    except Exception as error:
        print(json.dumps(dict(status='refused', errorType=type(error).__name__, redacted=True)))
        raise SystemExit(1)
