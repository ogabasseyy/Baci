import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import worker_adapter as module

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'prefunded-card'))
import runtime_scheduler as scheduler


class WorkerAdapterTests(unittest.TestCase):
    def setUp(self):
        self.now = 1791000000.0
        self.identifier, self.manifest = 'a' * 64, 'b' * 64
        self.files = {path: ('synthetic-' + Path(path).name).encode() for path in module.FILES}
        self.files[module.UNIT] = scheduler.units()['background.service'].encode()
        self.pins = {path: hashlib.sha256(value).hexdigest()
                     for path, value in self.files.items() if path != module.UNIT}
        self.container = scheduler.container_contract('background', self.manifest)
        self.container.update(Id=self.identifier, Name='/' + module.CONTAINER, State=dict(
            Status='exited', Running=False, Paused=False, Restarting=False, Dead=False,
            OOMKilled=False, ExitCode=0, StartedAt=self.stamp(self.now - 60),
            FinishedAt=self.stamp(self.now - 50)))
        self.unit = dict(FragmentPath=module.UNIT, DropInPaths='', NeedDaemonReload='no',
            LoadState='loaded', ActiveState='inactive', SubState='dead', Result='success',
            ExecMainStatus='0', InvocationID='1' * 32, ExecMainStartTimestamp='',
            ExecMainExitTimestamp='', ExecMainStartTimestampMonotonic='0',
            ExecMainExitTimestampMonotonic='0')
        self.boot, self.cursor = 'c' * 32, 's=anchor;i=1'
        self.anchor = dict(__CURSOR=self.cursor, _BOOT_ID=self.boot,
            __REALTIME_TIMESTAMP=str(int((self.now - 1) * 1000000)), __MONOTONIC_TIMESTAMP='1000000')
        self.journal = None
        self.calls, self.proof_calls = [], 0
        self.proof, self.log = True, '{"status":"completed"}\n'
        self.after_start = None
        self.after_proof = None
        self.after_log = None
        self.adapter = module.WorkerAdapter(run=self.command, read=self.read, inspect=self.inspect,
            scheduler=scheduler, container_id=self.identifier, manifest_sha=self.manifest,
            file_hashes=self.pins, quiescent=self.quiescent)

    def stamp(self, value):
        return datetime.fromtimestamp(value, timezone.utc).isoformat(
            timespec='microseconds').replace('+00:00', 'Z')

    def read(self, path, pin):
        return self.files[str(path)]

    def inspect(self, name):
        self.assertIn(name, (module.CONTAINER, self.identifier))
        return copy.deepcopy(self.container)

    def quiescent(self):
        self.proof_calls += 1
        if self.after_proof:
            self.after_proof()
        return self.proof

    def command(self, arguments, *, timeout):
        self.calls.append((arguments, timeout))
        if arguments[0] == '/usr/bin/journalctl':
            if '--lines=1' in arguments:
                return json.dumps(self.anchor) + '\n'
            return '\n'.join(json.dumps(row) for row in self.journal_rows()) + '\n'
        if arguments[:2] == ['/usr/bin/systemctl', 'show']:
            return ''.join(key + '=' + value + '\n' for key, value in self.unit.items()
                if '--property=' + key in arguments)
        if arguments == ['/usr/bin/systemctl', 'start', module.SERVICE]:
            self.assertEqual(timeout, 500)
            self.container['State'].update(StartedAt=self.stamp(self.now + 0.1),
                                          FinishedAt=self.stamp(self.now + 0.2))
            self.unit['InvocationID'] = '2' * 32
            self.now += 0.3
            if self.after_start:
                self.after_start()
            return ''
        if arguments[:3] == [*module.DOCKER, 'logs']:
            self.assertEqual(arguments[-1], self.identifier)
            self.assertEqual(arguments[-2], self.container['State']['StartedAt'])
            if self.after_log:
                self.after_log()
            return self.log
        if arguments == ['/usr/bin/systemctl', 'stop', module.SERVICE]:
            self.unit.update(ActiveState='inactive', SubState='dead')
            return ''
        if arguments == [*module.DOCKER, 'stop', '--time', '5', self.identifier]:
            self.container['State']['Running'] = False
            return ''
        raise AssertionError('Unexpected mock command')

    def journal_rows(self):
        if self.journal is not None:
            return self.journal
        base = int((self.now - 0.3) * 1000000)
        rows = []
        for offset, message in ((50000, '7d4958e842da4a758f6c1cdc7b36dcc5'),
                (250000, '7ad2d189f7e94e70a38c781354912448'),
                (260000, '39f53479d3a045ac8e11786248231fbf')):
            rows.append(dict(_UID='0', _PID='1', _SYSTEMD_UNIT='init.scope', UNIT=module.SERVICE,
                INVOCATION_ID='2' * 32, MESSAGE_ID=message))
        rows.insert(1, dict(_UID='0', _PID='42', _SYSTEMD_UNIT=module.SERVICE,
            _SYSTEMD_INVOCATION_ID='2' * 32))
        for index, (row, offset) in enumerate(zip(rows, (50000, 150000, 250000, 260000))):
            row.update(__CURSOR='s=execution;i=' + str(index + 2), _BOOT_ID=self.boot,
                __REALTIME_TIMESTAMP=str(base + offset), __MONOTONIC_TIMESTAMP=str(2000000 + offset))
        return rows

    def execute(self):
        with patch.object(module.time, 'time', side_effect=lambda: self.now):
            return self.adapter.run_once()

    def starts(self):
        return [entry for entry in self.calls if entry[0][:2] == ['/usr/bin/systemctl', 'start']]

    def assert_refused_without_start(self):
        with self.assertRaisesRegex(ValueError, '^worker_invocation_refused$'):
            self.execute()
        self.assertEqual(self.starts(), [])
        self.assertFalse(any(arguments[:2] == ['/usr/bin/systemctl', 'stop']
                             for arguments, timeout in self.calls))

    def test_exact_existing_profile_and_unit_complete_only_one_invocation(self):
        report = self.execute()
        self.assertEqual(report.pop('journalWitness')['invocationId'], '2' * 32)
        self.assertEqual(report, dict(status='background-oneshot-completed', service=module.SERVICE,
            containerId=self.identifier, manifestSha256=self.manifest, invocationId='2' * 32,
            startedAt=self.container['State']['StartedAt'], finishedAt=self.container['State']['FinishedAt'],
            exitCode=0))
        self.assertEqual(len(self.starts()), 1)
        self.assertEqual(self.proof_calls, 2)
        self.assertNotIn('financialProofPassed', report)
        with self.assertRaisesRegex(ValueError, 'worker_already_attempted'):
            self.execute()
        self.assertEqual(len(self.starts()), 1)

    def test_mismatched_mount_is_refused_by_actual_frozen_scheduler(self):
        self.container['Mounts'][0]['RW'] = True
        self.assert_refused_without_start()

    def test_new_container_id_is_never_started(self):
        self.container['Id'] = 'c' * 64
        self.assert_refused_without_start()

    def test_unit_bytes_override_is_refused(self):
        self.files[module.UNIT] += b'Environment=unsafe\n'
        self.assert_refused_without_start()

    def test_effective_dropin_reload_or_fragment_override_is_refused(self):
        for key, value in (('DropInPaths', '/run/override.conf'), ('NeedDaemonReload', 'yes'),
                           ('FragmentPath', '/run/systemd/transient/worker.service')):
            with self.subTest(key=key):
                self.setUp()
                self.unit[key] = value
                self.assert_refused_without_start()

    def test_missing_or_duplicate_unit_properties_fail_closed(self):
        original = self.adapter.run
        for mutation in ('missing', 'duplicate'):
            with self.subTest(mutation=mutation):
                self.setUp()
                original = self.adapter.run
                def changed(arguments, *, timeout):
                    output = original(arguments, timeout=timeout)
                    if arguments[1] == 'show':
                        return (output.replace('NeedDaemonReload=no\n', '') if mutation == 'missing'
                                else output + 'DropInPaths=/run/override.conf\n')
                    return output
                self.adapter.run = changed
                self.assert_refused_without_start()

    def test_each_code_and_config_hash_is_verified_without_returning_bytes(self):
        for path in module.FILES:
            with self.subTest(path=path):
                self.setUp()
                self.files[path] += b'private-drift'
                self.assert_refused_without_start()

    def test_running_container_is_not_started_or_stopped_implicitly(self):
        self.container['State']['Running'] = True
        self.assert_refused_without_start()

    def test_false_or_nonboolean_quiescence_blocks_start(self):
        for proof in (False, 1, {'verified': True}):
            with self.subTest(proof=proof):
                self.setUp()
                self.proof = proof
                self.assert_refused_without_start()

    def test_quiescence_collection_cannot_age_or_cross_fixed_cutoff(self):
        for starting, elapsed in ((self.now, 31), (module.CUTOFF - 1, 1)):
            with self.subTest(starting=starting):
                self.setUp()
                self.now = starting
                self.after_proof = lambda: setattr(self, 'now', self.now + elapsed)
                self.assert_refused_without_start()

    def test_expired_fence_refuses_before_any_callback(self):
        self.now = module.CUTOFF
        self.assert_refused_without_start()
        self.assertEqual(self.calls, [])
        self.assertEqual(self.proof_calls, 0)

    def test_deadline_is_rechecked_after_start_and_stops_without_retry(self):
        self.after_start = lambda: setattr(self, 'now', module.CUTOFF)
        with self.assertRaisesRegex(ValueError, '^worker_invocation_refused$'):
            self.execute()
        self.assertEqual(len(self.starts()), 1)
        self.assertIn((['/usr/bin/systemctl', 'stop', module.SERVICE], 30), self.calls)
        self.assertIn(([*module.DOCKER, 'stop', '--time', '5', self.identifier], 15), self.calls)

    def test_stale_successful_invocation_id_is_not_accepted(self):
        self.after_start = lambda: self.unit.update(InvocationID='1' * 32)
        with self.assertRaisesRegex(ValueError, '^worker_invocation_refused$'):
            self.execute()
        self.assertEqual(len(self.starts()), 1)

    def test_stale_or_future_started_at_is_not_accepted(self):
        for stamp in (self.stamp(self.now - 1), self.stamp(self.now + 100)):
            with self.subTest(stamp=stamp):
                self.setUp()
                self.after_start = lambda: self.container['State'].update(StartedAt=stamp)
                with self.assertRaisesRegex(ValueError, '^worker_invocation_refused$'):
                    self.execute()

    def test_failure_ambiguous_running_or_nonzero_exit_stops_only_owned_worker(self):
        changes = [dict(ExitCode=1), dict(ExitCode=False), dict(Running=True), dict(OOMKilled=True)]
        for change in changes:
            with self.subTest(change=change):
                self.setUp()
                self.after_start = lambda: self.container['State'].update(change)
                with self.assertRaisesRegex(ValueError, '^worker_invocation_refused$'):
                    self.execute()
                self.assertFalse(self.container['State']['Running'])
                self.assertEqual(len(self.starts()), 1)

    def test_exact_completed_log_rejects_busy_duplicates_and_private_fields(self):
        for output in ('{"status":"busy"}', '{"status":"completed","secret":"private"}',
                       '{"status":"completed"}\n{"status":"completed"}\n', ''):
            with self.subTest(output=output):
                self.setUp()
                self.log = output
                with self.assertRaisesRegex(ValueError, '^worker_invocation_refused$'):
                    self.execute()

    def test_final_blocking_log_cannot_hide_deadline_or_source_drift(self):
        for mutation in ('deadline', 'files'):
            with self.subTest(mutation=mutation):
                self.setUp()
                def change():
                    if mutation == 'deadline':
                        self.now = module.CUTOFF
                    else:
                        self.files[next(iter(module.FILES))] += b'drift'
                self.after_log = change
                with self.assertRaisesRegex(ValueError, '^worker_invocation_refused$'):
                    self.execute()

    def test_callback_error_is_redacted_and_no_retry_or_restart_occurs(self):
        def fail():
            self.container['State']['Running'] = True
            raise RuntimeError('secret-provider-body')
        self.after_start = fail
        with self.assertRaisesRegex(ValueError, '^worker_invocation_refused$') as caught:
            self.execute()
        self.assertNotIn('secret', str(caught.exception))
        self.assertFalse(self.container['State']['Running'])
        self.assertEqual(len(self.starts()), 1)
        self.assertFalse(any('restart' in arguments for arguments, timeout in self.calls))


if __name__ == '__main__':
    unittest.main()
