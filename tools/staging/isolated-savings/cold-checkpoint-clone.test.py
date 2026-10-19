import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import tempfile
import sys

spec = importlib.util.spec_from_file_location('clone', Path(__file__).with_name('cold-checkpoint-clone.py'))
clone = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clone)


def receipt():
    return {'databaseStoppedCleanly': True, 'sourceContainerId': 'a' * 64,
            'systemIdentifier': '7685292944002592802', 'checkpointVolumes': clone.SOURCES,
            'sourceVolumes': [f'{clone.PROJECT}_db-{kind}-replay2' for kind in ('data', 'config')],
            'copiedAt': '2026-09-14T07:50:29.691Z', 'purpose': 'synthetic fixture'}


class FakeDocker:
    def __init__(self, existing=False, running=False, dirty=False, options=None, fail_copy=False):
        self.calls = []
        self.volumes = clone.TARGETS[:1] if existing else []
        self.running, self.dirty, self.options, self.fail_copy = running, dirty, options, fail_copy

    def __call__(self, args):
        self.calls.append(args)
        if args[:2] == ['image', 'inspect']:
            return json.dumps({'Id': clone.IMAGE, 'RepoTags': ['supabase/postgres:17.6.1.136']})
        if args[0] == 'info':
            return 'synthetic-daemon'
        if args[:2] == ['volume', 'ls']:
            return '\n'.join(self.volumes)
        if args[:2] == ['volume', 'inspect']:
            return json.dumps([{'Name': args[2], 'Driver': 'local', 'Scope': 'local', 'Options': self.options}])
        if args[0] == 'container':
            return 'running' if self.running else ''
        if args[:2] == ['volume', 'create']:
            self.volumes.append(args[-1])
            return args[-1]
        if '--entrypoint=/usr/lib/postgresql/bin/pg_controldata' in args:
            return 'Database cluster state: ' + ('in production' if self.dirty else 'shut down') + '\nDatabase system identifier: 7685292944002592802\n'
        if self.fail_copy:
            raise RuntimeError('synthetic failure')
        return ''


class CloneTests(unittest.TestCase):
    def test_pinned_image_control_path_is_not_distribution_versioned_path(self):
        fake = FakeDocker()
        clone.clone(receipt(), fake)
        control = next(args for args in fake.calls if any('pg_controldata' in arg for arg in args))
        self.assertIn('--entrypoint=/usr/lib/postgresql/bin/pg_controldata', control)
        self.assertNotIn('--entrypoint=/usr/lib/postgresql/17/bin/pg_controldata', control)
        self.assertIn(clone.IMAGE, control)
        self.assertEqual(control[-1], '/source')

    def test_command_failures_report_only_static_stage_without_payload(self):
        cases = [
            (lambda args: args[:2] == ['image', 'inspect'], 'image-inspection'),
            (lambda args: '--entrypoint=/usr/lib/postgresql/bin/pg_controldata' in args, 'control-data-command'),
            (lambda args: args[:2] == ['volume', 'create'], 'data-volume-create'),
            (lambda args: '--entrypoint=/bin/sh' in args, 'data-copy'),
        ]
        for predicate, stage in cases:
            fake = FakeDocker()

            def run(args):
                if predicate(args):
                    raise RuntimeError('SENSITIVE stderr /secret/path customer payload')
                return fake(args)

            with self.subTest(stage=stage), self.assertRaises(clone.CloneFailure) as caught:
                clone.clone(receipt(), run)
            diagnostic = clone.failure_receipt(caught.exception)
            self.assertEqual(diagnostic['stage'], stage)
            self.assertFalse(diagnostic['automaticRetryAllowed'])
            self.assertNotIn('SENSITIVE', json.dumps(diagnostic))
            self.assertNotIn('/secret', str(caught.exception))

    def test_validation_failures_are_distinct_from_command_failures(self):
        for fake, stage in [(FakeDocker(existing=True), 'destination-preflight'),
                            (FakeDocker(running=True), 'mount-preflight'),
                            (FakeDocker(dirty=True), 'control-data-validation')]:
            with self.subTest(stage=stage), self.assertRaises(clone.CloneFailure) as caught:
                clone.clone(receipt(), fake)
            self.assertEqual(caught.exception.stage, stage)

    def test_failure_receipt_records_stage_without_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'synthetic.json'
            output = Path(directory) / 'result.json'
            source.write_text(json.dumps(receipt()))
            arguments = ['clone', '--execute-reviewed-local', '--checkpoint-receipt', str(source), '--output-receipt', str(output)]
            with patch.object(sys, 'argv', arguments), patch.object(clone, 'clone', side_effect=clone.CloneFailure('control-data-command')) as execute:
                with self.assertRaises(clone.CloneFailure):
                    clone.main()
                self.assertEqual(execute.call_count, 1)
            self.assertEqual(json.loads(output.read_text())['stage'], 'control-data-command')
            with patch.object(sys, 'argv', arguments), patch.object(clone, 'clone') as execute:
                with self.assertRaises(clone.CloneFailure) as caught:
                    clone.main()
                self.assertEqual(caught.exception.stage, 'output-receipt-create')
                execute.assert_not_called()

    def test_private_clone_commands_and_receipt(self):
        fake = FakeDocker()
        result = clone.clone(receipt(), fake)
        self.assertEqual(result['status'], 'cloned-not-started')
        self.assertEqual(result['destinationVolumes'], clone.TARGETS)
        runs = [args for args in fake.calls if args[0] == 'run']
        self.assertEqual(len(runs), 3)
        for args in runs:
            for flag in ['--network=none', '--read-only', '--cap-drop=ALL', '--pull=never', '--log-driver=none', clone.IMAGE]:
                self.assertIn(flag, args)
            self.assertTrue(any('target=/source,readonly,volume-nocopy' in arg for arg in args))
            self.assertNotIn('--privileged', args)
        creates = [args for args in fake.calls if args[:2] == ['volume', 'create']]
        self.assertEqual(len(creates), 2)
        self.assertIn(f'com.docker.compose.project={clone.PROJECT}', creates[0])
        self.assertIn('com.docker.compose.volume=db-data', creates[0])
        self.assertIn('com.docker.compose.volume=db-config', creates[1])

    def test_preflight_rejections_never_create_destinations(self):
        for fake in [FakeDocker(existing=True), FakeDocker(running=True), FakeDocker(dirty=True), FakeDocker(options={'device': '/host'})]:
            with self.subTest(fake=fake), self.assertRaises(ValueError):
                clone.clone(receipt(), fake)
            self.assertFalse(any(args[:2] == ['volume', 'create'] for args in fake.calls))

    def test_bad_receipt_never_contacts_docker(self):
        for change in [{'databaseStoppedCleanly': False}, {'checkpointVolumes': clone.TARGETS}, {'systemIdentifier': '1'}]:
            fake = FakeDocker()
            with self.assertRaises(ValueError):
                clone.clone({**receipt(), **change}, fake)
            self.assertEqual(fake.calls, [])

    def test_copy_failure_retains_partial_volume_and_never_starts_database(self):
        fake = FakeDocker(fail_copy=True)
        with self.assertRaises(RuntimeError):
            clone.clone(receipt(), fake)
        self.assertEqual(fake.volumes, clone.TARGETS[:1])
        self.assertFalse(any('rm' == arg or 'start' == arg for args in fake.calls for arg in args))


if __name__ == '__main__':
    unittest.main()
