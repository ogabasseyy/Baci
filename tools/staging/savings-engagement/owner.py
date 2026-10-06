import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import time


HERE = Path(__file__).resolve().parent
ENVIRONMENT = Path('/etc/baci/piggyvest-staging/funding-service.env')
NGINX_TARGET = Path('/etc/nginx/sites-available/staging-auth.ogabassey.com')
CAPABILITY = b'SAVINGS_NOTIFICATIONS_DELIVERY_ENABLED'
EXPIRY = 1790697550
WORKER = 'baci-savings-notifications.service'
WORKER_CHECK = 'baci-savings-notifications-check.service'
TIMERS = ('baci-savings-notifications.timer', 'baci-savings-notifications-deadline.timer')
COMMAND_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LANG': 'C', 'LC_ALL': 'C'}


def enable_capability(content):
    lines = content.splitlines(keepends=True)
    matches = [index for index, line in enumerate(lines) if line.strip().split(b'=', 1)[0] == CAPABILITY]
    if len(matches) > 1:
        raise RuntimeError('Duplicate delivery capability')
    if matches:
        index = matches[0]
        if lines[index].strip() not in (CAPABILITY + b'=true', CAPABILITY + b'=false'):
            raise RuntimeError('Unexpected delivery capability')
        lines[index] = CAPABILITY + b'=true\n'
        return b''.join(lines)
    separator = b'' if not content or content.endswith(b'\n') else b'\n'
    return content + separator + CAPABILITY + b'=true\n'


def read_root(path, limit=1048576):
    for parent in path.parents:
        metadata = parent.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            raise RuntimeError('Untrusted parent directory')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_nlink != 1 or before.st_mode & 0o022:
            raise RuntimeError('Unsafe owner input')
        content = handle.read(limit + 1)
        after = os.fstat(handle.fileno())
    if len(content) > limit or (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
        raise RuntimeError('Owner input changed during read')
    return content, before


def load_module(name):
    path = HERE / name
    content, _ = read_root(path)
    spec = importlib.util.spec_from_file_location('engagement_' + name.replace('.', '_'), path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    exec(compile(content, str(path), 'exec'), module.__dict__)
    return module


def command(*arguments, timeout=120):
    result = subprocess.run(list(arguments), env=COMMAND_ENV, stdin=subprocess.DEVNULL,
                            capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError('Reviewed activation command failed')
    return result.stdout.strip()


def ensure_unexpired():
    if time.time() >= EXPIRY:
        raise RuntimeError('Staging approval has expired')


def replace_environment(content, metadata):
    descriptor, name = tempfile.mkstemp(prefix='.engagement-env-', dir=ENVIRONMENT.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(content)
            os.fchown(handle.fileno(), metadata.st_uid, metadata.st_gid)
            os.fchmod(handle.fileno(), stat.S_IMODE(metadata.st_mode))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, ENVIRONMENT)
        directory = os.open(ENVIRONMENT.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if temporary.exists():
            temporary.unlink()


def activate_capability(artifact):
    ensure_unexpired()
    previous, metadata = read_root(ENVIRONMENT)
    if stat.S_IMODE(metadata.st_mode) not in (0o400, 0o440, 0o600, 0o640):
        raise RuntimeError('Unsafe environment mode')
    desired = enable_capability(previous)
    if previous == desired:
        artifact.probe_health()
        return None
    backup = HERE / 'funding-service.environment.backup'
    descriptor = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(previous)
        handle.flush()
        os.fsync(handle.fileno())
    if read_root(ENVIRONMENT)[0] != previous:
        raise RuntimeError('Environment changed before activation')
    try:
        ensure_unexpired()
        replace_environment(desired, metadata)
        artifact.run_service('restart')
        artifact.probe_health()
    except Exception:
        if read_root(ENVIRONMENT)[0] != desired:
            raise RuntimeError('Environment drift during rollback; backup retained') from None
        replace_environment(previous, metadata)
        artifact.run_service('restart')
        artifact.probe_health()
        raise RuntimeError('Delivery capability activation rolled back') from None
    return previous, metadata


def restore_capability(snapshot, artifact):
    previous, metadata = snapshot
    if read_root(ENVIRONMENT)[0] != enable_capability(previous):
        raise RuntimeError('Delivery capability drift; backup retained')
    replace_environment(previous, metadata)
    artifact.run_service('restart')
    artifact.probe_health()


def withdraw_delivery():
    succeeded = True
    for arguments in (('disable', '--now', *TIMERS), ('stop', WORKER, WORKER_CHECK)):
        try:
            command('/usr/bin/systemctl', *arguments)
        except Exception:
            succeeded = False
    return succeeded


def install(resume=False):
    stage = 'owner-preflight'
    if os.geteuid() != 0 or time.time() >= EXPIRY:
        raise RuntimeError('Owner authority unavailable or expired')
    if HERE.parent != Path('/root') or not HERE.name.startswith('baci-savings-engagement.'):
        raise RuntimeError('Root-private reviewed bundle required')
    if (HERE / 'activation-receipt.json').exists() or (HERE / 'activation-receipt.json').is_symlink():
        raise RuntimeError('Bundle activation already completed')
    artifact, nginx = load_module('artifact.py'), load_module('nginx.py')
    bundle = json.loads(read_root(HERE / 'bundle-pins.json')[0])
    capability_snapshot, scheduling_started = None, False
    try:
        stage = 'artifact-preflight'
        if resume:
            artifact.verify_installed()
        else:
            staged = artifact.prepare()
        stage = 'gateway-preflight'
        gateway = json.loads(command('/usr/bin/python3', str(HERE / 'gateway.py'), '--check'))
        if resume and gateway.get('status') != 'already_applied':
            raise RuntimeError('Resume requires the verified gateway already applied')
        stage = 'nginx-preflight'
        nginx_hash = hashlib.sha256(read_root(NGINX_TARGET)[0]).hexdigest()
        nginx.install(nginx_hash, check=True)
        stage = 'worker-install-inactive'
        ensure_unexpired()
        command('/usr/bin/python3', str(HERE / 'worker-install.py'), '--install',
                '--worker-sha256', bundle['workerSha256'])
        backup = None
        if not resume:
            stage = 'gateway-activation'
            ensure_unexpired()
            command('/usr/bin/python3', str(HERE / 'gateway.py'), '--apply')
            stage = 'funding-activation'
            ensure_unexpired()
            backup = artifact.activate(staged)
        stage = 'nginx-activation'
        ensure_unexpired()
        nginx_result = nginx.install(nginx_hash)
        stage = 'worker-read-only-health'
        ensure_unexpired()
        command('/usr/bin/systemctl', 'start', WORKER_CHECK)
        if command('/usr/bin/systemctl', 'show', WORKER_CHECK, '--property=Result', '--value') != 'success':
            raise RuntimeError('Worker read-only check failed')
        stage = 'delivery-capability'
        capability_snapshot = activate_capability(artifact)
        stage = 'worker-schedule'
        ensure_unexpired()
        scheduling_started = True
        command('/usr/bin/systemctl', 'enable', '--now', TIMERS[1], TIMERS[0])
        for timer in TIMERS:
            if command('/usr/bin/systemctl', 'is-active', timer) != 'active':
                raise RuntimeError('Notification timer is not active')
        stage = 'worker-first-run'
        ensure_unexpired()
        command('/usr/bin/systemctl', 'start', WORKER)
        if command('/usr/bin/systemctl', 'show', WORKER, '--property=Result', '--value') != 'success':
            raise RuntimeError('Worker dispatch failed')
        receipt = {
            'status': 'active', 'expiresAt': '2026-09-29T15:59:10Z',
            'artifactBackup': str(backup) if backup is not None else None,
            'resumedInstalledArtifact': resume, 'nginx': nginx_result,
            'workerSha256': bundle['workerSha256'],
            'phoneDelivery': 'not-yet-verified',
        }
        descriptor = os.open(HERE / 'activation-receipt.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as handle:
            json.dump(receipt, handle)
            handle.flush()
            os.fsync(handle.fileno())
        print(json.dumps({'stage': 'savings-engagement', **receipt}), flush=True)
        print('SAVINGS_ENGAGEMENT_STAGING_ACTIVE', flush=True)
    except Exception as error:
        cleanup_succeeded = True
        if scheduling_started:
            cleanup_succeeded = withdraw_delivery()
        if capability_snapshot is not None:
            try:
                restore_capability(capability_snapshot, artifact)
            except Exception:
                cleanup_succeeded = False
        report = {'stage': stage, 'status': 'failed', 'errorType': type(error).__name__, 'cleanupSucceeded': cleanup_succeeded, 'redacted': True}
        if isinstance(error, nginx.ActivationFailure):
            report['nginx'] = error.report
        print(json.dumps(report), flush=True)
        raise


def interrupted(signum, frame):
    raise RuntimeError('Activation interrupted')


if __name__ == '__main__':
    os.umask(0o077)
    try:
        parser = argparse.ArgumentParser()
        parser.add_argument('--resume', action='store_true')
        arguments = parser.parse_args()
        descriptor = os.open('/run/baci-savings-engagement.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'r+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            for event in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT):
                signal.signal(event, interrupted)
            install(resume=arguments.resume)
    except Exception:
        print('Savings engagement activation refused; review its safe stage report.', flush=True)
        raise SystemExit(1) from None
