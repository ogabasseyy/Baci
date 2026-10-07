"""Fixed notification-only systemd job transport using authenticated public I/O."""

import json
import re
import time

import notification_resume as BASE
import notification_scope as SCOPE
from public_resume_runtime import PublicRuntime, BUS, MANAGER
import public_resume


def require(value):
    BASE.require(value)


class NotificationSystemd(PublicRuntime):
    def read(self, path, mode):
        return super().read(path, mode=mode)

    def exec_commands(self, path, field):
        paths = {'/org/freedesktop/systemd1/unit/baci_2dprefunded_2dpublic_2eservice',
            '/org/freedesktop/systemd1/unit/baci_2dprefunded_2dpublic_2ddeadline_2eservice'}
        require(path in paths and field in ('ExecCondition', 'ExecStart', 'ExecStopPost')
            and (not path.endswith('_2ddeadline_2eservice') or field == 'ExecStart'))
        value = json.loads(self.command([*BUS, 'get-property', MANAGER[0], path,
            'org.freedesktop.systemd1.Service', field]))
        require(value['type'] == 'a(sasbttttuii)' and type(value['data']) is list and len(value['data']) <= 8)
        result = []
        for row in value['data']:
            require(type(row) is list and len(row) == 10 and type(row[0]) is str
                and row[0].startswith('/') and type(row[1]) is list and 0 < len(row[1]) <= 32
                and all(type(argument) is str for argument in row[1]) and row[1][0] == row[0]
                and row[2] is False and all(type(number) is int for number in row[3:]))
            result.append(row[1])
        return result

    def public_object(self, unit):
        require(unit in (public_resume.SERVICE, public_resume.NAME+'-deadline.service'))
        expected = self.encoded_path(unit)
        value = json.loads(self.command([*BUS, 'call', *MANAGER, 'LoadUnit', 's', unit]))
        require(type(value) is dict and set(value) == {'type', 'data'}
            and value['type'] == 'o' and value['data'] == [expected])
        return value['data'][0]

    def unit_state(self):
        return super().unit_state()

    def deadline(self):
        return super().deadline()

    def encoded_path(self, unit):
        require(unit in BASE.UNITS or unit in (public_resume.SERVICE, public_resume.NAME+'-deadline.service'))
        return '/org/freedesktop/systemd1/unit/' + ''.join(
            character if character.isascii() and character.isalnum() else '_'+format(ord(character), '02x')
            for character in unit)

    def jobs(self, unit=None, timeout=5):
        require(unit is None or unit in BASE.UNITS)
        value = json.loads(self.command([*BUS, 'call', *MANAGER, 'ListJobs'], timeout))
        require(value['type'] == 'a(usssoo)' and type(value['data']) is list and len(value['data']) == 1)
        rows = value['data'][0]
        require(type(rows) is list and len(rows) <= 4096)
        seen, result = set(), []
        for row in rows:
            require(type(row) is list and len(row) == 6 and type(row[0]) is int and row[0] > 0
                and row[0] not in seen and all(type(field) is str for field in row[1:])
                and row[4] == '/org/freedesktop/systemd1/job/'+str(row[0]))
            seen.add(row[0])
            if row[1] == unit or unit is None and row[1] in BASE.UNITS:
                result.append(row[0])
        return result

    def object_path(self, unit, timeout=5):
        require(unit in BASE.UNITS)
        value = json.loads(self.command([*BUS, 'call', *MANAGER, 'LoadUnit', 's', unit], timeout))
        require(type(value) is dict and set(value) == {'type', 'data'}
            and value['type'] == 'o' and value['data'] == [self.encoded_path(unit)])
        return value['data'][0]

    def timer_epoch(self, unit):
        path, observed = self.object_path(unit), []
        for field in ('NextElapseUSecRealtime', 'NextElapseUSecMonotonic'):
            value = json.loads(self.command([*BUS, 'get-property', MANAGER[0], path,
                'org.freedesktop.systemd1.Timer', field]))
            require(value['type'] == 't' and type(value['data']) is int and value['data'] >= 0)
            microseconds = value['data']
            if 0 < microseconds < 2**64-1:
                observed.append(microseconds/1000000 if field.endswith('Realtime') else
                    self.clock().timestamp()+microseconds/1000000-time.monotonic())
        require(observed)
        return int(min(observed))

    def state(self, unit, timeout=5):
        require(unit in BASE.UNITS)
        fields = ['Id', 'FragmentPath', 'LoadState', 'DropInPaths', 'NeedDaemonReload', 'Transient',
            'ActiveState', 'SubState']
        if unit.endswith('.service'):
            fields += ['MainPID', 'Result', 'ExecMainStatus', 'ExecMainCode', 'ExecMainStartTimestampMonotonic', 'ExecStart']
        else:
            fields += ['Triggers']
        end = time.monotonic()+timeout
        value = self.properties(unit, fields, timeout)
        require(value.pop('Id') == unit)
        require(time.monotonic() < end)
        value['pendingJobs'] = self.jobs(unit, timeout=end-time.monotonic())
        if unit.endswith('.timer'):
            value['MainPID'] = '0'
            if value['ActiveState'] == 'active':
                value['nextEpoch'] = self.timer_epoch(unit)
        return value

    def job_call(self, verb, unit, timeout):
        require((verb == 'StartUnit' and unit == BASE.TIMER)
            or (verb == 'StopUnit' and unit in (BASE.TIMER, BASE.SERVICE)))
        value = json.loads(self.command([*BUS, 'call', *MANAGER, verb, 'ss', unit,
            'replace' if verb == 'StopUnit' else 'fail'], timeout))
        require(type(value) is dict and value['type'] == 'o' and type(value['data']) is list
            and len(value['data']) == 1 and type(value['data'][0]) is str)
        match = re.fullmatch('/org/freedesktop/systemd1/job/([1-9][0-9]*)', value['data'][0])
        require(match is not None)
        return int(match[1])

    def run(self, arguments, *, timeout):
        start = arguments == [BASE.SYSTEMCTL, 'start', BASE.TIMER]
        stop = arguments == [BASE.SYSTEMCTL, 'stop', BASE.TIMER, BASE.SERVICE]
        require((start or stop) and timeout == 30)
        if stop:
            return self.stop_owned(timeout)
        require(self.exclusive() is True)
        end = time.monotonic()+timeout
        if start:
            require(not self.attempted and self.job is None and self.jobs() == [])
            self.attempted, self.submitted = True, self.clock()
            self.job = self.job_call('StartUnit', BASE.TIMER, 5)
        while time.monotonic() < end:
            if self.jobs(timeout=min(5, end-time.monotonic())) == []:
                require(time.monotonic() <= end)
                return
            time.sleep(min(0.1, max(0, end-time.monotonic())))
        raise ValueError('notification_job_unconfirmed')

    def owned_lock(self):
        raise ValueError('notification_owned_lock_required')

    def stop_authority(self, unit, budget):
        require(unit in (BASE.TIMER, BASE.SERVICE))
        BASE.read_pin(self.read, BASE.UNIT_ROOT+unit, BASE.UNIT_PINS[unit], 0o444)
        fields = ('FragmentPath', 'LoadState', 'DropInPaths', 'NeedDaemonReload', 'Transient')
        BASE.notification_contract.validate_effective(unit, self.properties(unit, fields, budget(2)))
        self.object_path(unit, timeout=budget(1))
        return True

    def cleanup_state(self, unit, budget):
        require(unit in (BASE.TIMER, BASE.SERVICE))
        fields = ['Id', 'ActiveState'] + (['MainPID'] if unit == BASE.SERVICE else [])
        value = self.properties(unit, fields, budget(2))
        require(value.pop('Id') == unit)
        if unit == BASE.TIMER:
            value['MainPID'] = '0'
        value['pendingJobs'] = self.jobs(unit, timeout=budget(1))
        return value

    def stop_owned(self, timeout):
        self.cleanup_requested, self.cleanup_confirmed = True, False
        require(self.attempted and timeout == 30 and self.owned_lock() is True)
        end, acknowledged, authorized = time.monotonic()+timeout, True, set()

        def budget(limit):
            remaining = end-time.monotonic()
            require(remaining > 0)
            return min(limit, remaining)

        for unit in (BASE.TIMER, BASE.SERVICE):
            try:
                require(self.owned_lock() is True and self.stop_authority(unit, budget) is True)
                authorized.add(unit)
                self.job_call('StopUnit', unit, budget(5))
            except Exception:
                acknowledged = False
        while time.monotonic() < end:
            try:
                require(self.owned_lock() is True)
                values = [self.cleanup_state(unit, budget) for unit in (BASE.TIMER, BASE.SERVICE)]
                terminal = all(value['ActiveState'] in ('inactive', 'failed') and value['MainPID'] == '0'
                    and value['pendingJobs'] == [] for value in values)
                if terminal and authorized == {BASE.TIMER, BASE.SERVICE} \
                        and not self.jobs(BASE.TIMER, timeout=budget(1)) \
                        and not self.jobs(BASE.SERVICE, timeout=budget(1)):
                    require(time.monotonic() <= end)
                    self.cleanup_confirmed = True
                    return
            except Exception:
                break
            if not acknowledged:
                break
            time.sleep(min(0.1, max(0, end-time.monotonic())))
        raise ValueError('notification_cleanup_unconfirmed')

    def job_state(self, unit, started):
        require(unit == BASE.TIMER and self.job is not None and self.submitted is not None
            and 0 <= (self.submitted-SCOPE.stamp(started)).total_seconds() <= 5)
        jobs = self.jobs()
        activating = self.state(BASE.TIMER)['ActiveState'] == 'activating'
        return dict(unit=unit, submittedAt=started, observedAt=self.clock().isoformat(), jobId=self.job,
            terminal=not jobs and not activating, pendingJobs=jobs, activating=activating)

    def settle(self, unit, *, timeout):
        require(unit == BASE.SERVICE and timeout == 80)
        end = time.monotonic()+timeout
        while time.monotonic() < end:
            value = self.state(unit)
            if value['ActiveState'] == 'inactive' and value['SubState'] == 'dead' \
                    and value['MainPID'] == '0' and not value['pendingJobs']:
                require(value['Result'] == 'success' and value['ExecMainStatus'] == '0')
                return
            time.sleep(min(0.1, max(0, end-time.monotonic())))
        raise ValueError('notification_worker_unsettled')
