import argparse
from contextlib import ExitStack, redirect_stdout
import copy
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import empty_plan_owner as owner
from plan_test_fixture import plan_test_fixture


class EmptyPlanOwnerTests(unittest.TestCase):
    def setUp(self):
        self.approval, self.snapshot, self.wallet = plan_test_fixture()
        self.args = argparse.Namespace(mode='rehearse', source_manifest_sha256='a'*64,
            approval=Path('approval'), approval_sha256='b'*64, snapshot=Path('snapshot'),
            snapshot_sha256='c'*64, identity=Path('identity'), routing_proof=Path('routing'),
            eligibility_proof=Path('eligibility'), split_proof=Path('split'),
            rehearsal=None, rehearsal_sha256=None)
        self.snapshot.update(kind='empty_interest_plan_inventory', sourceManifestSha256='a'*64)
        self.result = {'status': 'exact_empty_goal_bound', 'goalId': 'aaaaaaaa-0000-4000-8000-000000000003',
            'principalKobo': 0, 'newPrefundingKobo': 0, 'interestPolicyEnabled': True,
            'interestPolicyPresent': True, 'providerIdMappingApproved': True,
            'oldGoalPrincipalKobo': 10000, 'schemaMd5': self.approval['schemaMd5'],
            'stateMd5': self.approval['stateMd5']}
        self.rehearsal = None
        self.database_calls = []

    def inputs(self, path, checksum):
        return {'approval': self.approval, 'snapshot': self.snapshot, 'rehearsal': self.rehearsal}[path.name]

    def database(self, sql):
        self.database_calls.append(sql)
        return copy.deepcopy(self.result)

    def execute(self):
        with ExitStack() as stack:
            stack.enter_context(patch.object(owner.os, 'geteuid', return_value=0))
            stack.enter_context(patch.object(owner, '_source'))
            stack.enter_context(patch.object(owner, '_json', side_effect=self.inputs))
            stack.enter_context(patch.object(owner, 'read_snapshot', side_effect=self.inputs))
            stack.enter_context(patch.object(owner, 'read_sealed', return_value=b'synthetic-proof'))
            stack.enter_context(patch.object(owner, 'read_empty_wallet', return_value=self.wallet))
            stack.enter_context(patch.object(owner, '_database', side_effect=self.database))
            return owner.execute(self.args, datetime.now(timezone.utc))

    def test_rehearsal_runs_real_sql_path_with_rollback_and_enabled_policy_not_disabled_flags(self):
        report = self.execute()
        self.assertFalse(report['changesMade'])
        self.assertTrue(report['rolledBack'])
        self.assertTrue(report['interestPolicyEnabled'])
        self.assertTrue(self.database_calls[0].endswith('ROLLBACK;\n'))

    def test_apply_requires_pinned_recent_rehearsal_before_any_write_command(self):
        self.args.mode = 'apply'
        with self.assertRaisesRegex(ValueError, 'rehearsal-required'):
            self.execute()
        self.assertEqual(self.database_calls, [])
        self.args.mode = 'rehearse'
        self.rehearsal = self.execute()
        self.args.mode = 'apply'
        self.args.rehearsal = Path('rehearsal')
        self.args.rehearsal_sha256 = 'd'*64
        report = self.execute()
        self.assertTrue(report['changesMade'])
        self.assertTrue(self.database_calls[-1].endswith('COMMIT;\n'))

    def test_goal_only_rehearsal_and_apply_need_no_routing_proof_or_policy(self):
        self.args.mode = 'goal-rehearse'
        self.args.routing_proof = None
        self.approval['routing'] = None
        self.result.update(status='exact_empty_goal_bound_policy_pending',
            interestPolicyEnabled=False, interestPolicyPresent=False, providerIdMappingApproved=False)
        self.rehearsal = self.execute()
        self.assertEqual(self.rehearsal['kind'], 'empty_interest_goal_rehearsal')
        self.assertFalse(self.rehearsal['interestPolicyPresent'])
        self.args.mode = 'goal-apply'
        self.args.rehearsal = Path('rehearsal')
        self.args.rehearsal_sha256 = 'd'*64
        report = self.execute()
        self.assertEqual(report['kind'], 'empty_interest_goal_commit')
        self.assertTrue(report['changesMade'])
        self.assertFalse(report['interestPolicyEnabled'])
        self.assertTrue(self.database_calls[-1].endswith('COMMIT;\n'))

    def test_full_policy_rehearsal_cannot_authorize_goal_only_apply(self):
        self.rehearsal = self.execute()
        self.args.mode = 'goal-apply'
        self.args.rehearsal = Path('rehearsal')
        self.args.rehearsal_sha256 = 'd'*64
        self.approval['routing'] = None
        self.database_calls.clear()
        with self.assertRaisesRegex(ValueError, 'rollback-rehearsal-pin'):
            self.execute()
        self.assertEqual(self.database_calls, [])

    def test_refuses_failed_wrong_source_or_expired_rehearsal(self):
        self.rehearsal = self.execute()
        self.args.mode = 'apply'
        self.args.rehearsal = Path('rehearsal')
        self.args.rehearsal_sha256 = 'd'*64
        self.database_calls.clear()
        for field, value in (('rolledBack', False), ('sourceManifestSha256', '0'*64),
            ('oldGoalPrincipalKobo', 9999), ('principalKobo', 1),
            ('validUntil', '2026-10-02T00:00:00Z')):
            original = copy.deepcopy(self.rehearsal)
            self.rehearsal[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.execute()
            self.rehearsal = original
        self.assertEqual(self.database_calls, [])

    def test_missing_provider_documents_and_drift_refuse_without_database_writes(self):
        self.args.routing_proof = None
        with self.assertRaises(ValueError):
            self.execute()
        self.assertEqual(self.database_calls, [])
        self.args.routing_proof = Path('routing')
        self.approval['stateMd5'] = 'f'*32
        with self.assertRaises(ValueError):
            self.execute()
        self.assertEqual(self.database_calls, [])

    def test_cli_malformed_trusted_shapes_refuse_redacted_without_traceback_or_provider_body(self):
        for error in (KeyError('provider-secret-sentinel'), AttributeError('provider-secret-sentinel'),
                      ValueError('provider-body-sentinel')):
            with tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / 'receipt.json'
                argv = ['empty_plan_owner.py', 'rehearse', '--source-manifest-sha256', 'a'*64,
                        '--output', str(output)]
                stdout = io.StringIO()
                with patch('sys.argv', argv), patch.object(owner.os, 'geteuid', return_value=0), \
                        patch.object(owner, 'execute', side_effect=error), redirect_stdout(stdout):
                    self.assertEqual(owner.main(), 1)
                text = stdout.getvalue()
                self.assertTrue(json.loads(text)['redacted'])
                self.assertNotIn('provider-', text)
                self.assertNotIn('Traceback', text)

    def test_apply_uncertainty_never_claims_false_or_completed_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            argv = ['empty_plan_owner.py', 'apply', '--source-manifest-sha256', 'a'*64,
                    '--output', str(Path(directory) / 'receipt')]
            stdout = io.StringIO()
            with patch('sys.argv', argv), patch.object(owner.os, 'geteuid', return_value=0), \
                    patch.object(owner, 'execute', side_effect=TimeoutError), redirect_stdout(stdout):
                self.assertEqual(owner.main(), 1)
            self.assertIsNone(json.loads(stdout.getvalue())['changesMade'])
            self.assertEqual(json.loads(stdout.getvalue())['status'], 'apply_unconfirmed')

    def test_sql_refusal_diagnostics_are_whitelisted_not_database_error_bodies(self):
        import subprocess
        process = subprocess.CompletedProcess(['synthetic-psql'], 3, '',
            'provider-secret-sentinel test plan restricted binding refused')
        with patch.object(owner.subprocess, 'run', return_value=process):
            with self.assertRaisesRegex(ValueError, '^restricted-binding-refused$'):
                owner._database('synthetic-query')


if __name__ == '__main__':
    unittest.main()
