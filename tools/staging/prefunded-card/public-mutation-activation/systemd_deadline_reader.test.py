import unittest
from unittest.mock import patch

import systemd_deadline_reader as reader
import readiness_evidence_timers as sealed


def arguments(stem, pager=True):
    return ['/usr/bin/systemctl', 'show', *(['--no-pager'] if pager else []),
        '--property=FragmentPath,DropInPaths,NeedDaemonReload,LoadState,ExecStart', stem + '.service']


def records(stem):
    return ['{ path=' + stop.split()[0] + ' ; argv[]=' + stop
        + ' ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }'
        for stop in sealed.STOPS[stem]]


def output(stem):
    return ('FragmentPath=' + sealed.PREFIX + stem + '.service\nDropInPaths=\n'
        'NeedDaemonReload=no\nLoadState=loaded\n'
        + ''.join('ExecStart=' + record + '\n' for record in records(stem)))


class DeadlineReaderTests(unittest.TestCase):
    def test_regression_repeated_execstart_becomes_one_property_with_original_records(self):
        for stem in sealed.STOPS:
            for pager in (True, False):
                original = output(stem)
                with self.subTest(stem=stem, pager=pager):
                    if len(records(stem)) > 1:
                        with self.assertRaisesRegex(ValueError, 'systemd_duplicate_properties'):
                            sealed.properties(original)
                    result = reader.wrapper(arguments(stem, pager), run=lambda command: original)
                    properties = sealed.properties(result)
                    self.assertEqual(properties['ExecStart'], ' '.join(records(stem)))
                    self.assertEqual(result.split('ExecStart=')[0], original.split('ExecStart=')[0])

    def test_normalized_output_passes_unchanged_sealed_loaded_reader(self):
        for stem, stops in sealed.STOPS.items():
            unit = stem + '.service'
            artifacts = {unit: {'path': sealed.PREFIX + unit}}
            source = '\n'.join('ExecStart=' + stop for stop in stops).encode()
            with patch.object(sealed, 'pinned', return_value=source):
                content, properties = sealed.loaded(unit, artifacts, ['ExecStart'],
                    lambda command: reader.wrapper(command, run=lambda unchanged: output(stem)))
            self.assertEqual(content, source.decode())
            self.assertEqual(properties['ExecStart'], ' '.join(records(stem)))

    def test_legacy_single_property_is_preserved_byte_for_byte(self):
        stem = 'baci-prefunded-public-deadline'
        original = output(stem).split('ExecStart=')[0] + 'ExecStart=' + ' '.join(records(stem)) + '\n'
        self.assertEqual(reader.wrapper(arguments(stem), run=lambda command: original), original)

    def test_full_sealed_timer_collector_keeps_fragment_and_effective_target_checks(self):
        artifacts = {}
        contents = {}
        for stem, stops in sealed.STOPS.items():
            for suffix, content in (('.service', '\n'.join('ExecStart=' + stop for stop in stops)),
                    ('.timer', 'OnCalendar=' + sealed.DATE + '\nUnit=' + stem + '.service')):
                unit = stem + suffix
                artifacts[unit] = {'path': sealed.PREFIX + unit}
                contents[sealed.PREFIX + unit] = content.encode()
        def run(command):
            unit = command[-1]
            stem = unit.removesuffix('.service').removesuffix('.timer')
            if unit.endswith('.service'):
                return output(stem)
            return ('FragmentPath=' + sealed.PREFIX + unit + '\nDropInPaths=\n'
                'NeedDaemonReload=no\nLoadState=loaded\nActiveState=active\nSubState=waiting\n'
                'Unit=' + stem + '.service\nTimersCalendar={ OnCalendar=' + sealed.DATE
                + ' ; next_elapse=' + sealed.DATE + ' ; }\nNextElapseUSecRealtime=' + sealed.DATE)
        with patch.object(sealed, 'pinned', side_effect=lambda row: contents[row['path']]):
            result = sealed.collect(artifacts, run=lambda command: reader.wrapper(command, run=run))
            self.assertEqual(len(result), 3)
            self.assertTrue(all(row['stopTargetsVerified'] for row in result.values()))
            contents[sealed.PREFIX + 'baci-prefunded-deadline.service'] = b'ExecStart=/bin/true'
            with self.assertRaisesRegex(ValueError, 'stop_targets_refused'):
                sealed.collect(artifacts, run=lambda command: reader.wrapper(command, run=run))

    def test_unrelated_calls_pass_through_exact_arguments_and_result(self):
        stem = 'baci-prefunded-public-deadline'
        variants = [arguments(stem)[:-1] + ['unreviewed.service'],
            arguments(stem)[:-1] + [stem + '.timer'],
            [part.replace('LoadState,ExecStart', 'ExecStart,LoadState') for part in arguments(stem)],
            arguments(stem) + ['--extra'], ['/usr/bin/docker', 'inspect', 'worker']]
        for command in variants:
            result = object()
            calls = []
            def run(unchanged):
                calls.append(unchanged)
                return result
            self.assertIs(reader.wrapper(command, run=run), result)
            self.assertIs(calls[0], command)

    def test_duplicate_missing_extra_or_changed_loaded_properties_refuse(self):
        stem = 'baci-prefunded-public-deadline'
        original = output(stem)
        changed = [original + 'LoadState=loaded\n', original.replace('DropInPaths=\n', ''),
            original + 'Extra=unexpected\n', original.replace('NeedDaemonReload=no', 'NeedDaemonReload=yes'),
            original.replace('DropInPaths=', 'DropInPaths=/override'),
            original.replace('LoadState=loaded', 'LoadState=not-found'),
            original.replace(sealed.PREFIX + stem, sealed.PREFIX + 'other'), original + '\n']
        for content in changed:
            with self.subTest(content=content), self.assertRaises(ValueError):
                reader.wrapper(arguments(stem), run=lambda command: content)

    def test_missing_extra_reversed_or_duplicate_command_records_refuse(self):
        stem = 'baci-prefunded-public-deadline'
        prefix = output(stem).split('ExecStart=')[0]
        commands = records(stem)
        for rows in ([], commands[:1], commands + commands[:1], commands[::-1], commands[:1] * 2):
            content = prefix + ''.join('ExecStart=' + record + '\n' for record in rows)
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                reader.wrapper(arguments(stem), run=lambda command: content)

    def test_changed_path_argv_noerror_flag_extra_fields_or_junk_refuse(self):
        stem = 'baci-prefunded-replay-deadline'
        original = output(stem)
        changed = [original.replace('path=/usr/bin/docker', 'path=/bin/true'),
            original.replace('pvb-staging-replay-prefunded', 'other-target'),
            original.replace('ignore_errors=no', 'ignore_errors=yes'),
            original.replace('ignore_errors=no', 'ignore_errors=no ; ignore_errors=no'),
            original.replace(' ; ignore_errors=no', ''),
            original.replace(' ; pid=0', ' ; unexpected=no ; pid=0'),
            original.replace('ExecStart={', 'ExecStart=junk {'),
            original.replace('status=0/0 }', 'status=0/0 } junk'),
            original.replace('ExecStart={', 'ExecStart={{'), original + 'ExecStart=\n']
        for content in changed:
            with self.subTest(content=content), self.assertRaises(ValueError):
                reader.wrapper(arguments(stem), run=lambda command: content)

    def test_runner_failure_is_not_swallowed(self):
        def run(command):
            raise RuntimeError('failed show')
        with self.assertRaisesRegex(RuntimeError, 'failed show'):
            reader.wrapper(arguments('baci-prefunded-deadline'), run=run)

    def test_deadline_reader_forwards_timeout_and_input_text_without_changing_validation(self):
        stem = 'baci-prefunded-deadline'
        calls = []
        command = arguments(stem)
        def run(original, **kwargs):
            calls.append((original, kwargs))
            return output(stem)
        result = reader.wrapper(command, run=run, timeout=17, input_text='retained-input')
        self.assertIs(calls[0][0], command)
        self.assertEqual(calls[0][1], {'timeout': 17, 'input_text': 'retained-input'})
        self.assertEqual(sealed.properties(result)['ExecStart'], ' '.join(records(stem)))
        with self.assertRaises(ValueError):
            reader.wrapper(command, run=lambda original, **kwargs:
                output(stem).replace('ignore_errors=no', 'ignore_errors=yes'), timeout=17, input_text=None)

    def test_other_commands_forward_all_keywords_and_preserve_original_result(self):
        command = ['/usr/bin/docker', 'exec', 'database', 'psql']
        result = object()
        calls = []
        def run(original, **kwargs):
            calls.append((original, kwargs))
            return result
        self.assertIs(reader.wrapper(command, run=run, timeout=9, input_text='BEGIN READ ONLY;'), result)
        self.assertIs(calls[0][0], command)
        self.assertEqual(calls[0][1], {'timeout': 9, 'input_text': 'BEGIN READ ONLY;'})


if __name__ == '__main__':
    unittest.main()
