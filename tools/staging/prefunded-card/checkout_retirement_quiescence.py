from contextlib import contextmanager
import fcntl
import json
import math
import os
from pathlib import Path
import signal
import stat
import time

from runtime_owner_support import DOCKER, command
from runtime_scheduler import IMAGE, PREFIX, STATE, units, validate_container
from treasury_owner_contract import CONTAINER, DEADLINE_EPOCH, PSQL, SYSTEM, Refused
from treasury_owner_io import read_file, root_ancestors


MANIFEST = '7e8b8f70975c53669a062a824099ec8d15267c69d1f03ac4af7f4e945ad571b5'
INTENT = 'd8bcf921-61b3-4647-90e2-5648e4d6967d'
SUFFIXES = ('background.service', 'background.timer', 'deadline.service', 'deadline.timer')
PROPERTIES = 'LoadState,FragmentPath,DropInPaths,NeedDaemonReload,UnitFileState,ActiveState'
SIGNALS = (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)


def _before_deadline():
    if time.time() >= DEADLINE_EPOCH:
        raise Refused('Background quiescence deadline reached')


def _show(suffix, timeout=10):
    output = command(['/usr/bin/systemctl', 'show', '--property=' + PROPERTIES, PREFIX + suffix], timeout=timeout)
    try:
        entries = [line.split('=', 1) for line in output.splitlines()]
        value = dict(entries)
    except (ValueError, TypeError):
        raise Refused('Background unit metadata unavailable') from None
    expected = dict(LoadState='loaded', FragmentPath='/etc/systemd/system/' + PREFIX + suffix,
                    DropInPaths='', NeedDaemonReload='no')
    if (len(entries) != len(value) or set(value) != set(PROPERTIES.split(','))
            or any(value.get(key) != item for key, item in expected.items())
            or value['UnitFileState'] not in ('static', 'disabled', 'enabled', 'enabled-runtime')):
        raise Refused('Background effective unit differs')
    return value


def _units():
    observed = {}
    for suffix in SUFFIXES:
        path = Path('/etc/systemd/system') / (PREFIX + suffix)
        root_ancestors(path)
        expected = units()[suffix]
        before = _show(suffix)
        if read_file(path, 0, 0o644, 16384) != expected.encode():
            raise Refused('Background unit bytes differ')
        effective = command(['/usr/bin/systemctl', 'cat', '--no-pager', PREFIX + suffix], timeout=10)
        if effective.rstrip('\n') != ('# ' + str(path) + '\n' + expected).rstrip('\n'):
            raise Refused('Background effective unit bytes differ')
        after = _show(suffix)
        if {**before, 'ActiveState': after['ActiveState']} != after:
            raise Refused('Background unit changed during validation')
        observed[suffix] = after
    if (observed['background.timer']['ActiveState'] not in ('active', 'inactive')
            or observed['deadline.timer']['ActiveState'] != 'active'
            or observed['deadline.service']['ActiveState'] != 'inactive'):
        raise Refused('Background schedule state differs')
    return observed


def _worker(timeout=10):
    limit = time.monotonic() + timeout
    values = json.loads(command([*DOCKER, 'inspect', PREFIX + 'background'], timeout=_remaining(limit)))
    if not isinstance(values, list) or len(values) != 1:
        raise Refused('Background worker unavailable')
    observed = values[0]
    validate_container(observed, 'background', MANIFEST)
    image = json.loads(command([*DOCKER, 'image', 'inspect', IMAGE], timeout=_remaining(limit)))
    if (not isinstance(image, list) or len(image) != 1
            or not isinstance(image[0].get('Config', {}).get('Env'), list)
            or observed['Config'].get('Env') != image[0]['Config']['Env']):
        raise Refused('Background image environment differs')
    state = observed.get('State', {})
    if (type(state.get('Running')) is not bool or any(state.get(key) is not False
            for key in ('Paused', 'Restarting', 'Dead')) or type(state.get('Pid')) is not int
            or (not state['Running'] and state['Pid'] != 0)):
        raise Refused('Background worker state differs')
    return state['Running']


def _remaining(limit):
    _before_deadline()
    remaining = min(limit - time.monotonic(), DEADLINE_EPOCH - time.time())
    if remaining <= 0:
        raise Refused('Background drain time limit reached')
    return remaining


def _drain():
    limit = time.monotonic() + 490
    while True:
        service = _show('background.service', min(10, _remaining(limit)))['ActiveState']
        running = _worker(min(10, _remaining(limit)))
        _remaining(limit)
        if service == 'inactive' and not running:
            return
        if service not in ('inactive', 'activating', 'active', 'deactivating'):
            raise Refused('Background job did not finish naturally')
        time.sleep(min(1, _remaining(limit)))


@contextmanager
def _runner_lock():
    root_ancestors(Path(STATE))
    directory = os.open(STATE, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    descriptor = None
    try:
        metadata = os.fstat(directory)
        if (not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 65532 or metadata.st_gid != 65532
                or stat.S_IMODE(metadata.st_mode) != 0o700):
            raise Refused('Background state directory differs')
        descriptor = os.open('runner.lock', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        for locked in (False, True):
            lock = os.fstat(descriptor)
            current = os.stat('runner.lock', dir_fd=directory, follow_symlinks=False)
            current_directory = os.stat(STATE, follow_symlinks=False)
            if (not stat.S_ISREG(lock.st_mode) or lock.st_uid != 65532 or lock.st_gid != 65532
                    or stat.S_IMODE(lock.st_mode) != 0o600 or lock.st_nlink != 1 or lock.st_size != 0
                    or (lock.st_dev, lock.st_ino) != (current.st_dev, current.st_ino)
                    or (metadata.st_dev, metadata.st_ino) != (current_directory.st_dev, current_directory.st_ino)):
                raise Refused('Background runner lock differs')
            if not locked:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(directory)


def _leases(timeout):
    sql = f"""BEGIN READ ONLY; SET LOCAL statement_timeout='5s';
SELECT jsonb_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
  'database',current_database(),'withinDeadline',clock_timestamp()<to_timestamp({DEADLINE_EPOCH}),
  'verification',greatest(0,extract(epoch FROM operation.verification_lease_expires_at-clock_timestamp())),
  'dispatch',greatest(0,extract(epoch FROM queue.lease_expires_at-clock_timestamp())))
FROM prefunded_card.operations operation
JOIN prefunded_card.checkout_intents intent ON intent.operation_id=operation.id AND intent.id='{INTENT}'
LEFT JOIN prefunded_card.dispatch_queue queue ON queue.operation_id=operation.id
WHERE operation.id='{INTENT}';
ROLLBACK;"""
    value = json.loads(command([*DOCKER, 'exec', '-i', CONTAINER, PSQL, '-XqAt', '-v', 'ON_ERROR_STOP=1',
                               '-v', 'VERBOSITY=sqlstate', '-U', 'postgres', '-d', 'postgres'], sql, timeout=timeout))
    expected = dict(systemIdentifier=SYSTEM, database='postgres', withinDeadline=True)
    if (not isinstance(value, dict) or set(value) != {*expected, 'verification', 'dispatch'}
            or any(type(value[key]) is not type(item) or value[key] != item for key, item in expected.items())
            or any(type(value[key]) not in (int, float) or not math.isfinite(value[key]) or not 0 <= value[key] <= 300
                   for key in ('verification', 'dispatch'))):
        raise Refused('Background lease scope or duration differs')
    return max(value['verification'], value['dispatch'])


def _drain_leases():
    limit = time.monotonic() + 310
    while True:
        remaining = _leases(min(10, _remaining(limit)))
        _remaining(limit)
        if remaining == 0:
            return
        time.sleep(min(1, remaining, _remaining(limit)))


def _interrupted(signum, frame):
    raise Refused('Background quiescence interrupted')


@contextmanager
def quiet_background(progress):
    if os.geteuid() != 0:
        raise Refused('Root background quiescence required')
    _before_deadline()
    progress('background-quiescence-validation')
    original = _units()
    _worker()
    handlers = {}
    restore = False
    try:
        for signum in SIGNALS:
            handlers[signum] = signal.signal(signum, _interrupted)
        _before_deadline()
        if original['background.timer']['ActiveState'] == 'active':
            restore = True
            command(['/usr/bin/systemctl', 'stop', PREFIX + 'background.timer'], timeout=30)
        if _show('background.timer')['ActiveState'] != 'inactive':
            raise Refused('Background timer is not quiet')
        progress('background-job-drain')
        _drain()
        with _runner_lock():
            progress('background-lease-drain')
            _drain_leases()
            if (_show('background.timer')['ActiveState'] != 'inactive'
                    or _show('background.service')['ActiveState'] != 'inactive' or _worker()):
                raise Refused('Background worker restarted during drain')
            _before_deadline()
            progress('background-quiescent')
            yield
    finally:
        try:
            for signum in handlers:
                signal.signal(signum, signal.SIG_IGN)
            if restore and time.time() < DEADLINE_EPOCH:
                current = _units()
                if any(current[suffix]['UnitFileState'] != original[suffix]['UnitFileState'] for suffix in SUFFIXES):
                    raise Refused('Background unit file state changed; timer not restored')
                _before_deadline()
                try:
                    command(['/usr/bin/systemctl', 'start', PREFIX + 'background.timer'], timeout=10)
                    if (_show('background.timer')['ActiveState'] != 'active'
                            or _show('background.timer')['UnitFileState'] != original['background.timer']['UnitFileState']):
                        raise Refused('Background timer restoration unconfirmed')
                finally:
                    if time.time() >= DEADLINE_EPOCH:
                        command(['/usr/bin/systemctl', 'stop', PREFIX + 'background.timer'], timeout=10)
                        if _show('background.timer')['ActiveState'] != 'inactive':
                            raise Refused('Expired background timer withdrawal unconfirmed')
                        progress('background-deadline-retained')
                        raise Refused('Background restoration crossed fixed deadline')
                progress('background-timer-restored')
            elif restore:
                progress('background-deadline-retained')
        finally:
            for signum, handler in handlers.items():
                signal.signal(signum, handler)
