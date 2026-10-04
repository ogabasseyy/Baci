"""Fixed public-container read/start callbacks; no CLI, installation or retry."""

from datetime import datetime, timezone
import json
import hashlib
import os
from pathlib import Path
import re
import stat
import subprocess
import time

import public_resume as resume
from owned_public_stop import owned_public_stop


BUS = ['/usr/bin/busctl', '--system', '--json=short']
MANAGER = ['org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager']
FIELDS = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
TIMER_PIN = '52eb452b3b300f864de0930d52210318eba1ab3b72404049a738e0735943e782'
STOPPER_PIN = 'f32ef5130e4ed07356922abeb20841b74a271d9aaeac6c1a7245af4f82b3176c'


def require(value):
    if not value:
        raise ValueError('public_callback_refused')


def fingerprint(info):
    return tuple(getattr(info, field) for field in FIELDS)


class PublicRuntime:
    def __init__(self):
        self.job = None
        self.submitted = None
        self.attempted = False
        self.stop_job = None
        self.cleanup_requested = self.cleanup_confirmed = False

    def clock(self):
        return datetime.now(timezone.utc)

    def command(self, arguments, timeout=10):
        try:
            result = subprocess.run(arguments, capture_output=True, timeout=timeout,
                env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'TZ': 'UTC'})
            require(result.returncode == 0 and len(result.stdout) <= 16000000)
            return result.stdout.decode()
        except Exception:
            raise ValueError('public_command_refused') from None

    def read(self, path, *, mode):
        require(isinstance(path, Path) and path.is_absolute() and '..' not in path.parts)
        root = Path(resume.ROOT)
        configs = {root / 'config' / (name + '.json') for name in ('checkout', 'anon')}
        require(path not in configs or mode == 0o440)
        installed = path in configs or root / 'app' in path.parents or path == root / 'receipt.json'
        profiles = {root: (65530, 0o750)} if installed else {}
        if path in configs:
            profiles[root / 'config'] = (65530, 0o710)
        parents = {parent: parent.lstat() for parent in path.parents}
        for parent, info in parents.items():
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022)
            if parent in profiles:
                group, permissions = profiles[parent]
                require(info.st_gid == group and stat.S_IMODE(info.st_mode) == permissions)
            else:
                require(info.st_gid == 0)
        before = path.lstat()
        group = 65530 if path in configs else 0
        require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_gid == group
            and stat.S_IMODE(before.st_mode) == mode and before.st_nlink == 1
            and 0 <= before.st_size <= 64000000)
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as handle:
            opened = os.fstat(handle.fileno())
            raw = handle.read(64000001)
            after = os.fstat(handle.fileno())
        require(all(fingerprint(before) == fingerprint(info) for info in (opened, after, path.lstat()))
            and len(raw) == before.st_size and all(fingerprint(parent.lstat()) == fingerprint(info)
                for parent, info in parents.items()))
        return raw, dict(uid=before.st_uid, gid=before.st_gid, mode=stat.S_IMODE(before.st_mode),
            nlink=before.st_nlink, regularFile=stat.S_ISREG(before.st_mode))

    def inventory(self, root):
        require(root == Path(resume.ROOT + '/app'))
        pending, files = [root], []
        while pending:
            directory = pending.pop()
            info = directory.lstat()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0 and not info.st_mode & 0o022)
            for path in directory.iterdir():
                info = path.lstat()
                require(info.st_uid == info.st_gid == 0)
                if stat.S_ISDIR(info.st_mode):
                    pending.append(path)
                else:
                    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o444)
                    files.append(str(path))
                require(len(files) + len(pending) <= 40000)
        return sorted(files)

    def inspect(self, identifier):
        require(identifier == resume.CID)
        values = json.loads(self.command([*resume.DOCKER, 'inspect', identifier]))
        require(type(values) is list and len(values) == 1)
        value = values[0]
        value['networks'] = sorted(value['NetworkSettings']['Networks'])
        return value

    def properties(self, unit, keys, timeout=10):
        raw = self.command(['/usr/bin/systemctl', 'show', unit, '--all', '--no-pager', '--full',
            '--property=' + ','.join(keys)], timeout)
        result = {}
        for line in raw.splitlines():
            key, separator, value = line.partition('=')
            require(separator and key in keys and (key not in result or key == 'ExecStart'))
            result[key] = result[key] + '\n' + value if key in result else value
        require(set(result) == set(keys))
        return result

    def commands(self, value, count):
        require(type(value) is dict and set(value) == {'type', 'data'}
            and value['type'] == 'a(sasbttttuii)' and type(value['data']) is list and len(value['data']) == count)
        result = []
        for row in value['data']:
            require(type(row) is list and len(row) == 10 and type(row[0]) is str
                and row[0] in ('/bin/sh', '/usr/bin/systemctl', '/usr/bin/docker')
                and type(row[1]) is list and 1 <= len(row[1]) <= 64
                and all(type(arg) is str and 0 < len(arg) <= 4096 and '\x00' not in arg for arg in row[1])
                and row[1][0] == row[0] and row[2] is False)
            require(all(type(row[index]) is int and 0 <= row[index] < 2**64 for index in range(3, 7))
                and type(row[7]) is int and 0 <= row[7] < 2**32
                and all(type(row[index]) is int and -2**31 <= row[index] < 2**31 for index in (8, 9)))
            result.append(row[1])
        return result

    def unit_commands(self, unit, fields, timeout=10):
        stopper = resume.NAME + '-deadline.service'
        require(unit in (resume.SERVICE, stopper) and fields
            and set(fields) <= ({'ExecStart'} if unit == stopper else {'ExecCondition', 'ExecStart', 'ExecStopPost'}))
        expected = '/org/freedesktop/systemd1/unit/baci_2dprefunded_2dpublic' + (
            '_2ddeadline' if unit == stopper else '') + '_2eservice'
        identity = json.loads(self.command([*BUS, 'call', *MANAGER, 'LoadUnit', 's', unit],
            timeout() if callable(timeout) else timeout))
        require(type(identity) is dict and set(identity) == {'type', 'data'}
            and identity['type'] == 'o' and identity['data'] == [expected])
        return {field: self.commands(json.loads(self.command([*BUS, 'get-property', MANAGER[0], expected,
            'org.freedesktop.systemd1.Service', field], timeout() if callable(timeout) else timeout)),
            2 if unit == stopper else 1) for field in fields}

    def unit_state(self):
        unit_bytes = resume._read(self.read, resume.UNIT, resume.UNIT_PIN, 0o644)
        require(re.search(r'^\s*(?:Environment|EnvironmentFile|PassEnvironment|UnsetEnvironment)\s*=',
            unit_bytes.decode(), re.MULTILINE) is None)
        keys = ('FragmentPath', 'DropInPaths', 'NeedDaemonReload', 'LoadState', 'Transient', 'Restart',
            'ActiveState', 'SubState', 'Result', 'ExecMainStatus', 'MainPID', 'InvocationID',
            'Environment', 'PassEnvironment', 'UnsetEnvironment')
        raw = dict(self.properties(resume.SERVICE, keys))
        require(all(raw.pop(field) == '' for field in ('Environment', 'PassEnvironment', 'UnsetEnvironment'))
            and raw['DropInPaths'] == '' and raw['NeedDaemonReload'] == 'no')
        result = dict(raw, DropInPaths=raw['DropInPaths'].split())
        for field in ('NeedDaemonReload', 'Transient'):
            require(raw[field] in ('yes', 'no'))
            result[field] = raw[field] == 'yes'
        for field in ('MainPID', 'ExecMainStatus'):
            require(re.fullmatch('[0-9]+', raw[field]))
            result[field] = int(raw[field])
        result['commands'] = {field: values[0] for field, values in self.unit_commands(
            resume.SERVICE, ('ExecCondition', 'ExecStart', 'ExecStopPost')).items()}
        if result['ActiveState'] == 'active':
            object_path = '/org/freedesktop/systemd1/unit/baci_2dprefunded_2dpublic_2eservice'
            timestamp = json.loads(self.command([*BUS, 'get-property', MANAGER[0], object_path,
                'org.freedesktop.systemd1.Service', 'ExecMainStartTimestamp']))
            require(timestamp['type'] == 't' and type(timestamp['data']) is int and timestamp['data'] > 0)
            seconds, microseconds = divmod(timestamp['data'], 1000000)
            result['startedAt'] = datetime.fromtimestamp(seconds, timezone.utc).replace(
                microsecond=microseconds).isoformat().replace('+00:00', 'Z')
        return result

    def deadline(self):
        for suffix, pin in (('timer', TIMER_PIN), ('service', STOPPER_PIN)):
            raw, _ = self.read(Path('/etc/systemd/system/' + resume.NAME + '-deadline.' + suffix), mode=0o644)
            require(hashlib.sha256(raw).hexdigest() == pin)
        timer = self.properties(resume.NAME + '-deadline.timer', ('ActiveState', 'SubState', 'Unit',
            'NextElapseUSecRealtime', 'AccuracyUSec', 'RandomizedDelayUSec', 'DropInPaths', 'NeedDaemonReload'))
        require(timer == dict(ActiveState='active', SubState='waiting', Unit=resume.NAME + '-deadline.service',
            NextElapseUSecRealtime='Tue 2026-10-06 15:59:10 UTC', AccuracyUSec='1s', RandomizedDelayUSec='0',
            DropInPaths='', NeedDaemonReload='no'))
        stopper = self.properties(resume.NAME + '-deadline.service', ('DropInPaths', 'NeedDaemonReload'))
        require(not stopper['DropInPaths'] and stopper['NeedDaemonReload'] == 'no')
        require(self.unit_commands(resume.NAME + '-deadline.service', ('ExecStart',))['ExecStart'] == [['/usr/bin/systemctl', 'stop', resume.SERVICE],
            [*resume.DOCKER, 'stop', '--time', '5', resume.NAME]])
        return dict(epoch=1791302350, active=True, stopTarget=resume.NAME)

    def jobs(self, timeout=10):
        value = json.loads(self.command([*BUS, 'call', *MANAGER, 'ListJobs'], timeout))
        require(type(value) is dict and value['type'] == 'a(usssoo)' and type(value['data']) is list
            and len(value['data']) == 1 and type(value['data'][0]) is list)
        jobs = value['data'][0]
        require(len(jobs) <= 4096)
        identifiers = set()
        for row in jobs:
            require(type(row) is list and len(row) == 6 and type(row[0]) is int and row[0] > 0
                and row[0] not in identifiers and all(type(field) is str for field in row[1:])
                and row[4] == '/org/freedesktop/systemd1/job/' + str(row[0]))
            identifiers.add(row[0])
            if row[0] == self.job:
                require(row[1] == resume.SERVICE and row[2] == 'start')
            if row[0] == self.stop_job:
                require(row[1] == resume.SERVICE and row[2] == 'stop')
        return [row[0] for row in jobs if row[1] == resume.SERVICE]

    def before_start(self):
        raise ValueError('sealed_start_guard_required')

    def stop_authority(self, budget):
        resume._read(self.read, resume.UNIT, resume.UNIT_PIN, 0o644)
        state = self.properties(resume.SERVICE,
            ('FragmentPath', 'DropInPaths', 'NeedDaemonReload', 'LoadState', 'Transient'), budget(1))
        require(state == dict(FragmentPath=resume.UNIT, DropInPaths='', NeedDaemonReload='no',
            LoadState='loaded', Transient='no'))
        require(self.unit_commands(resume.SERVICE, ('ExecStopPost',), lambda: budget(1)) == {
            'ExecStopPost': [[*resume.DOCKER, 'stop', '--time', '5', resume.NAME]]})
        return True

    def run(self, arguments, *, timeout):
        if arguments == [*resume.DOCKER, 'stop', '--time', '5', resume.CID]:
            require(timeout == 15)
            return owned_public_stop(self, arguments, timeout, BUS, MANAGER) if self.attempted else self.command(arguments, timeout)
        require(arguments == ['/usr/bin/systemctl', 'start', resume.SERVICE] and timeout == 30
            and self.job is None and not self.attempted)
        end = time.monotonic() + timeout

        def remaining(limit):
            available = end - time.monotonic()
            require(available > 0)
            return min(limit, available)

        require(self.clock() < resume.DEADLINE and self.jobs(remaining(10)) == [])
        self.attempted = True
        self.submitted = self.clock()
        self.before_start()
        value = json.loads(self.command([*BUS, 'call', *MANAGER, 'StartUnit', 'ss', resume.SERVICE, 'fail'], remaining(5)))
        require(type(value) is dict and set(value) == {'type', 'data'} and value['type'] == 'o'
            and type(value['data']) is list and len(value['data']) == 1 and type(value['data'][0]) is str)
        match = re.fullmatch('/org/freedesktop/systemd1/job/([1-9][0-9]*)', value['data'][0])
        require(match is not None)
        self.job = int(match[1])
        while time.monotonic() < end:
            if self.jobs(remaining(10)) == []:
                require(time.monotonic() <= end)
                return
            time.sleep(remaining(0.1))
        raise ValueError('public_start_job_unconfirmed')

    def start_job_state(self, service, submitted_at):
        require(service == resume.SERVICE and self.job is not None and self.submitted is not None
            and submitted_at <= self.submitted <= self.clock()
            and (self.submitted - submitted_at).total_seconds() <= 5)
        jobs = self.jobs()
        state = self.properties(service, ('ActiveState', 'MainPID') if self.cleanup_requested else ('ActiveState',))
        active = state['ActiveState']
        cleaned = self.cleanup_confirmed and active in ('inactive', 'failed') and state.get('MainPID') == '0'
        return dict(unit=service, submittedAt=submitted_at.isoformat().replace('+00:00', 'Z'),
            observedAt=self.clock().isoformat().replace('+00:00', 'Z'), jobId=self.job,
            terminal=not jobs and active != 'activating' and (not self.cleanup_requested or cleaned),
            pendingJobs=jobs, activating=active == 'activating')
