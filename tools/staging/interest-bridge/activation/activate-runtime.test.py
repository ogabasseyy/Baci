import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import activation_contract as contract


specification = importlib.util.spec_from_file_location('owner', Path(__file__).with_name('activate-runtime.py'))
owner = importlib.util.module_from_spec(specification)
specification.loader.exec_module(owner)


class RuntimeTests(unittest.TestCase):
    def test_refuses_root_or_restart_policy_or_wrong_network(self):
        good = dict(Name='/'+contract.CONTAINER, Image=contract.IMAGE,
                    Config=dict(User='65532:65532'), HostConfig=dict(ReadonlyRootfs=True,
                    RestartPolicy=dict(Name='no')), NetworkSettings=dict(Networks={
                    'baci-isolated-savings_database': {}, 'pvb-staging-receipts': {}}))
        owner.verify_runtime(good, contract.CONTAINER)
        for value in ('root', '0:0', '65530:65530'):
            with self.assertRaises(ValueError):
                owner.verify_runtime({**good, 'Config': dict(User=value)}, contract.CONTAINER)
        with self.assertRaises(ValueError):
            owner.verify_runtime({**good, 'HostConfig': dict(ReadonlyRootfs=True,
                                 RestartPolicy=dict(Name='always'))}, contract.CONTAINER)
        with self.assertRaises(ValueError):
            owner.verify_runtime({**good, 'NetworkSettings': dict(Networks={'host': {}})}, contract.CONTAINER)

    def test_refuses_dropins_even_when_disk_unit_matches(self):
        result = SimpleNamespace(stdout='LoadState=loaded\nDropInPaths=/etc/override\nNeedDaemonReload=no\nFragmentPath=/etc/systemd/system/test.service\n')
        with patch.object(Path, 'read_bytes', return_value=b'unit'), patch.object(owner, 'command', return_value=result):
            with self.assertRaises(ValueError):
                owner.effective_units({'test.service': b'unit'})

    def test_create_checker_uses_only_two_readonly_mounts_and_tls_host(self):
        calls = []
        def docker(arguments, **options):
            calls.append(arguments)
            return SimpleNamespace(stdout='a'*64+'\n')
        with patch.object(owner, 'docker', side_effect=docker):
            owner.create_runtime('check', True)
        self.assertEqual(calls[0].count('--mount'), 2)
        self.assertIn('--read-only', calls[0])
        self.assertIn('piggyvest-db.staging.baci.internal:172.23.0.2', calls[0])
        self.assertEqual(calls[0][-1], '--check')
        self.assertNotIn('prefunded-replay-bundle.mjs', ' '.join(calls[0]))

    def test_waits_for_running_and_rejects_immediate_exit(self):
        states = [dict(State=dict(Running=False, Status='created')),
                  dict(State=dict(Running=True)), dict(State=dict(Running=False))]
        with patch.object(owner, 'docker', side_effect=[SimpleNamespace(stdout=json.dumps([value]))
                for value in states]), patch.object(owner, 'verify_runtime'), patch.object(owner.time, 'sleep'):
            with self.assertRaisesRegex(ValueError, 'interest-container-exited'):
                owner.verify_started('container')

    def test_keeps_wait_for_running_bounded_and_preserves_utc_environment(self):
        result = SimpleNamespace(stdout=json.dumps([dict(State=dict(Running=False, Status='created'))]))
        with patch.object(owner, 'docker', return_value=result) as inspect, patch.object(
                owner, 'verify_runtime'), patch.object(owner.time, 'sleep'):
            with self.assertRaisesRegex(ValueError, 'interest-container-start'):
                owner.verify_started('container')
        self.assertEqual(inspect.call_count, 10)
        self.assertEqual(owner.ENVIRONMENT['TZ'], 'UTC')


if __name__ == '__main__':
    unittest.main()
