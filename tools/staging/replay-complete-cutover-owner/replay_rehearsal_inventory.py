"""Read-only host observations under the authenticated parent's existing flock.

run(argv, input=None, timeout=...) returns complete stdout as bytes, raising
on failure, timeout or truncation. The parent authenticates run/clock/lock_held
and enforces transport bounds (one megabyte per command). No subprocess, SQL
or flock is performed here. sample() brackets separate receipt/app collectors.
exclusive_inventory() returns the replay_fence_rehearsal inventory contract.
driver_ancestry is an optional parent-authenticated tuple of PIDs, starting with
this driver PID and following actual PPIDs. Only that chain is excluded from
process discovery. Raw command arguments never enter output.
"""

from datetime import datetime, timezone
import json
import os
import re
import shlex
import time

import replay_quiescence as quiescence
from cutover_runtime import DOCKER


NETWORK = 'pvb-staging-receipts'
INFRASTRUCTURE = {
    '9b8b56ee647ea8313f62495ce743990b40b91abe0f8a4d2f591d209ff5323518': '/pvb-staging-intake',
    '68113c10e7239a138e859d64e38fb542d397809e75dc0e9a550465b4c7908f63': '/pvb-staging-receipts-rest',
    'beb3dda62db59f84436f2621b8ef4110c09d877e6c72dfc70e4fc72b8088b5f8': '/pvb-staging-receipts-db',
}
LAUNCHER = 'baci-interest-replay.service'
PROPERTIES = ('Id', 'LoadState', 'ActiveState', 'SubState', 'FragmentPath',
    'DropInPaths', 'NeedDaemonReload', 'Transient', 'Restart', 'MainPID',
    'Result', 'ExecMainStatus', 'ExecStart', 'Triggers', 'TriggeredBy')
MARKER = re.compile(r'replay|prefunded[-_]background|baci[-_]background|prefunded-snapshot|staging-test-payments|receipt[-_ ]claim', re.I)
LIMIT = 1_000_000
MAX_ITEMS = 512
PATTERNS = ('*replay*', '*prefunded*', '*baci-background*', '*baci_background*', '*staging-test-payments*', '*receipt*claim*')
FORMAT = ('{"Id":{{json .Id}},"Name":{{json .Name}},"State":{{json .State}},'
    '"HostConfig":{"RestartPolicy":{{json .HostConfig.RestartPolicy}}},'
    '"NetworkSettings":{"Networks":{{json .NetworkSettings.Networks}}},'
    '"Image":{{json .Config.Image}},"Entrypoint":{{json .Config.Entrypoint}},'
    '"Cmd":{{json .Config.Cmd}}}')


def _require(condition):
    if not condition:
        raise ValueError('replay_rehearsal_inventory_refused')


def _unique(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result)
        result[key] = value
    return result


def _stop_only(value):
    commands = re.findall(r'argv\[\]=(.*?)\s*;', value.get('ExecStart', ''))
    if not commands or any('argv[]=' not in line for line in value.get('ExecStart', '').splitlines()):
        return False
    targets = set(quiescence.UNITS) | {LAUNCHER, 'baci-prefunded-snapshot.timer',
        'baci-prefunded-snapshot.service'}
    for command in commands:
        args = shlex.split(command)
        if args[:2] == ['/usr/bin/systemctl', 'stop']:
            if len(args) < 3 or not set(args[2:]).issubset(targets):
                return False
        else:
            if args[:2] == ['/usr/bin/docker', '--host=unix:///var/run/docker.sock']:
                args = [args[0], *args[2:]]
            if args[:2] != ['/usr/bin/docker', 'stop']:
                return False
            rest = args[2:]
            timeout = None
            if rest[:1] == ['--time'] and len(rest) >= 3:
                timeout = rest[1]
                rest = rest[2:]
            if len(rest) != 1 or rest[0] not in quiescence.CLAIMANTS:
                return False
            expected = '15' if rest[0] == 'pvb-staging-replay-prefunded' else '10'
            if timeout is not None and timeout != expected:
                return False
    return True


class ReplayRehearsalInventory:
    def __init__(self, run, clock, locks_held=None, *, lock_held=None, driver_ancestry=()):
        _require((locks_held is None) != (lock_held is None))
        locks_held = locks_held if lock_held is None else lock_held
        _require(all(callable(callback) for callback in (run, clock, locks_held)))
        _require(type(driver_ancestry) is tuple and len(driver_ancestry) <= 16
            and all(type(pid) is int and pid > 1 for pid in driver_ancestry)
            and len(set(driver_ancestry)) == len(driver_ancestry)
            and (not driver_ancestry or driver_ancestry[0] == os.getpid()))
        self.run, self.clock, self.locks_held = run, clock, locks_held
        self.driver_ancestry = driver_ancestry or (os.getpid(),)

    def _now(self):
        now = self.clock()
        _require(type(now) is datetime and now.tzinfo is not None
            and now.utcoffset().total_seconds() == 0
            and now < quiescence._time(quiescence.DEADLINE))
        return now

    def _command(self, argv, started):
        remaining = 25 - (time.monotonic() - started)
        _require(remaining > 0 and self.locks_held() is True)
        raw = self.run(list(argv), input=None, timeout=min(5, remaining))
        _require(type(raw) is bytes and len(raw) <= LIMIT
            and time.monotonic() - started <= 25 and self.locks_held() is True)
        self._now()
        return raw.decode('utf-8', errors='strict')

    def _ids(self, started):
        ids = self._command([*DOCKER, 'container', 'ls', '--all', '--no-trunc',
            '--format={{.ID}}'], started).splitlines()
        _require(0 < len(ids) <= MAX_ITEMS and len(set(ids)) == len(ids)
            and all(re.fullmatch('[a-f0-9]{64}', identifier) for identifier in ids))
        return ids

    def _containers(self, started):
        ids = self._ids(started)
        raw = self._command([*DOCKER, 'container', 'inspect', '--format=' + FORMAT, *ids], started)
        values = [json.loads(line, object_pairs_hook=_unique) for line in raw.splitlines()]
        _require(len(values) == len(ids) and {value['Id'] for value in values} == set(ids))
        _require(set(self._ids(started)) == set(ids))
        containers, unknown, witnessed = {}, set(), set()
        for value in values:
            identifier, name, state = value['Id'], value['Name'], value['State']
            _require(type(name) is str and re.fullmatch(r'/[a-zA-Z0-9][a-zA-Z0-9_.-]*', name)
                and type(state['Running']) is bool and type(state['Restarting']) is bool
                and type(state['Paused']) is bool and type(value['NetworkSettings']['Networks']) is dict)
            networks = value['NetworkSettings']['Networks']
            if identifier in INFRASTRUCTURE:
                _require(name == INFRASTRUCTURE[identifier] and NETWORK in networks
                    and state['Running'] is True and not state['Paused'] and not state['Restarting'])
                witnessed.add(identifier)
            elif identifier in quiescence.CLAIMANTS.values():
                claimant = next(key for key, pin in quiescence.CLAIMANTS.items() if pin == identifier)
                projected = {key: value[key] for key in ('Id', 'Name', 'State', 'HostConfig')}
                quiescence._container(projected, claimant, identifier)
                containers[claimant] = projected
            elif ((state['Running'] or state['Restarting'] or state['Paused'])
                    and (NETWORK in networks
                        or MARKER.search(json.dumps([name, value['Image'], value['Entrypoint'], value['Cmd']])))):
                unknown.add('container:' + identifier)
            elif MARKER.search(json.dumps([name, value['Image'], value['Entrypoint'], value['Cmd']])):
                quiescence._exact(value['HostConfig']['RestartPolicy'], dict(Name='no', MaximumRetryCount=0))
        _require(witnessed == set(INFRASTRUCTURE) and set(containers) == set(quiescence.CLAIMANTS))
        return containers, unknown

    def _listing(self, started, operation):
        argv = ['/usr/bin/systemctl', operation, '--all', '--no-legend', '--no-pager', '--plain']
        if operation != 'list-jobs':
            argv.extend(PATTERNS)
        raw = self._command(argv, started)
        rows = [line.split() for line in raw.splitlines()]
        _require(len(rows) <= MAX_ITEMS)
        for row in rows:
            _require(len(row) >= (2 if operation == 'list-unit-files' else 4))
            unit = row[1] if operation == 'list-jobs' else row[0]
            _require(re.fullmatch(r'[A-Za-z0-9_.@:\\-]+', unit))
            if operation == 'list-jobs':
                _require(row[0].isdigit())
        keys = [row[0] for row in rows]
        _require(len(set(keys)) == len(keys))
        return rows

    def _units(self, started):
        listing = self._listing(started, 'list-units')
        files = self._listing(started, 'list-unit-files')
        policies = {row[0]: row[1] for row in files}
        jobs = self._listing(started, 'list-jobs')
        names = sorted({row[0] for row in listing} | set(policies) | set(quiescence.UNITS) | {LAUNCHER}
            | {row[1] for row in jobs if MARKER.search(row[1])})
        _require(len(names) <= MAX_ITEMS)
        raw = self._command(['/usr/bin/systemctl', 'show', '--no-pager',
            '--property=' + ','.join(PROPERTIES), *names], started)
        observed = {}
        for block in raw.strip('\n').split('\n\n'):
            value = {}
            for line in block.splitlines():
                key, separator, item = line.partition('=')
                _require(separator and key in PROPERTIES and (key not in value or key == 'ExecStart'))
                value[key] = value[key] + '\n' + item if key in value else item
            _require(value['Id'] in names and value['Id'] not in observed)
            observed[value['Id']] = value
        _require(set(observed) == set(names))
        _require({row[0] for row in self._listing(started, 'list-units')} == {row[0] for row in listing}
            and self._listing(started, 'list-unit-files') == files
            and self._listing(started, 'list-jobs') == jobs)
        scoped, unknown = {}, set()
        for name, value in observed.items():
            pending = [row[0] for row in jobs if row[1] == name]
            if name in quiescence.UNITS or name == LAUNCHER:
                keys = ['LoadState', 'ActiveState', 'SubState', 'FragmentPath',
                    'DropInPaths', 'NeedDaemonReload', 'Transient']
                if name.endswith('.service'):
                    keys += ['Restart', 'MainPID']
                if name == 'baci-prefunded-background.service':
                    keys += ['Result', 'ExecMainStatus']
                projected = {key: value[key] for key in keys}
                projected['pendingJobs'] = pending
                quiescence._unit(projected, name)
                if name != LAUNCHER:
                    scoped[name] = projected
            elif MARKER.search(' '.join(value.get(key, '') for key in ('Id', 'ExecStart', 'Triggers'))):
                triggered = value.get('Triggers', '').split()
                stop_timer = (name.endswith('-deadline.timer') and value['ActiveState'] == 'active'
                    and value['SubState'] in ('waiting', 'elapsed') and not pending and len(triggered) == 1
                    and triggered[0] == name[:-6] + '.service'
                    and triggered[0] in observed and _stop_only(observed[triggered[0]]))
                if not stop_timer and not _stop_only(value) and (
                        pending or policies.get(name) in ('enabled', 'enabled-runtime', 'linked', 'linked-runtime')
                        or value['ActiveState'] not in ('inactive', 'failed')
                        or value.get('MainPID', '0') not in ('', '0')):
                    unknown.add('unit:' + name)
        return scoped, unknown

    def _processes(self, started):
        raw = self._command(['/usr/bin/ps', '-eo', 'pid=,ppid=,comm=,args='], started)
        rows = [line.split(None, 3) for line in raw.splitlines()]
        _require(len(rows) <= 4096 and all(len(row) == 4 and row[0].isdigit() and row[1].isdigit() for row in rows)
            and len({row[0] for row in rows}) == len(rows))
        parents = {int(row[0]): int(row[1]) for row in rows}
        _require(all(parents.get(pid) == parent for pid, parent
            in zip(self.driver_ancestry, self.driver_ancestry[1:])))
        return {'process:' + row[0] for row in rows
            if int(row[0]) not in self.driver_ancestry and MARKER.search(row[3])
                and not _stop_only({'ExecStart': 'argv[]=' + row[3] + ' ;'})}

    def _collect(self):
        first, started = self._now(), time.monotonic()
        _require(self.locks_held() is True)
        containers, docker_unknown = self._containers(started)
        units, unit_unknown = self._units(started)
        unknown = docker_unknown | unit_unknown | self._processes(started)
        last = self._now()
        _require(self.locks_held() is True and 0 <= (last - first).total_seconds() <= 25
            and time.monotonic() - started <= 25)
        sample = dict(observedAt=last.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'),
            deadline=quiescence.DEADLINE, containers=containers, units=units)
        quiescence._sample(sample)
        return sample, sorted(unknown)

    def sample(self) -> dict:
        try:
            sample, unknown = self._collect()
            _require(unknown == [])
            return sample
        except Exception:
            raise ValueError('replay_rehearsal_inventory_refused') from None

    def exclusive_inventory(self) -> dict:
        try:
            sample, unknown = self._collect()
            return dict(observedAt=sample['observedAt'], exclusive=True, unknownClaimants=unknown)
        except Exception:
            raise ValueError('replay_rehearsal_inventory_refused') from None

    def collect_sample(self) -> dict:
        return self.sample()
