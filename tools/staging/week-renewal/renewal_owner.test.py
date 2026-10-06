import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

import renewal_contract as contract
import renewal_owner as owner
import renewal_io as secure_io


SPEC = importlib.util.spec_from_file_location('contract_fixture', Path(__file__).with_name('renewal_contract.test.py'))
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.values = FIXTURE.fixture()
        self.files = {}
        for position, (path, content) in enumerate(self.values.items()):
            target = self.root / ('source-' + str(position))
            target.write_bytes(content)
            target.chmod(0o600)
            self.files[path] = target
        self.pins = {path: contract.digest(content) for path, content in self.values.items()}
        for module in (owner, contract):
            handle = patch.object(module, 'PINS', self.pins)
            handle.start()
            self.addCleanup(handle.stop)
        self.states = {'protected-runtime': 'stopped', 'funding-runtime': 'active-expired'}

    def read(self, path, modes, groups, expected):
        return secure_io.read_verified(self.files[path], (0o600,), (os.getegid(),), expected, owner=os.geteuid())

    def unchanged(self, path, previous):
        return secure_io.unchanged(self.files[path], previous)

    def prepare(self, states=None):
        with patch.object(owner, 'read_verified', side_effect=self.read), patch.object(owner, 'unchanged', side_effect=self.unchanged), \
                patch.object(secure_io, 'trusted_parents'), patch.object(secure_io, 'private_directory'), \
                patch.object(owner, 'boundary_states', side_effect=states or [self.states, self.states]):
            return owner.prepare_locked(self.root, ('a' * 64, {'replayJwtExpiryUnverified': [contract.OLD_EPOCH]}),
                                        1234, 1235, FIXTURE.NOW)

    def test_prepares_only_private_candidates_preserving_original_sources_and_stale_evidence(self):
        output, receipt = self.prepare()
        value = contract.parse_json(receipt)
        self.assertFalse(value['activationReady'])
        self.assertFalse(value['renewalApplied'])
        self.assertFalse(value['liveChangesMade'])
        self.assertFalse(value['startupEvidenceGenerated'])
        self.assertFalse(value['newPaymentStarted'])
        self.assertEqual(value['requestedGatewayDeadline'], '2026-10-06T15:59:10.442Z')
        self.assertEqual(value['requestedServiceDeadline'], '2026-10-06T15:59:10Z')
        self.assertEqual(value['status'], 'prepared-review-required')
        self.assertNotIn(b'never-print-secret', receipt)
        for record in value['sources']:
            self.assertEqual((output / 'original' / record['backup']).read_bytes(), self.values[record['path']])
            self.assertEqual(self.files[record['path']].read_bytes(), self.values[record['path']])
        self.assertFalse((output / 'candidate/startup-evidence.json').exists())
        self.assertEqual(len(list((output / 'candidate').iterdir())), 6)
        self.assertEqual((output / 'candidate/funding-service.env').stat().st_mode & 0o777, 0o600)

    def test_pin_and_metadata_assertions_precede_all_backup_writes(self):
        for failure in ('pin', 'metadata'):
            target = self.files[contract.UNIT_DIRECTORY + 'baci-savings-funding.service']
            if failure == 'pin':
                target.write_bytes(b'unreviewed-secret')
            else:
                target.write_bytes(self.values[contract.UNIT_DIRECTORY + 'baci-savings-funding.service'])
                target.chmod(0o660)
            with patch.object(owner, 'publish_preparation') as publish:
                with self.assertRaises(contract.Refused):
                    self.prepare()
            publish.assert_not_called()
            self.assertFalse((self.root / 'lane-a-preparation.pending').exists())

    def test_protected_running_runtime_refuses_before_backup_writes(self):
        with patch.object(owner, 'publish_preparation') as publish:
            with self.assertRaises(contract.Refused):
                self.prepare(states=Mock(side_effect=contract.Refused('protected-b-runtime-not-stopped')))
        publish.assert_not_called()

    def test_runtime_race_fails_closed_and_retains_preparation_without_install(self):
        with self.assertRaisesRegex(contract.Refused, 'runtime-state-changed'):
            self.prepare(states=[self.states, {'protected-runtime': 'running'}])
        self.assertTrue((self.root / 'lane-a-preparation/receipt.json').exists())
        for path, target in self.files.items():
            self.assertEqual(target.read_bytes(), self.values[path])

    def test_collision_retry_refuses_without_overwriting_existing_backup(self):
        output, receipt = self.prepare()
        with self.assertRaisesRegex(contract.Refused, 'existing-preparation-retained'):
            self.prepare()
        self.assertEqual((output / 'receipt.json').read_bytes(), receipt)

    def test_no_activation_command_and_secret_exception_is_never_printed(self):
        for arguments in (['renewal_owner.py'], ['renewal_owner.py', '--prepare', '--bundle-sha256', 'a' * 64]):
            buffer = io.StringIO()
            with patch.object(owner.sys, 'argv', arguments), patch.object(owner, 'prepare', side_effect=RuntimeError('never-print-secret')), \
                    patch('sys.stdout', buffer):
                status = owner.main()
            self.assertNotEqual(status, 0)
            self.assertNotIn('never-print-secret', buffer.getvalue())
            result = json.loads(buffer.getvalue())
            self.assertFalse(result['renewalApplied'])
            self.assertFalse(result['databaseApplied'])

    def test_refusal_reports_the_failed_check_without_printing_config_or_exception_text(self):
        buffer = io.StringIO()
        with patch.object(owner.sys, 'argv', ['renewal_owner.py', '--prepare', '--bundle-sha256', 'a' * 64]), \
                patch.object(owner, 'prepare', side_effect=contract.Refused('source-pin')), patch('sys.stdout', buffer):
            status = owner.main()
        self.assertEqual(status, 1)
        self.assertEqual(json.loads(buffer.getvalue())['reasonCode'], 'source-pin')

    def test_diagnostic_reuses_checks_without_creating_lock_backup_or_candidate_files(self):
        buffer = io.StringIO()
        context = (('a' * 64, {}), 1234, 1235)
        with patch.object(owner, 'verified_context', return_value=context), \
                patch.object(owner, 'checked_candidates', return_value=(self.values, {}, {})), \
                patch.object(owner, 'boundary_states', side_effect=[self.states, self.states]), \
                patch.object(owner, 'publish_preparation') as publish, patch.object(owner.os, 'open') as open_file, \
                patch('sys.stdout', buffer):
            result = owner.diagnose(self.root, 'a' * 64)
        self.assertEqual(result['status'], 'checks-passed')
        self.assertTrue(result['readOnly'])
        self.assertFalse(result['renewalApplied'])
        publish.assert_not_called()
        open_file.assert_not_called()
        self.assertEqual(list(self.root.glob('lane-a-preparation*')), [])

    def test_diagnostic_cli_never_dispatches_preparation(self):
        buffer = io.StringIO()
        with patch.object(owner.sys, 'argv', ['renewal_owner.py', '--diagnose', '--bundle-sha256', 'a' * 64]), \
                patch.object(owner, 'diagnose', return_value={'readOnly': True, 'status': 'checks-passed'}) as diagnose, \
                patch.object(owner, 'prepare') as prepare, patch('sys.stdout', buffer):
            status = owner.main()
        self.assertEqual(status, 0)
        diagnose.assert_called_once()
        prepare.assert_not_called()

    def test_composed_diagnostic_only_opens_sources_readonly_and_preserves_every_byte(self):
        real_open = os.open
        def readonly_open(path, flags, *arguments):
            self.assertEqual(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC), 0)
            return real_open(path, flags, *arguments)
        with patch.object(owner, 'verified_context', return_value=(('a' * 64, {}), 1234, 1235)), \
                patch.object(owner, 'read_verified', side_effect=self.read), patch.object(owner, 'unchanged', side_effect=self.unchanged), \
                patch.object(secure_io, 'trusted_parents'), patch.object(owner, 'boundary_states', side_effect=[self.states, self.states]), \
                patch.object(owner.time, 'time_ns', return_value=FIXTURE.NOW * 1000000), \
                patch.object(owner.os, 'open', side_effect=readonly_open), patch.object(owner, 'publish_preparation') as publish:
            result = owner.diagnose(self.root, 'a' * 64)
        self.assertTrue(result['readOnly'])
        publish.assert_not_called()
        for path, target in self.files.items():
            self.assertEqual(target.read_bytes(), self.values[path])
        self.assertFalse((self.root / 'prepare.lock').exists())


class BoundaryTests(unittest.TestCase):
    def command(self, arguments, active=None, dropin=False, restarting=False):
        if arguments[0] == '/usr/bin/docker':
            return '"/' + arguments[-1] + '" false ' + ('true' if restarting else 'false') + ' {"Name":"no","MaximumRetryCount":0}\n'
        unit = arguments[2]
        protected = unit in contract.PROTECTED_SERVICES + contract.PROTECTED_TIMERS
        state = 'inactive' if protected else 'active'
        if unit in ('baci-savings-gateway.service', 'baci-savings-drafts.service'):
            state = 'failed'
        if active == unit:
            state = 'active'
        value = {'LoadState': 'loaded', 'ActiveState': state, 'SubState': 'dead', 'MainPID': '0',
                 'FragmentPath': contract.UNIT_DIRECTORY + unit, 'DropInPaths': '/unreviewed' if dropin else '',
                 'NeedDaemonReload': 'no', 'UnitFileState': 'static'}
        if unit.endswith('.timer'):
            value.pop('MainPID')
        return '\n'.join(key + '=' + item for key, item in value.items())

    def test_known_stopped_b_and_failed_expired_a_allow_preparation_only(self):
        with patch.object(owner, 'readonly_command', side_effect=self.command):
            value = owner.boundary_states()
        self.assertEqual(value['baci-prefunded-public']['restartPolicy'], 'no')
        self.assertEqual(value['baci-savings-funding.service']['ActiveState'], 'active')
        self.assertNotIn('MainPID', value['baci-savings-drafts-deadline.timer'])

    def test_timer_without_mainpid_allows_composed_private_preparation(self):
        with tempfile.TemporaryDirectory() as temporary:
            values = FIXTURE.fixture()
            pins = {path: contract.digest(content) for path, content in values.items()}
            metadata = Path(temporary).stat()
            def read(path, modes, groups, expected):
                self.assertEqual(contract.digest(values[path]), expected)
                return values[path], metadata
            with patch.object(owner, 'PINS', pins), patch.object(contract, 'PINS', pins), \
                    patch.object(owner, 'read_verified', side_effect=read), patch.object(owner, 'unchanged'), \
                    patch.object(owner, 'readonly_command', side_effect=self.command), patch.object(secure_io, 'private_directory'):
                output, receipt = owner.prepare_locked(Path(temporary), ('a' * 64, {}), 1234, 1235, FIXTURE.NOW)
            self.assertTrue((output / 'receipt.json').is_file())
            self.assertNotIn('MainPID', contract.parse_json(receipt)['observedStates']['baci-prefunded-background.timer'])

    def test_service_without_mainpid_or_timer_with_unexpected_field_refuses(self):
        for name, remove in (('baci-savings-drafts.service', True), ('baci-savings-drafts-deadline.timer', False)):
            def command(arguments):
                content = self.command(arguments)
                if arguments[2] == name:
                    return content.replace('MainPID=0\n', '') if remove else content + '\nMainPID=0'
                return content
            with patch.object(owner, 'readonly_command', side_effect=command):
                with self.assertRaises(contract.Refused):
                    owner.boundary_states()

    def test_live_b_service_timer_dropin_or_restarting_container_refuse(self):
        for options in ({'active': 'baci-prefunded-public.service'}, {'active': 'baci-prefunded-background.timer'},
                        {'dropin': True}, {'restarting': True}):
            with patch.object(owner, 'readonly_command', side_effect=lambda args: self.command(args, **options)):
                with self.assertRaises(contract.Refused):
                    owner.boundary_states()

    def test_command_runner_cannot_start_stop_modify_database_or_provider(self):
        for command in (['/usr/bin/systemctl', 'start', 'baci-savings-gateway.service'],
                        ['/usr/bin/docker', 'exec', 'postgres', 'psql'], ['curl', 'https://provider.invalid']):
            with patch.object(owner.subprocess, 'run') as run:
                with self.assertRaises(contract.Refused):
                    owner.readonly_command(command)
            run.assert_not_called()
        with patch.object(owner.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, b'', b'never-print-secret')):
            with self.assertRaisesRegex(contract.Refused, '^readonly-command-refused$'):
                owner.readonly_command(['/usr/bin/systemctl', 'show', 'unit'])


if __name__ == '__main__':
    unittest.main()
