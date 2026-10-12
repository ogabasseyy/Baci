import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import Mock, patch

import activation_contract as contract


specification = importlib.util.spec_from_file_location(
    'activation_retry', Path(__file__).with_name('activation_retry.py'))
retry = importlib.util.module_from_spec(specification)
specification.loader.exec_module(retry)


class RetryTests(unittest.TestCase):
    def test_database_guard_requires_exact_identity_and_both_authorities_absent(self):
        allowed = dict(system='7685292944002592802', functionExecute=False, schemaUsage=False)
        self.assertEqual(retry._database_guard(lambda _: json.dumps(allowed)), allowed)
        for state in (
                dict(system='other', functionExecute=False, schemaUsage=False),
                dict(system='7685292944002592802', functionExecute=True, schemaUsage=False),
                dict(system='7685292944002592802', functionExecute=False, schemaUsage=True)):
            with self.assertRaises(ValueError):
                retry._database_guard(lambda _, state=state: json.dumps(state))

    def test_private_file_check_rejects_hash_and_hard_link(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'private'
            path.write_bytes(b'pinned')
            path.chmod(0o600)
            metadata = path.lstat()
            mocked = SimpleNamespace(st_mode=metadata.st_mode, st_uid=0, st_nlink=1)
            digest = hashlib.sha256(b'pinned').hexdigest()
            with patch.object(retry, '_root_path'), patch.object(retry.Path, 'lstat', return_value=mocked):
                retry._private_file(path, 0o600, digest)
                with self.assertRaisesRegex(ValueError, 'private-file-pin'):
                    retry._private_file(path, 0o600, '0' * 64)
                hard_link = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0, st_nlink=2)
                with self.assertRaisesRegex(ValueError, 'unsafe-private-file'), patch.object(
                        retry.Path, 'lstat', return_value=hard_link):
                    retry._private_file(path, 0o600, digest)

    def test_checker_requires_stopped_container_with_pinned_image(self):
        valid = dict(Name='/'+retry.CHECKER, Image=contract.IMAGE, Id='a'*64,
                     State=dict(Running=False, Paused=False, Restarting=False),
                     HostConfig=dict(RestartPolicy=dict(Name='no')))
        with patch.object(retry, 'docker', return_value=Mock(returncode=0,
                stdout=json.dumps([valid]))):
            self.assertEqual(retry._container_state(retry.CHECKER, retry.docker)['Id'], 'a'*64)
        invalid = {**valid, 'State': dict(Running=True, Paused=False, Restarting=False)}
        with patch.object(retry, 'docker', return_value=Mock(returncode=0,
                stdout=json.dumps([invalid]))), self.assertRaises(ValueError):
            retry._container_state(retry.CHECKER, retry.docker)

    def test_no_actual_runtime_refuses_existing_stopped_container(self):
        with patch.object(retry, 'docker', side_effect=[Mock(returncode=0), Mock(stdout='abc')]):
            with self.assertRaisesRegex(ValueError, 'actual-runtime-exists'):
                retry._no_actual_runtime(retry.docker)

    def test_unit_runtime_guard_refuses_dropins_or_active_units(self):
        units = contract.unit_files()
        path = str(retry.SYSTEMD_DIR / contract.SERVICE)
        output = (f'LoadState=loaded\nDropInPaths=/etc/systemd/system/override.conf\n'
                  f'NeedDaemonReload=no\nFragmentPath={path}\nActiveState=inactive\n')
        with self.assertRaisesRegex(ValueError, 'unit-runtime-state'):
            retry._verify_units(units, lambda _: Mock(stdout=output))
        output = output.replace('DropInPaths=/etc/systemd/system/override.conf', 'DropInPaths=')
        output = output.replace('ActiveState=inactive', 'ActiveState=active')
        with self.assertRaisesRegex(ValueError, 'unit-runtime-state'):
            retry._verify_units(units, lambda _: Mock(stdout=output))

    def test_run_round_trips_failed_target_units_and_checker_into_preserved_audit(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'root'
            root.mkdir()
            target = Path(temp) / 'failed-target'
            target.mkdir(mode=0o700)
            (target / 'config.json').write_bytes(b'config')
            (target / 'replay-daemon.mjs').write_bytes(b'daemon')
            systemd = Path(temp) / 'systemd'
            systemd.mkdir()
            units = contract.unit_files()
            for name, content in units.items():
                path = systemd / name
                path.write_bytes(content)
                path.chmod(0o644)

            checker = dict(Name='/'+retry.CHECKER, Image=contract.IMAGE, Id='f'*64,
                           State=dict(Running=False, Paused=False, Restarting=False),
                           HostConfig=dict(RestartPolicy=dict(Name='no')))
            docker_calls = []
            def docker_call(arguments, checked=True):
                docker_calls.append(arguments)
                if arguments == ['inspect', retry.CHECKER]:
                    return Mock(returncode=0, stdout=json.dumps([checker]))
                if arguments == ['inspect', contract.CONTAINER]:
                    return Mock(returncode=1, stdout='')
                if arguments[0] == 'ps':
                    return Mock(returncode=0, stdout='')
                if arguments == ['inspect', checker['Id']]:
                    return Mock(returncode=1, stdout='')
                if arguments[0] == 'ps':
                    return Mock(returncode=0, stdout='')
                return Mock(returncode=0, stdout='')

            commands = []
            def command_call(arguments, source=None, timeout=30):
                commands.append(arguments)
                if arguments[-1] == 'daemon-reload':
                    return Mock(stdout='')
                name = arguments[2]
                return Mock(stdout=(f'LoadState=loaded\nDropInPaths=\nNeedDaemonReload=no\n'
                    f'FragmentPath={systemd / name}\nActiveState=inactive\n'))

            safe_state = dict(system='7685292944002592802', functionExecute=False, schemaUsage=False)
            native_lstat = Path.lstat
            def lstat_path(path):
                if path == target:
                    info = native_lstat(path)
                    return SimpleNamespace(st_mode=info.st_mode, st_uid=0, st_nlink=info.st_nlink)
                return native_lstat(path)

            with patch.object(retry, 'ROOT_DIRECTORY', root), patch.object(
                    retry, 'SYSTEMD_DIR', systemd), patch.object(contract, 'TARGET', target), patch.object(
                    retry, '_root_path'), patch.object(retry, '_private_file', side_effect=lambda p, m, d:
                        dict(path=str(p), sha256=d, owner=0, mode=oct(m), links=1)), patch.object(
                    retry, '_unit_file', side_effect=lambda p, b: dict(path=str(p))), patch.object(
                    retry.Path, 'lstat', autospec=True, side_effect=lstat_path), patch.object(
                    retry.os, 'geteuid', return_value=0):
                result = retry.run(lambda _: json.dumps(safe_state), docker_call, command_call)

            audit = Path(result['manifest']).parent
            recovered = Path(result['recoveredTarget'])
            self.assertTrue(recovered.is_dir())
            self.assertEqual((recovered / 'config.json').read_bytes(), b'config')
            self.assertEqual((recovered / 'replay-daemon.mjs').read_bytes(), b'daemon')
            self.assertTrue(all((audit / name).is_file() for name in units))
            self.assertFalse(target.exists())
            self.assertEqual(docker_calls[-3:], [['rm', checker['Id']], ['inspect', checker['Id']],
                ['ps', '-aq', '--filter', 'name=^/'+retry.CHECKER+'$']])
            self.assertEqual(commands[-1], ['/usr/bin/systemctl', 'daemon-reload'])
            self.assertTrue(result['checkerRemoved'] and result['daemonReloaded'])
            manifest = json.loads(Path(result['manifest']).read_text())
            self.assertEqual(manifest['status'], 'failed-attempt-archived-ready-for-retry')
            self.assertEqual(len(manifest['archived']), 4)


if __name__ == '__main__':
    unittest.main()
