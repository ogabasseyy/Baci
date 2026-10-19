import ast
import hashlib
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from constants import BINDING_SHA, DEADLINE, GRAPH, OLD_SHA, SERVICE
from owner import GatewayRecovery, HERE


class Tests(unittest.TestCase):
    def test_observed_root_abi_omits_environment_files_only_with_exact_sealed_unit_and_closed_properties(self):
        fields = {
            'LoadState': 'loaded', 'ActiveState': 'failed', 'SubState': 'failed', 'MainPID': '0',
            'InvocationID': '', 'FragmentPath': '/etc/systemd/system/' + SERVICE, 'DropInPaths': '',
            'NeedDaemonReload': 'no', 'User': 'baci-savings-gateway', 'Group': 'baci-savings-ingress',
            'Restart': 'no', 'Environment': '',
            'ExecStart': '{ path=/usr/bin/node ; argv[]=/usr/bin/node /opt/baci-savings-gateway/managed-gateway-cli.mjs --managed ; }',
        }
        recovery = GatewayRecovery.__new__(GatewayRecovery)
        recovery.files = Mock()
        unit = (Path(__file__).parents[2] / 'isolated-savings' / 'baci-savings-gateway.service').read_bytes()
        unit_sha = '8539934f7d9a499e93158388843097cda7c31a398c22df4d8e9a0400170a0bf3'
        self.assertEqual(hashlib.sha256(unit).hexdigest(), unit_sha)
        self.assertNotRegex(unit.decode(), r'(?m)^\s*(Environment|EnvironmentFile|PassEnvironment|UnsetEnvironment)\s*=')
        recovery.files.read.return_value = (unit, ())
        recovery.run = Mock(return_value='\n'.join(name + '=' + value for name, value in fields.items()).encode())
        self.assertEqual(recovery.state(), fields)
        self.assertIn('--all', recovery.run.call_args.args[0])
        recovery.files.read.assert_called_once_with(Path('/etc/systemd/system/' + SERVICE), (0o644,), (0,), unit_sha)
        empty_files = {**fields, 'EnvironmentFiles': ''}
        recovery.run.return_value = '\n'.join(name + '=' + value for name, value in empty_files.items()).encode()
        self.assertEqual(recovery.state(), empty_files)
        for name, value in (('Environment', 'UNREVIEWED=1'), ('EnvironmentFiles', '/tmp/unreviewed (ignore_errors=no)'),
                            ('EnvironmentFile', ''), ('PassEnvironment', 'UNREVIEWED'), ('UnsetEnvironment', 'UNREVIEWED'),
                            ('DropInPaths', '/etc/systemd/system/override.conf'), ('NeedDaemonReload', 'yes'),
                            ('LoadState', 'not-found'), ('FragmentPath', '/tmp/gateway.service')):
            changed = {**fields, name: value}
            recovery.run.return_value = '\n'.join(key + '=' + content for key, content in changed.items()).encode()
            with self.assertRaisesRegex(ValueError, 'effective_gateway_unit'):
                recovery.state()
        recovery.run.return_value = '\n'.join(name + '=' + value for name, value in fields.items()
                                              if name != 'Environment').encode()
        with self.assertRaisesRegex(ValueError, 'effective_gateway_unit'):
            recovery.state()
        recovery.run.return_value = '\n'.join(name + '=' + value for name, value in fields.items()).encode()
        for failure in ('protected_pin', 'protected_file_metadata', 'protected_read_race'):
            recovery.files.read.side_effect = ValueError(failure)
            with self.assertRaisesRegex(ValueError, failure):
                recovery.state()

    def test_systemctl_read_allowlist_requires_all_without_widening_commands(self):
        recovery = GatewayRecovery.__new__(GatewayRecovery)
        arguments = ['/usr/bin/systemctl', 'show', SERVICE, '--all', '--property=Environment,EnvironmentFiles']
        with patch('owner.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout=b'')) as execute:
            self.assertEqual(recovery.run(arguments), b'')
            execute.assert_called_once()
            for changed in (arguments[:3] + arguments[4:], [*arguments, '--value']):
                with self.assertRaisesRegex(ValueError, 'command_scope'):
                    recovery.run(changed)
            execute.assert_called_once()

    def test_non_root_local_execution_refuses_before_probes_or_writes(self):
        with self.assertRaisesRegex(ValueError, 'root_private_bundle_required'):
            GatewayRecovery('0' * 64)

    def test_backup_directory_parent_is_synced_before_any_backup_writes(self):
        recovery = GatewayRecovery.__new__(GatewayRecovery)
        recovery.old = b'authentic original evidence'
        recovery.old_info = ('original fingerprint',)
        recovery.preserved = {}
        recovery.files = Mock()
        recovery.files.read.return_value = (recovery.old, recovery.old_info)
        actions = Mock()
        actions.attach_mock(recovery.files.sync, 'sync')
        actions.attach_mock(recovery.files.write, 'write')
        with patch('owner.Path.mkdir') as mkdir:
            actions.attach_mock(mkdir, 'mkdir')
            recovery.backup(b'fresh verified evidence')
            self.assertEqual([action[0] for action in actions.mock_calls],
                             ['mkdir', 'sync', 'write', 'write', 'write'])
            mkdir.assert_called_once_with(mode=0o700)
            recovery.files.sync.assert_called_once_with(HERE)
            recovery.files.write.reset_mock()
            recovery.files.sync.side_effect = OSError('parent directory sync failed')
            with self.assertRaisesRegex(OSError, 'parent directory sync failed'):
                recovery.backup(b'fresh verified evidence')
            recovery.files.write.assert_not_called()

    def test_loaded_gateway_graph_matches_canonical_without_replacing_parent_pins_for_unused_wrappers(self):
        root = Path(__file__).parents[2] / 'isolated-savings'
        self.assertEqual(len(GRAPH), 11)
        for name, expected in GRAPH.items():
            if name in ('managed-hosted-draft-renewal-runner.mjs', 'managed-private-smoke-runner.mjs'):
                continue
            self.assertEqual(hashlib.sha256((root / name).read_bytes()).hexdigest(), expected, name)
        self.assertEqual(GRAPH['managed-private-smoke-runner.mjs'],
                         '1deeaaf1d88291d53a720c5666429a8cb6e7983bf534705f1666a1351f3efacf')

    def test_exact_parent_supplied_binding_evidence_and_deadline_are_not_configurable(self):
        self.assertEqual(BINDING_SHA, '9a917935bf088ee20cddc0179f680c9afc62349bae736f48e6a5d48c85a62ae5')
        self.assertEqual(OLD_SHA, 'c1ad9ba021842fc876094af62f9dd6f463de2d7aeb83337eaa821c3ae59f5ae4')
        self.assertEqual(DEADLINE, '2026-10-06T15:59:10.442Z')
        self.assertEqual(SERVICE, 'baci-savings-gateway.service')

    def test_owner_default_is_preflight_and_apply_requires_an_explicit_flag(self):
        source = (Path(__file__).parent / 'owner.py').read_text()
        parsed = ast.parse(source)
        flags = [node for node in ast.walk(parsed) if isinstance(node, ast.Call)
                 and isinstance(node.func, ast.Attribute) and node.func.attr == 'add_argument']
        apply = [node for node in flags if node.args and isinstance(node.args[0], ast.Constant)
                 and node.args[0].value == '--apply']
        self.assertEqual(len(apply), 1)
        self.assertTrue(any(keyword.arg == 'action' and keyword.value.value == 'store_true'
                            for keyword in apply[0].keywords))


if __name__ == '__main__':
    unittest.main()
