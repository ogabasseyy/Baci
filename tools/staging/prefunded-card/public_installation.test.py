import copy
import hashlib
import json
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import Mock, patch

import public_installation as installation
import public_service_contract as contract
from treasury_owner_contract import DEADLINE_EPOCH, Refused


FIXTURE = runpy.run_path(str(Path(__file__).with_name('public_artifact.test.py')))['fixture']
IMAGE_ENV = ['PATH=/usr/local/bin:/usr/bin:/bin', 'NODE_VERSION=24.18.0']


class InstallationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'public'
        self.archive, manifest, _ = FIXTURE()
        self.manifest = json.dumps(manifest).encode()
        self.digest = hashlib.sha256(self.manifest).hexdigest()
        self.calls, self.observed = [], None
        self.inputs = {'archive': self.archive, 'manifest': self.manifest,
                       str(installation.ACTIVATION): b'protected', str(installation.FUNDING): b'funding'}
        patches = {
            'ROOT': self.root, 'capture': lambda name, *_args, **_kwargs: self.inputs[str(name)],
            'project_checkout': lambda *_args: b'checkout', 'project_anon': lambda *_args: b'anon',
            'command': self.command, 'verify_database': Mock(), 'prepare_tree': Mock(),
            'root_ancestors': Mock(), 'place': Mock(), 'matching': Mock(),
        }
        for name, replacement in patches.items():
            context = patch.object(installation, name, replacement)
            context.start()
            self.addCleanup(context.stop)
        self.installer = installation.PublicInstaller('archive', hashlib.sha256(self.archive).hexdigest(),
            'manifest', self.digest, clock=lambda: DEADLINE_EPOCH - 3600)

    def command(self, arguments, **_kwargs):
        self.calls.append(arguments)
        if arguments[2:4] == ['image', 'inspect']:
            return json.dumps([{'Id': contract.IMAGE, 'Config': {'Env': IMAGE_ENV}}])
        if arguments[2:4] == ['ps', '-aq']:
            return 'id' if self.observed is not None else ''
        if arguments[2:4] == ['network', 'inspect']:
            name = arguments[-1]
            return json.dumps([{'Name': name, 'Internal': name == contract.NETWORKS[0],
                'Labels': {'com.docker.compose.project': 'baci-isolated-savings'},
                'Containers': {'db': {'Name': 'baci-isolated-savings-db-1', 'IPv4Address': '172.23.0.2/16'}}}])
        if arguments[2:4] == ['inspect', 'baci-isolated-savings-auth-1']:
            return '[{}]'
        if arguments[2:4] == ['inspect', contract.NAME]:
            return json.dumps([self.observed])
        if arguments[2:3] == ['create']:
            self.observed = contract.container_contract(self.digest)
            self.observed['Config']['Env'] = IMAGE_ENV
            self.observed['State'] = {'Running': False, 'Status': 'created'}
            self.observed['NetworkSettings']['Networks'] = {contract.NETWORKS[0]: {}}
            return 'created'
        if arguments[2:4] == ['network', 'connect']:
            self.observed['NetworkSettings']['Networks'][contract.NETWORKS[1]] = {}
        if arguments[2:3] == ['run']:
            return json.dumps(installation.PRIVATE_PROOF)
        if arguments[:2] == ['/usr/bin/systemctl', 'show']:
            if '--property=ActiveState' in arguments:
                return 'active'
            return 'FragmentPath=\nDropInPaths=\nUnitFileState=\n'
        if arguments[:2] == ['/usr/bin/systemctl', 'start'] and arguments[-1] == contract.NAME + '.service':
            self.observed['State'] = {'Running': True, 'Status': 'running'}
        return ''

    def test_default_preparation_creates_only_stopped_exact_container(self):
        self.installer.prepare()
        self.assertFalse(self.observed['State']['Running'])
        self.assertFalse(any('start' in item or 'enable' in item or 'exec' in item for item in self.calls))
        installation.verify_database.assert_called_once()
        installation.prepare_tree.assert_called_once()
        self.assertEqual(self.installer.files['config/checkout.json'], b'checkout')
        self.assertEqual(self.installer.files['config/anon.json'], b'anon')
        self.assertNotIn(b'protected', b''.join(self.installer.files.values()))

    def test_start_arms_deadline_before_service_then_get_proof_only(self):
        self.installer.prepare()
        self.installer.private_proof()
        with patch.object(self.installer, 'probe_http') as probe:
            self.installer.start()
        starts = [item[-1] for item in self.calls if item[:2] == ['/usr/bin/systemctl', 'start']]
        self.assertEqual(starts, [contract.NAME + '-deadline.timer', contract.NAME + '.service'])
        probe.assert_called_once()
        self.assertFalse(any('enable' in item or 'restart' in item for item in self.calls))
        self.assertEqual(installation.verify_database.call_count, 3)

    def test_private_proof_is_bounded_unpublished_nonroot_and_required(self):
        self.installer.prepare()
        with self.assertRaises(Refused):
            self.installer.start()
        self.installer.private_proof()
        arguments = next(call for call in self.calls if call[2] == 'run')
        self.assertIn('--rm', arguments)
        self.assertIn('--user=65530:65530', arguments)
        self.assertIn('--read-only', arguments)
        self.assertIn('--log-driver=none', arguments)
        self.assertIn('--network=' + contract.NETWORKS[0], arguments)
        self.assertFalse(any(item.startswith(('--publish', '--env', '--name')) for item in arguments))
        self.assertIn('25000', arguments[-1])
        self.assertIn('/app/launch-public.cjs', arguments[-1])
        self.assertIn('--check', arguments[-1])
        self.assertTrue(self.installer.private_verified)

    def test_private_proof_failure_never_starts_http(self):
        self.installer.prepare()
        original = self.command

        def rejected(arguments, **options):
            return '{"status":"refused"}' if arguments[2] == 'run' else original(arguments, **options)

        with patch.object(installation, 'command', side_effect=rejected), self.assertRaises(Refused):
            self.installer.private_proof()
        self.assertFalse(self.installer.private_verified)
        self.assertFalse(self.installer.start_attempted)

    def test_existing_foreign_container_is_not_adopted_or_stopped(self):
        self.observed = contract.container_contract('f' * 64)
        self.observed['State'] = {'Running': True}
        self.observed['Config']['Env'] = IMAGE_ENV
        with self.assertRaises(Refused):
            self.installer.prepare()
        installation.prepare_tree.assert_not_called()
        self.assertFalse(self.installer.start_attempted)

    def test_exact_retry_does_not_create_rotate_or_restart(self):
        self.installer.prepare()
        previous = copy.deepcopy(self.observed)
        self.calls.clear()
        self.installer.prepare()
        self.assertEqual(self.observed, previous)
        self.assertFalse(any('create' in item or 'start' in item or 'stop' in item for item in self.calls))
        self.assertTrue(installation.prepare_tree.call_args.kwargs['verify_only'])

    def test_retry_refuses_config_drift_and_never_acts_on_foreign_container(self):
        self.installer.prepare()
        self.calls.clear()
        installation.prepare_tree.side_effect = Refused('fixture mismatch')
        with self.assertRaises(Refused):
            self.installer.prepare()
        self.assertFalse(any('create' in item or 'start' in item or 'stop' in item for item in self.calls))

    def test_expired_approval_has_no_reads_writes_or_commands(self):
        self.installer.clock = lambda: DEADLINE_EPOCH
        with self.assertRaises(Refused):
            self.installer.prepare()
        self.assertEqual(self.calls, [])
        installation.prepare_tree.assert_not_called()

    def test_withdraw_only_after_start_attempt_and_exact_owned_validation(self):
        self.installer.withdraw()
        self.assertEqual(self.calls, [])
        self.installer.prepare()
        self.installer.start_attempted = True
        self.calls.clear()
        self.installer.withdraw()
        self.assertEqual(self.calls[-2:], contract.rollback_commands())
        self.observed['Image'] = 'foreign'
        self.calls.clear()
        with self.assertRaises(Refused):
            self.installer.withdraw()
        self.assertFalse(any('stop' in item for item in self.calls))

    def test_http_probe_uses_only_local_get_without_auth_and_never_follows_redirect(self):
        self.installer.prepare()
        connection = Mock()
        responses = []
        for status in (401, 200, 200, 404):
            response = Mock(status=status)
            response.read.return_value = b'bounded'
            responses.append(response)
        connection.getresponse.side_effect = responses
        with patch.object(installation.http.client, 'HTTPConnection', return_value=connection) as factory:
            self.installer.probe_http()
        factory.assert_called_with('127.0.0.1', 4800, timeout=5)
        self.assertTrue(all(call.args[0] == 'GET' for call in connection.request.call_args_list))
        self.assertTrue(all('Authorization' not in call.kwargs['headers'] for call in connection.request.call_args_list))
        connection.getresponse.side_effect = None
        connection.getresponse.return_value = Mock(status=302)
        with patch.object(installation.http.client, 'HTTPConnection', return_value=connection):
            with self.assertRaises(Refused):
                self.installer.probe_http()


if __name__ == '__main__':
    unittest.main()
