import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'prefunded-card'))
import interest_runtime_preparation as owner
from treasury_owner_contract import Refused


class InterestRuntimePreparationTests(unittest.TestCase):
    def test_refuses_an_active_financial_service_even_when_all_containers_are_stopped(self):
        containers = [dict(Name='/' + name, Id=name, Image='synthetic-image',
                           State=dict(Running=False, Paused=False, Restarting=False, Status='created'),
                           HostConfig=dict(RestartPolicy=dict(Name='no'))) for name in owner.CONTAINERS]
        with patch.object(owner, 'command', side_effect=[json.dumps(containers), 'active\n']):
            with self.assertRaises(Refused):
                owner.stopped_runtimes()

    def test_writes_only_fresh_candidate_files_and_never_reports_credentials(self):
        configuration = dict(receiptToken='secret-token', appToken='secret-token',
                             financialDatabase=dict(password='secret-password'))
        snapshot = dict(systemIdentifier='7685292944002592802', principalKobo=10000,
                        allocations=0, paidReceipts=0, bridgeExecute=False,
                        login=True, unsafe=False, expiresAt='2026-10-06T15:59:10Z')
        written = {}
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with patch.object(owner, 'private_directory'), patch.object(owner, 'root_ancestors'), \
                 patch.object(owner, 'stopped_runtimes', return_value=('unchanged',)) as stopped, \
                 patch.object(owner, 'probe', return_value=snapshot) as probe, \
                 patch.object(owner, 'read_prepared', return_value={}), \
                 patch.object(owner, 'read_replay_inputs', return_value=({}, {})) as inputs, \
                 patch.object(owner, 'build_interest_configuration', return_value=configuration), \
                 patch.object(owner, 'write_private', side_effect=lambda path, content: written.update({path.name: content})), \
                 patch.object(owner.os, 'chown'), patch.object(owner.os, 'chmod'):
                report = owner.prepare(directory)
        self.assertEqual(set(written), {'interest-config.json', 'preparation-result.json'})
        self.assertEqual(report['status'], 'interest-runtime-prepared-inactive')
        self.assertFalse(report['servicesStarted'])
        self.assertFalse(report['bridgeAccessGranted'])
        self.assertFalse(report['balancesChanged'])
        self.assertFalse(report['replayReady'])
        self.assertEqual(stopped.call_count, 2)
        self.assertEqual(probe.call_count, 2)
        inputs.assert_called_once_with(1001)
        self.assertNotIn('secret', json.dumps(report))
        self.assertEqual(json.loads(written['interest-config.json']), configuration)

    def test_refuses_ineligible_database_state_before_reading_or_creating_credentials(self):
        base = dict(systemIdentifier='7685292944002592802', principalKobo=10000,
                    allocations=0, paidReceipts=0, bridgeExecute=False,
                    login=True, unsafe=False, expiresAt='2026-10-06T15:59:10Z')
        for override in ({'principalKobo': 10001}, {'unsafe': True}, {'bridgeExecute': True},
                         {'expiresAt': '2026-09-29T15:59:10Z'}, {'allocations': 1}):
            with self.subTest(override=override), patch.object(owner, 'private_directory'), \
                 patch.object(owner, 'root_ancestors'), patch.object(owner, 'stopped_runtimes'), \
                 patch.object(owner, 'probe', return_value={**base, **override}), \
                 patch.object(owner, 'read_prepared') as read, patch.object(owner, 'write_private') as write:
                with self.assertRaises(Refused):
                    owner.prepare(Path('/root/synthetic'))
                read.assert_not_called()
                write.assert_not_called()

    def test_refuses_protected_state_drift_without_a_success_receipt(self):
        snapshot = dict(systemIdentifier='7685292944002592802', principalKobo=10000,
                        allocations=0, paidReceipts=0, bridgeExecute=False,
                        login=True, unsafe=False, expiresAt='2026-10-06T15:59:10Z')
        written = []
        with patch.object(owner, 'private_directory'), patch.object(owner, 'root_ancestors'), \
             patch.object(owner, 'stopped_runtimes', side_effect=[('before',), ('after',)]), \
             patch.object(owner, 'probe', return_value=snapshot), patch.object(owner, 'read_prepared'), \
             patch.object(owner, 'read_replay_inputs', return_value=({}, {})), \
             patch.object(owner, 'build_interest_configuration', return_value={}), \
             patch.object(owner, 'write_private', side_effect=lambda path, content: written.append(path.name)), \
             patch.object(owner.os, 'chown'), patch.object(owner.os, 'chmod'):
            with self.assertRaises(Refused):
                owner.prepare(Path('/root/synthetic'))
        self.assertNotIn('preparation-result.json', written)


if __name__ == '__main__':
    unittest.main()
