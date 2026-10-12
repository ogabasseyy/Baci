from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import time


CUTOFF = 1791301750
CONTAINER = 'baci-prefunded-background'
SERVICE = CONTAINER + '.service'
UNIT = '/etc/systemd/system/' + SERVICE
ROOT = '/opt/baci-prefunded-workers'
FILES = frozenset([ROOT + '/code/' + name for name in (
    'background.cjs', 'background.sh', 'readiness.cjs', 'snapshot.cjs')]
    + [ROOT + '/config/background.json'])
DOCKER = ('/usr/bin/docker', '--host=unix:///var/run/docker.sock')
PROPERTIES = ('FragmentPath', 'DropInPaths', 'NeedDaemonReload', 'LoadState',
              'ActiveState', 'SubState', 'Result', 'ExecMainStatus', 'InvocationID',
              'ExecMainStartTimestamp', 'ExecMainExitTimestamp',
              'ExecMainStartTimestampMonotonic', 'ExecMainExitTimestampMonotonic')
JOURNAL_FIELDS = ('__CURSOR', '__REALTIME_TIMESTAMP', '__MONOTONIC_TIMESTAMP', '_BOOT_ID',
    '_UID', '_PID', '_SYSTEMD_UNIT', '_SYSTEMD_INVOCATION_ID', 'UNIT', 'INVOCATION_ID', 'MESSAGE_ID')
JOURNAL_SEQUENCE_FIELDS = frozenset(('__SEQNUM', '__SEQNUM_ID'))
LIFECYCLE = ('7d4958e842da4a758f6c1cdc7b36dcc5', '7ad2d189f7e94e70a38c781354912448',
    '39f53479d3a045ac8e11786248231fbf')
JOURNAL = ('/usr/bin/journalctl', '--no-pager', '--quiet', '--output=json',
    '--output-fields=' + ','.join(JOURNAL_FIELDS))


def require(condition, code):
    if not condition:
        raise ValueError(code)


def digest(value):
    return type(value) is str and re.fullmatch(r'[a-f0-9]{64}', value) is not None


def timestamp(value):
    return _nanoseconds(value) / 1000000000


def _journal_rows(output):
    require(type(output) is str and 0 < len(output.encode()) <= 131072, 'worker_journal_refused')
    def unique(pairs):
        row = {}
        for key, value in pairs:
            require(key not in row, 'worker_journal_refused')
            row[key] = value
        return row
    rows = [json.loads(line, object_pairs_hook=unique) for line in output.splitlines()]
    require(0 < len(rows) <= 256, 'worker_journal_refused')
    cursors = set()
    for row in rows:
        require(type(row) is dict and set(row) <= set(JOURNAL_FIELDS) | JOURNAL_SEQUENCE_FIELDS
            and all(type(value) is str for value in row.values()), 'worker_journal_refused')
        sequence = set(row) & JOURNAL_SEQUENCE_FIELDS
        require(not sequence or sequence == JOURNAL_SEQUENCE_FIELDS, 'worker_journal_refused')
        if sequence:
            require(re.fullmatch(r'(?:0|[1-9][0-9]{0,19})', row['__SEQNUM'])
                and int(row['__SEQNUM']) <= 18446744073709551615
                and re.fullmatch(r'[a-f0-9]{32}', row['__SEQNUM_ID']), 'worker_journal_refused')
        require(re.fullmatch(r'[a-f0-9]{32}', row['_BOOT_ID']) and row['_BOOT_ID'] != '0' * 32
            and re.fullmatch(r'[A-Za-z0-9=;_-]{1,1024}', row['__CURSOR'])
            and row['__CURSOR'] not in cursors, 'worker_journal_refused')
        cursors.add(row['__CURSOR'])
        require(all(re.fullmatch(r'[0-9]{1,20}', row[key]) for key in
            ('__REALTIME_TIMESTAMP', '__MONOTONIC_TIMESTAMP')), 'worker_journal_refused')
    return rows


def _nanoseconds(value):
    require(type(value) is str and re.fullmatch(
        r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{1,9}Z', value),
        'worker_timestamp_refused')
    seconds = int(datetime.fromisoformat(value[:19]).replace(tzinfo=timezone.utc).timestamp())
    return seconds * 1000000000 + int(value[20:-1].ljust(9, '0'))


def _lifecycle(rows, anchor, before, after, state, previous_id, current_id):
    managers, processes, identifiers = {}, [], set()
    last_mono = int(anchor['__MONOTONIC_TIMESTAMP'])
    last_real = int(before * 1000000000)
    for row in rows:
        real, mono = int(row['__REALTIME_TIMESTAMP']) * 1000, int(row['__MONOTONIC_TIMESTAMP'])
        require(row['_BOOT_ID'] == anchor['_BOOT_ID'] and row['__CURSOR'] != anchor['__CURSOR']
            and last_real <= real <= int(after * 1000000000) and mono > last_mono
            and row['_UID'] == '0', 'worker_journal_refused')
        last_real, last_mono = real, mono
        if row.get('_PID') == '1':
            require(row.get('_SYSTEMD_UNIT') == 'init.scope' and row.get('UNIT') == SERVICE
                and row.get('MESSAGE_ID') in LIFECYCLE
                and row['MESSAGE_ID'] not in managers, 'worker_journal_refused')
            identifier = row['INVOCATION_ID']
            require(row.get('_SYSTEMD_INVOCATION_ID', identifier) == identifier, 'worker_journal_refused')
            managers[row['MESSAGE_ID']] = real
        else:
            require(row.get('_SYSTEMD_UNIT') == SERVICE and re.fullmatch(r'[1-9][0-9]*', row['_PID'])
                and row.get('UNIT', SERVICE) == SERVICE, 'worker_journal_refused')
            identifier = row['_SYSTEMD_INVOCATION_ID']
            require(row.get('INVOCATION_ID', identifier) == identifier, 'worker_journal_refused')
            processes.append(real)
        require(re.fullmatch(r'[a-f0-9]{32}', identifier) and identifier != '0' * 32
            and identifier != previous_id and current_id in ('', identifier), 'worker_journal_refused')
        identifiers.add(identifier)
    require(set(managers) == set(LIFECYCLE) and len(identifiers) == 1 and processes, 'worker_journal_refused')
    started, finished, success = [managers[key] for key in LIFECYCLE]
    require(started <= _nanoseconds(state['StartedAt']) <= _nanoseconds(state['FinishedAt'])
        <= finished <= success and all(started <= observed <= finished for observed in processes),
        'worker_journal_refused')
    return dict(bootId=anchor['_BOOT_ID'], invocationId=identifiers.pop(), preStartCursor=anchor['__CURSOR'],
        managerStartedAtNs=started, managerFinishedAtNs=finished, managerSuccessAtNs=success,
        recordsSha256=hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()).hexdigest())


class WorkerAdapter:
    """Injected run raises on failure; read(path, sha) verifies metadata and returns bytes.

    scheduler must be the parent's hash-verified runtime_scheduler module.
    quiescent() must freshly verify other schedules and native replay stopped.
    """

    def __init__(self, *, run, read, inspect, scheduler, container_id, manifest_sha,
                 file_hashes, quiescent):
        require(digest(container_id) and digest(manifest_sha), 'worker_pins_refused')
        require(type(file_hashes) is dict and set(file_hashes) == FILES
                and all(digest(pin) for pin in file_hashes.values()), 'worker_pins_refused')
        require(all(callable(callback) for callback in (run, read, inspect, quiescent)),
                'worker_callbacks_refused')
        self.run, self.read, self.inspect = run, read, inspect
        self.scheduler, self.quiescent = scheduler, quiescent
        self.container_id, self.manifest_sha = container_id, manifest_sha
        self.file_hashes = dict(file_hashes)
        self.unit_bytes = scheduler.units()['background.service'].encode()
        self.used = False

    def _deadline(self):
        now = time.time()
        require(0 <= now < CUTOFF, 'worker_deadline_expired')
        return now

    def _inputs(self):
        unit_sha = hashlib.sha256(self.unit_bytes).hexdigest()
        require(self.read(Path(UNIT), unit_sha) == self.unit_bytes, 'worker_unit_refused')
        for path, pin in sorted(self.file_hashes.items()):
            value = self.read(Path(path), pin)
            require(type(value) is bytes and hashlib.sha256(value).hexdigest() == pin,
                    'worker_file_refused')

    def _properties(self):
        output = self.run(['/usr/bin/systemctl', 'show', SERVICE,
            *['--property=' + key for key in PROPERTIES]], timeout=30)
        require(type(output) is str and len(output) <= 8192, 'worker_unit_refused')
        result = {}
        for line in output.splitlines():
            require('=' in line, 'worker_unit_refused')
            key, value = line.split('=', 1)
            require(key in PROPERTIES and key not in result, 'worker_unit_refused')
            result[key] = value
        require(set(result) == set(PROPERTIES) and result['FragmentPath'] == UNIT
                and result['DropInPaths'] == '' and result['NeedDaemonReload'] == 'no'
                and result['LoadState'] == 'loaded', 'worker_unit_refused')
        return result

    def _container(self, completed=False):
        observed = self.inspect(CONTAINER)
        require(observed['Id'] == self.container_id and observed['Name'] == '/' + CONTAINER,
                'worker_container_identity_refused')
        self.scheduler.validate_container(observed, 'background', self.manifest_sha)
        state = observed['State']
        require(state['Running'] is False and state['Paused'] is False
                and state['Restarting'] is False and state['Dead'] is False
                and state['Status'] in ('created', 'exited'), 'worker_not_stopped')
        require(type(state['StartedAt']) is str, 'worker_timestamp_refused')
        if completed:
            require(state['Status'] == 'exited' and state['OOMKilled'] is False
                    and type(state['ExitCode']) is int and state['ExitCode'] == 0,
                    'worker_exit_refused')
        return observed

    def _quiescent(self):
        before = self._deadline()
        require(self.quiescent() is True, 'worker_quiescence_refused')
        require(0 <= self._deadline() - before <= 30, 'worker_quiescence_stale')

    def _journal_anchor(self):
        rows = _journal_rows(self.run([*JOURNAL, '--boot=0', '--lines=1'], timeout=30))
        require(len(rows) == 1 and int(rows[0]['__REALTIME_TIMESTAMP']) * 1000
            <= int(self._deadline() * 1000000000), 'worker_journal_refused')
        return rows[0]

    def _journal_witness(self, anchor, before, state, previous_id, current_id):
        boot, cursor = '--boot=' + anchor['_BOOT_ID'], anchor['__CURSOR']
        require(self._journal_anchor()['_BOOT_ID'] == anchor['_BOOT_ID'], 'worker_journal_refused')
        require(_journal_rows(self.run([*JOURNAL, boot, '--cursor=' + cursor, '--lines=1'],
            timeout=30)) == [anchor], 'worker_journal_refused')
        rows = _journal_rows(self.run([*JOURNAL, boot, '--after-cursor=' + cursor, '--lines=257',
            'UNIT=' + SERVICE, '+', '_SYSTEMD_UNIT=' + SERVICE], timeout=30))
        return _lifecycle(rows, anchor, before, self._deadline(), state, previous_id, current_id)

    def _stop(self):
        for arguments, timeout in (
            (['/usr/bin/systemctl', 'stop', SERVICE], 30),
            ([*DOCKER, 'stop', '--time', '5', self.container_id], 15)):
            try:
                self.run(arguments, timeout=timeout)
            except Exception:
                pass
        try:
            stopped = self.inspect(self.container_id)
            unit = self._properties()
            require(stopped['Id'] == self.container_id and stopped['State']['Running'] is False
                    and unit['ActiveState'] in ('inactive', 'failed')
                    and unit['SubState'] in ('dead', 'failed'), 'worker_cleanup_unverified')
        except Exception:
            raise ValueError('worker_cleanup_unverified') from None

    def run_once(self):
        require(not self.used, 'worker_already_attempted')
        self.used = True
        attempted = False
        try:
            self._deadline()
            self._inputs()
            previous_unit = self._properties()
            require(previous_unit['ActiveState'] == 'inactive' and previous_unit['SubState'] == 'dead'
                    and (previous_unit['InvocationID'] == '' or re.fullmatch(
                        r'[a-f0-9]{32}', previous_unit['InvocationID'])), 'worker_unit_not_inactive')
            previous_start = self._container()['State']['StartedAt']
            self._quiescent()
            anchor = self._journal_anchor()
            before = self._deadline()
            attempted = True
            self.run(['/usr/bin/systemctl', 'start', SERVICE], timeout=500)
            self._deadline()
            unit = self._properties()
            require(unit['ActiveState'] == 'inactive' and unit['SubState'] == 'dead'
                    and unit['Result'] == 'success' and unit['ExecMainStatus'] == '0',
                    'worker_invocation_not_fresh')
            state = self._container(completed=True)['State']
            started, finished = timestamp(state['StartedAt']), timestamp(state['FinishedAt'])
            require(state['StartedAt'] != previous_start and before <= started <= finished <= self._deadline(),
                    'worker_invocation_not_fresh')
            invocation = unit['InvocationID']
            if invocation == '':
                require(unit['ExecMainStartTimestamp'] == unit['ExecMainExitTimestamp'] == ''
                    and unit['ExecMainStartTimestampMonotonic'] == unit['ExecMainExitTimestampMonotonic'] == '0',
                    'worker_invocation_not_fresh')
            witness = self._journal_witness(anchor, before, state, previous_unit['InvocationID'], invocation)
            invocation = witness['invocationId']
            require(re.fullmatch(r'[a-f0-9]{32}', invocation) and invocation != '0' * 32
                and invocation != previous_unit['InvocationID'], 'worker_invocation_not_fresh')
            output = self.run([*DOCKER, 'logs', '--since', state['StartedAt'], self.container_id], timeout=30)
            require(output in ('{"status":"completed"}', '{"status":"completed"}\n'), 'worker_report_refused')
            self._inputs()
            self._quiescent()
            require(self._properties() == unit, 'worker_invocation_changed')
            final = self._container(completed=True)['State']
            require(final['StartedAt'] == state['StartedAt'] and final['FinishedAt'] == state['FinishedAt'],
                    'worker_invocation_changed')
            require(self._journal_witness(anchor, before, final, previous_unit['InvocationID'],
                unit['InvocationID']) == witness, 'worker_invocation_changed')
            self._deadline()
            report = dict(status='background-oneshot-completed', service=SERVICE,
                containerId=self.container_id, manifestSha256=self.manifest_sha,
                invocationId=invocation, startedAt=state['StartedAt'],
                finishedAt=state['FinishedAt'], exitCode=0)
            report['journalWitness'] = witness
            return report
        except Exception:
            if attempted:
                self._stop()
            raise ValueError('worker_invocation_refused') from None
