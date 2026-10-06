import json
from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).parent))
from owner_io import Refused
from owner_runtime import DockerRuntime, runtime


class FakeDocker:
    def __init__(self):
        self.environment = ['PATH=/usr/local/bin:/usr/bin:/bin']
        self.old_id = '1' * 64
        self.new_id = '2' * 64
        self.values = {}
        self.calls = []
        self.fail_start = False
        self.non_graceful = False
        self.inject_foreign = False
        self.failed_check = False
        self.unverified_check = False
        self.after_rename = lambda identifier, name: None
        self.after_start = lambda identifier: None
        self.add(runtime.CONTAINER, self.old_id, '/opt/baci-prefunded-replay', 'c' * 64, False, True)

    def add(self, name, identifier, directory, label, check, running=False):
        value = runtime.expected_container(directory, label, check)
        value.update(Id=identifier, Name='/' + name, State={'Running': running, 'ExitCode': 0, 'OOMKilled': False})
        value['Config']['Env'] = self.environment[:]
        value['HostConfig']['NetworkMode'] = runtime.NETWORKS[0]
        self.values[identifier] = value

    def run(self, arguments, timeout=30):
        self.calls.append(arguments)
        operation = arguments[2]
        if operation == 'image':
            return json.dumps([{'Id': runtime.IMAGE, 'Config': {'Env': self.environment}}])
        if operation == 'container':
            name = next(value for value in arguments if value.startswith('--filter=')).removeprefix('--filter=name=^/').removesuffix('$')
            return '\n'.join(identifier for identifier, row in self.values.items() if row['Name'] == '/' + name)
        if operation == 'inspect':
            return json.dumps([self.values[arguments[3]]])
        if operation == 'create':
            name = next(value.removeprefix('--name=') for value in arguments if value.startswith('--name='))
            label = next(value.split('=', 2)[2] for value in arguments if value.startswith('--label='))
            directory = next(value.split('src=')[1].split('/code,')[0] for value in arguments if 'dst=/opt/pvb-replay' in value)
            identifier = ('3' * 64) if '--check' in arguments else self.new_id
            self.add(name, identifier, directory, label, '--check' in arguments)
            return identifier
        if operation == 'network':
            return ''
        if operation == 'rename':
            self.values[arguments[3]]['Name'] = '/' + arguments[4]
            self.after_rename(arguments[3], arguments[4])
            return ''
        identifier = arguments[-1]
        value = self.values[identifier]
        if operation == 'stop':
            value['State']['Running'] = False
            value['State']['ExitCode'] = 137 if self.non_graceful else 0
        if operation == 'start':
            if identifier == self.new_id and self.fail_start:
                if self.inject_foreign:
                    value['Config']['Env'].append('UNREVIEWED=1')
                raise Refused('synthetic_start_failure')
            value['State']['Running'] = True
            self.after_start(identifier)
        if operation == 'wait':
            value['State']['Running'] = False
            if self.failed_check:
                value['State']['ExitCode'] = 1
                if self.unverified_check:
                    value['Config']['Env'].append('UNREVIEWED=1')
                return '1'
            return '0'
        if operation == 'logs':
            return '{"status":"replay-runtime-ready","readOnly":true}\n'
        if operation == 'rm':
            del self.values[identifier]
        return ''


class RuntimeTest(unittest.TestCase):
    def fixture(self):
        docker = FakeDocker()
        operator = DockerRuntime(docker.run, lambda: None)
        return docker, operator

    def test_stage_check_does_not_stop_original_or_start_live_replacement(self):
        docker, operator = self.fixture()
        operator.check('/opt/new-generation', 'a' * 64)
        self.assertTrue(docker.values[docker.old_id]['State']['Running'])
        self.assertNotIn(docker.new_id, docker.values)
        self.assertFalse(any(call[2] == 'stop' for call in docker.calls))

    def test_apply_stops_before_retaining_and_creating_original_name(self):
        docker, operator = self.fixture()
        operator.swap('/opt/baci-prefunded-replay', 'c' * 64, '/opt/new-generation', 'a' * 64, lambda: None)
        operations = [call[2] for call in docker.calls]
        self.assertLess(operations.index('stop'), operations.index('rename'))
        self.assertLess(operations.index('rename'), operations.index('create'))
        self.assertEqual(docker.values[docker.new_id]['Name'], '/' + runtime.CONTAINER)
        self.assertFalse(docker.values[docker.old_id]['State']['Running'])
        self.assertTrue(docker.values[docker.new_id]['State']['Running'])

    def test_failed_verified_replacement_is_retained_before_restoring_old(self):
        docker, operator = self.fixture()
        docker.fail_start = True
        with self.assertRaises(Refused):
            operator.swap('/opt/baci-prefunded-replay', 'c' * 64, '/opt/new-generation', 'a' * 64, lambda: None)
        self.assertEqual(docker.values[docker.old_id]['Name'], '/' + runtime.CONTAINER)
        self.assertTrue(docker.values[docker.old_id]['State']['Running'])
        self.assertFalse(docker.values[docker.new_id]['State']['Running'])
        self.assertFalse(any(call[2] == 'rm' and call[-1] == docker.old_id for call in docker.calls))

    def test_unverified_replacement_blocks_automatic_restore(self):
        docker, operator = self.fixture()
        docker.fail_start = docker.inject_foreign = True
        with self.assertRaisesRegex(Refused, 'manual_recovery_required'):
            operator.swap('/opt/baci-prefunded-replay', 'c' * 64, '/opt/new-generation', 'a' * 64, lambda: None)
        self.assertFalse(docker.values[docker.old_id]['State']['Running'])

    def test_non_graceful_quiescence_never_creates_replacement(self):
        docker, operator = self.fixture()
        docker.non_graceful = True
        with self.assertRaises(Refused):
            operator.swap('/opt/baci-prefunded-replay', 'c' * 64, '/opt/new-generation', 'a' * 64, lambda: None)
        self.assertNotIn(docker.new_id, docker.values)

    def test_stopped_original_is_retained_and_replacement_remains_stopped(self):
        docker, operator = self.fixture()
        docker.values[docker.old_id]['State'].update(Running=False, ExitCode=143)
        operator.swap('/opt/baci-prefunded-replay', 'c' * 64, '/opt/new-generation', 'a' * 64,
                      lambda: None, expected_original=(docker.old_id, False))
        self.assertFalse(docker.values[docker.new_id]['State']['Running'])
        self.assertFalse(any(call[2] in ('start', 'stop') for call in docker.calls))

    def test_original_state_change_since_preflight_is_fenced_before_stop(self):
        docker, operator = self.fixture()
        with self.assertRaisesRegex(Refused, 'observed_state_changed'):
            operator.swap('/opt/baci-prefunded-replay', 'c' * 64, '/opt/new-generation', 'a' * 64,
                          lambda: None, expected_original=(docker.old_id, False))
        self.assertFalse(any(call[2] == 'stop' for call in docker.calls))

    def test_verified_stopped_failed_disposable_check_is_removed_and_same_generation_can_retry(self):
        docker, operator = self.fixture()
        docker.failed_check = True
        with self.assertRaisesRegex(Refused, 'read_only_check_refused'):
            operator.check('/opt/new-generation', 'a' * 64)
        self.assertNotIn('3' * 64, docker.values)
        self.assertTrue(docker.values[docker.old_id]['State']['Running'])
        docker.failed_check = False
        operator.check('/opt/new-generation', 'a' * 64)
        self.assertNotIn('3' * 64, docker.values)
        self.assertFalse(any(call[2] == 'rm' and call[-1] == docker.old_id for call in docker.calls))

    def test_unverified_failed_disposable_check_is_retained_and_never_removed(self):
        docker, operator = self.fixture()
        docker.failed_check = docker.unverified_check = True
        with self.assertRaises(Refused):
            operator.check('/opt/new-generation', 'a' * 64)
        self.assertIn('3' * 64, docker.values)
        self.assertFalse(any(call[2] == 'rm' for call in docker.calls))

    def expiring_fixture(self):
        docker, operator = self.fixture()
        clock = {'expired': False}
        def deadline():
            if clock['expired']:
                raise Refused('synthetic_deadline_expired')
        operator.deadline = deadline
        return docker, operator, clock

    def test_expiry_during_predecessor_recheck_never_starts_replacement_or_recovery(self):
        docker, operator, clock = self.expiring_fixture()
        checks = []
        def verify():
            checks.append(True)
            if len(checks) == 3:
                clock['expired'] = True
        with self.assertRaisesRegex(Refused, 'manual_recovery_required'):
            operator.swap('/opt/baci-prefunded-replay', 'c' * 64, '/opt/new-generation', 'a' * 64, verify)
        self.assertFalse(any(call[2] == 'start' for call in docker.calls))
        self.assertFalse(docker.values[docker.old_id]['State']['Running'])

    def test_expiry_during_restore_rename_never_restarts_old(self):
        docker, operator, clock = self.expiring_fixture()
        retained = runtime.CONTAINER + '-prior-' + docker.old_id[:12]
        docker.values[docker.old_id]['Name'] = '/' + retained
        docker.values[docker.old_id]['State']['Running'] = False
        docker.after_rename = lambda identifier, name: clock.update(expired=True)
        with self.assertRaisesRegex(Refused, 'synthetic_deadline_expired'):
            operator.restore(docker.old_id, retained, '/opt/baci-prefunded-replay', 'c' * 64,
                             None, '/opt/new-generation', 'a' * 64, True)
        self.assertFalse(any(call[2] == 'start' for call in docker.calls))
        self.assertFalse(docker.values[docker.old_id]['State']['Running'])

    def test_expiry_immediately_after_recovery_start_stops_old(self):
        docker, operator, clock = self.expiring_fixture()
        retained = runtime.CONTAINER + '-prior-' + docker.old_id[:12]
        docker.values[docker.old_id]['Name'] = '/' + retained
        docker.values[docker.old_id]['State']['Running'] = False
        docker.after_start = lambda identifier: clock.update(expired=True)
        with self.assertRaisesRegex(Refused, 'expired_or_invalid_start_stopped'):
            operator.restore(docker.old_id, retained, '/opt/baci-prefunded-replay', 'c' * 64,
                             None, '/opt/new-generation', 'a' * 64, True)
        self.assertFalse(docker.values[docker.old_id]['State']['Running'])
        self.assertTrue(any(call[2] == 'stop' and call[-1] == docker.old_id for call in docker.calls))

    def test_expiry_immediately_after_replacement_start_stops_new_and_never_restarts_old(self):
        docker, operator, clock = self.expiring_fixture()
        docker.after_start = lambda identifier: clock.update(expired=True)
        with self.assertRaisesRegex(Refused, 'manual_recovery_required'):
            operator.swap('/opt/baci-prefunded-replay', 'c' * 64, '/opt/new-generation', 'a' * 64, lambda: None)
        self.assertFalse(docker.values[docker.new_id]['State']['Running'])
        self.assertFalse(docker.values[docker.old_id]['State']['Running'])
        self.assertEqual([call[-1] for call in docker.calls if call[2] == 'start'], [docker.new_id])

    def test_expiry_after_read_only_check_start_stops_and_removes_only_verified_disposable(self):
        docker, operator, clock = self.expiring_fixture()
        docker.after_start = lambda identifier: clock.update(expired=True)
        with self.assertRaisesRegex(Refused, 'read_only_check_refused'):
            operator.check('/opt/new-generation', 'a' * 64)
        self.assertNotIn('3' * 64, docker.values)
        self.assertTrue(docker.values[docker.old_id]['State']['Running'])


if __name__ == '__main__':
    unittest.main()
