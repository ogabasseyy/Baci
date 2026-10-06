import copy
import importlib.util
import json
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location('journal_worker_fixture',
    Path(__file__).with_name('worker_adapter.test.py'))
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)


class WorkerJournalTests(unittest.TestCase):
    def setUp(self):
        self.worker = FIXTURE.WorkerAdapterTests('runTest')
        self.worker.setUp()
        self.worker.after_start = lambda: self.worker.unit.update(InvocationID='')

    def test_cleared_invocation_id_and_zero_execution_timestamps_use_fresh_journal_lifecycle(self):
        result = self.worker.execute()
        self.assertEqual(result['invocationId'], '2' * 32)
        self.assertEqual(self.worker.unit['InvocationID'], '')
        self.assertEqual(self.worker.unit['ExecMainStartTimestampMonotonic'], '0')
        self.assertEqual(self.worker.unit['ExecMainExitTimestampMonotonic'], '0')
        self.assertEqual(result['journalWitness']['bootId'], self.worker.boot)
        self.assertEqual(len(self.worker.starts()), 1)
        with self.assertRaisesRegex(ValueError, 'worker_already_attempted'):
            self.worker.execute()

    def refuse(self):
        with self.assertRaisesRegex(ValueError, '^worker_invocation_refused$'):
            self.worker.execute()
        self.assertEqual(len(self.worker.starts()), 1)

    def fixture_rows(self):
        self.worker.now += 0.3
        rows = self.worker.journal_rows()
        self.worker.now -= 0.3
        return copy.deepcopy(rows)

    def test_actual_nanosecond_container_bounds_fit_captured_structured_lifecycle(self):
        self.worker.now = 1791023922.1
        self.worker.boot = 'c2fd1cd167374bfb815c37dab031efe2'
        self.worker.anchor.update(_BOOT_ID=self.worker.boot, __REALTIME_TIMESTAMP='1791023922100000')
        rows = self.fixture_rows()
        rows[0]['__REALTIME_TIMESTAMP'] = '1791023922205654'
        rows[1]['__REALTIME_TIMESTAMP'] = '1791023923295219'
        rows[2]['__REALTIME_TIMESTAMP'] = '1791023923553855'
        rows[3]['__REALTIME_TIMESTAMP'] = '1791023923554466'
        for row in rows:
            for key in ('INVOCATION_ID', '_SYSTEMD_INVOCATION_ID'):
                if key in row:
                    row[key] = 'e0caa2fd672447939323cd614ac8baea'
        self.worker.journal = rows
        def actual_completion():
            self.worker.unit['InvocationID'] = ''
            self.worker.container['State'].update(StartedAt='2026-10-03T10:38:42.342642115Z',
                FinishedAt='2026-10-03T10:38:43.29685257Z')
            self.worker.now = 1791023923.6
        self.worker.after_start = actual_completion
        self.assertEqual(self.worker.execute()['invocationId'], 'e0caa2fd672447939323cd614ac8baea')

    def test_wrong_root_manager_unit_boot_and_invocation_metadata_refuse(self):
        changes = ((0, '_UID', '1000'), (0, '_PID', '2'), (0, '_SYSTEMD_UNIT', 'other.scope'),
            (0, 'UNIT', 'other.service'), (0, '_BOOT_ID', 'd' * 32),
            (0, 'INVOCATION_ID', '0' * 32), (0, 'INVOCATION_ID', '1' * 32),
            (1, '_UID', '1000'), (1, '_SYSTEMD_UNIT', 'other.service'),
            (1, '_SYSTEMD_INVOCATION_ID', '3' * 32), (1, '_PID', '0'))
        for index, key, value in changes:
            with self.subTest(index=index, key=key):
                self.setUp()
                self.worker.journal = self.fixture_rows()
                self.worker.journal[index][key] = value
                self.refuse()

    def test_missing_duplicate_or_reversed_lifecycle_refuses(self):
        for change in ('start', 'finish', 'success', 'process', 'duplicate', 'reverse'):
            with self.subTest(change=change):
                self.setUp()
                rows = self.fixture_rows()
                if change in ('start', 'finish', 'success', 'process'):
                    rows.pop({'start': 0, 'process': 1, 'finish': 2, 'success': 3}[change])
                elif change == 'duplicate':
                    rows.append(copy.deepcopy(rows[-1]))
                else:
                    rows.reverse()
                self.worker.journal = rows
                self.refuse()

    def test_stale_future_and_outside_exact_container_bounds_refuse(self):
        for index, delta in ((0, -100000), (0, 100000), (2, -100000), (3, 1000000)):
            with self.subTest(index=index, delta=delta):
                self.setUp()
                self.worker.journal = self.fixture_rows()
                row = self.worker.journal[index]
                row['__REALTIME_TIMESTAMP'] = str(int(row['__REALTIME_TIMESTAMP']) + delta)
                self.refuse()

    def test_nonempty_property_must_agree_with_journal_id(self):
        self.worker.after_start = lambda: self.worker.unit.update(InvocationID='3' * 32)
        self.refuse()

    def test_nonzero_execution_timestamp_with_empty_property_refuses(self):
        self.worker.after_start = lambda: self.worker.unit.update(InvocationID='',
            ExecMainStartTimestampMonotonic='123')
        self.refuse()

    def test_cursor_is_captured_before_start_and_missing_capture_refuses_without_start(self):
        self.worker.execute()
        commands = [arguments for arguments, timeout in self.worker.calls]
        capture = next(index for index, args in enumerate(commands) if args[0] == '/usr/bin/journalctl')
        start = commands.index(['/usr/bin/systemctl', 'start', FIXTURE.module.SERVICE])
        self.assertLess(capture, start)
        self.setUp()
        original = self.worker.adapter.run
        def no_anchor(arguments, **options):
            return '' if arguments[0] == '/usr/bin/journalctl' else original(arguments, **options)
        self.worker.adapter.run = no_anchor
        self.worker.assert_refused_without_start()

    def test_boot_change_or_missing_cursor_refuses(self):
        for change in ('boot', 'cursor'):
            with self.subTest(change=change):
                self.setUp()
                original = self.worker.adapter.run
                def changed(arguments, **options):
                    raw = original(arguments, **options)
                    if arguments[0] == '/usr/bin/journalctl' and self.worker.starts() and '--lines=1' in arguments:
                        row = json.loads(raw)
                        row['_BOOT_ID' if change == 'boot' else '__CURSOR'] = 'd' * 32
                        return json.dumps(row)
                    return raw
                self.worker.adapter.run = changed
                self.refuse()

    def test_final_journal_drift_refuses_without_retry(self):
        def drift():
            self.worker.journal = self.fixture_rows()
            self.worker.journal[-1]['__CURSOR'] = 's=changed;i=9'
        self.worker.after_log = drift
        self.refuse()

    def test_parser_rejects_duplicate_keys_truncation_array_fields_and_bounds(self):
        for raw in ('{"_BOOT_ID":"a","_BOOT_ID":"b"}', '{', 'NaN', '',
                'x' * 131073, json.dumps(dict(self.worker.anchor, _UID=['0', '1'])),
                '\n'.join(json.dumps(dict(self.worker.anchor, __CURSOR='s=test;i=' + str(index)))
                    for index in range(257))):
            with self.subTest(length=len(raw)):
                with self.assertRaises((ValueError, TypeError, KeyError)):
                    FIXTURE.module._journal_rows(raw)

    def test_observed_optional_sequence_pair_is_retained_and_supports_cleared_id(self):
        metadata = {'__SEQNUM': '86778804', '__SEQNUM_ID': '508fc3f681924718a0fd32feac027010'}
        self.worker.anchor.update(metadata)
        self.worker.journal = self.fixture_rows()
        for index, row in enumerate(self.worker.journal):
            row.update(metadata, __SEQNUM=str(86778805 + index))
        parsed = FIXTURE.module._journal_rows(json.dumps(self.worker.anchor))
        self.assertEqual(parsed[0]['__SEQNUM'], metadata['__SEQNUM'])
        self.assertEqual(parsed[0]['__SEQNUM_ID'], metadata['__SEQNUM_ID'])
        self.assertEqual(self.worker.execute()['invocationId'], '2' * 32)
        self.assertEqual(len(self.worker.starts()), 1)

    def test_optional_sequence_pair_requires_both_fields_and_exact_types_and_formats(self):
        valid = {'__SEQNUM': '86778804', '__SEQNUM_ID': '508fc3f681924718a0fd32feac027010'}
        cases = ({'__SEQNUM': valid['__SEQNUM']}, {'__SEQNUM_ID': valid['__SEQNUM_ID']})
        cases += tuple(dict(valid, __SEQNUM=value) for value in
            (86778804, True, [], '', '-1', '+1', '1.0', ' 1', '01', '18446744073709551616'))
        cases += tuple(dict(valid, __SEQNUM_ID=value) for value in
            (123, True, [], '', 'a' * 31, 'a' * 33, 'g' * 32, 'A' * 32))
        for metadata in cases:
            with self.subTest(metadata=metadata):
                with self.assertRaisesRegex(ValueError, '^worker_journal_refused$'):
                    FIXTURE.module._journal_rows(json.dumps(dict(self.worker.anchor, **metadata)))

    def test_known_sequence_pair_never_allows_unknown_fields(self):
        row = dict(self.worker.anchor, __SEQNUM='86778804',
            __SEQNUM_ID='508fc3f681924718a0fd32feac027010')
        for field in ('MESSAGE', '__SEQNUM_EXTRA', '__UNKNOWN_METADATA'):
            with self.subTest(field=field):
                with self.assertRaisesRegex(ValueError, '^worker_journal_refused$'):
                    FIXTURE.module._journal_rows(json.dumps(dict(row, **{field: 'unexpected'})))


if __name__ == '__main__':
    unittest.main()
