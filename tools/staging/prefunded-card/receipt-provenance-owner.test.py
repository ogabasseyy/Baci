import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch


SOURCE = Path(__file__).parent
sys.path.insert(0, str(SOURCE))
SPEC = importlib.util.spec_from_file_location('receipt_owner', SOURCE / 'receipt-provenance-owner.py')
OWNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OWNER)


class ReceiptProvenanceOwner(unittest.TestCase):
    def test_schema_precedes_code_and_restart_and_never_starts_card_workers(self):
        actions = []
        deps = self.dependencies(actions)
        result = OWNER.activate(deps)
        self.assertEqual(actions, ['preflight', 'schema', 'schema-check', 'rpc-check',
                                   'backup', 'install', 'restart', 'health'])
        self.assertEqual(result['status'], 'original-signature-capture-ready')
        self.assertFalse(result['cardPaymentsEnabled'])

    def test_schema_failure_does_not_touch_intake_or_report_success(self):
        actions = []
        deps = self.dependencies(actions)
        deps.apply_schema = Mock(side_effect=OWNER.CommandFailure(exit_code=17, sqlstate='42501'))
        with self.assertRaises(OWNER.Refused) as caught:
            OWNER.activate(deps)
        self.assertEqual(actions, ['preflight'])
        self.assertEqual(OWNER.refusal_payload(caught.exception), {
            'status': 'refused', 'reason': 'Receipt owner action incomplete', 'stage': 'schema-apply',
            'cardPaymentsEnabled': False, 'redacted': True,
            'command': {'exitCode': 17, 'sqlstate': '42501'},
        })

    def test_command_failure_diagnostic_never_renders_secret_output_or_arguments(self):
        secret_output = 'provider-token-secret'
        secret_argument = 'credential-argument-secret'
        with patch.object(OWNER.subprocess, 'run', return_value=Mock(
                returncode=23, stdout=secret_output, stderr='ERROR:  22023: ' + secret_output)):
            with self.assertRaises(OWNER.Refused) as caught:
                OWNER.command(['program', secret_argument, '-v', 'VERBOSITY=sqlstate'])

        payload = OWNER.refusal_payload(OWNER.StageFailure(
            'rpc-check', exit_code=caught.exception.exit_code, sqlstate=caught.exception.sqlstate))
        rendered = json.dumps(payload)
        self.assertEqual(payload['command'], {'exitCode': 23, 'sqlstate': '22023'})
        self.assertNotIn(secret_output, rendered)
        self.assertNotIn(secret_argument, rendered)

    def test_sqlstate_is_omitted_without_sqlstate_verbosity(self):
        with patch.object(OWNER.subprocess, 'run', return_value=Mock(
                returncode=1, stdout='', stderr='ERROR:  42501: private detail')):
            with self.assertRaises(OWNER.CommandFailure) as caught:
                OWNER.command(['psql'])

        self.assertEqual(OWNER.refusal_payload(caught.exception), {
            'status': 'refused', 'reason': 'Receipt owner action incomplete', 'stage': 'preflight',
            'cardPaymentsEnabled': False, 'redacted': True,
            'command': {'exitCode': 1},
        })

    def test_each_pre_install_failure_reports_its_exact_stage(self):
        stages = [('preflight', 'preflight'), ('apply_schema', 'schema-apply'),
                  ('verify_schema', 'schema-verify'), ('rpc_check', 'rpc-check'), ('backup', 'backup')]
        for method, stage in stages:
            with self.subTest(stage=stage):
                deps = self.dependencies([])
                getattr(deps, method).side_effect = OWNER.Refused('private failure detail')
                with self.assertRaises(OWNER.Refused) as caught:
                    OWNER.activate(deps)
                payload = OWNER.refusal_payload(caught.exception)
                self.assertEqual(payload['stage'], stage)
                self.assertNotIn('private failure detail', json.dumps(payload))

    def test_each_replacement_failure_reports_its_exact_stage_after_rollback(self):
        for method, stage in [('install', 'install'), ('restart', 'restart'), ('health', 'health')]:
            with self.subTest(stage=stage):
                deps = self.dependencies([])
                failure = OWNER.Refused('private failure detail')
                if method == 'restart':
                    restart_calls = 0

                    def fail_first_restart():
                        nonlocal restart_calls
                        restart_calls += 1
                        if restart_calls == 1:
                            raise failure

                    deps.restart.side_effect = fail_first_restart
                else:
                    getattr(deps, method).side_effect = failure
                with self.assertRaises(OWNER.Refused) as caught:
                    OWNER.activate(deps)
                payload = OWNER.refusal_payload(caught.exception)
                self.assertEqual(payload['stage'], stage)
                self.assertIn('original intake restored', payload['reason'])
                self.assertNotIn('private failure detail', json.dumps(payload))

    def test_rpc_readiness_failure_preserves_old_server(self):
        actions = []
        deps = self.dependencies(actions)
        deps.rpc_check = Mock(side_effect=OWNER.Refused('RPC not visible'))
        with self.assertRaises(OWNER.Refused):
            OWNER.activate(deps)
        self.assertEqual(actions, ['preflight', 'schema', 'schema-check'])

    def test_post_restart_failure_restores_exact_old_artifact_and_health(self):
        actions = []
        deps = self.dependencies(actions)
        deps.health = Mock(side_effect=[OWNER.Refused('health'), None])
        with self.assertRaisesRegex(OWNER.Refused, 'restored'):
            OWNER.activate(deps)
        self.assertEqual(actions[-3:], ['restore', 'restart', 'old-health'])

    def test_restore_failure_is_not_claimed_successful(self):
        actions = []
        deps = self.dependencies(actions)
        deps.health = Mock(side_effect=OWNER.Refused('health'))
        deps.restore = Mock(side_effect=OWNER.Refused('restore'))
        with self.assertRaisesRegex(OWNER.Refused, 'unconfirmed'):
            OWNER.activate(deps)

    def test_rollback_failure_reports_rollback_stage(self):
        deps = self.dependencies([])
        deps.health.side_effect = OWNER.Refused('health')
        deps.restore.side_effect = OWNER.CommandFailure(exit_code=9)
        with self.assertRaises(OWNER.Refused) as caught:
            OWNER.activate(deps)
        payload = OWNER.refusal_payload(caught.exception)
        self.assertEqual(payload['stage'], 'rollback')
        self.assertEqual(payload['command'], {'exitCode': 9})

    def test_failed_install_after_replace_also_restores(self):
        actions = []
        deps = self.dependencies(actions)
        deps.install = Mock(side_effect=OWNER.Refused('replacement'))
        with self.assertRaisesRegex(OWNER.Refused, 'restored'):
            OWNER.activate(deps)
        self.assertEqual(actions[-3:], ['restore', 'restart', 'old-health'])

    def test_foreign_change_detected_before_replace_is_not_overwritten(self):
        actions = []
        deps = self.dependencies(actions)
        deps.replacement_started = False
        deps.install = Mock(side_effect=OWNER.Refused('foreign artifact'))
        with self.assertRaisesRegex(OWNER.Refused, 'current intake retained'):
            OWNER.activate(deps)
        deps.restore.assert_not_called()
        deps.restart.assert_not_called()

    def test_expired_lease_refuses_before_side_effects(self):
        actions = []
        with patch.object(OWNER.time, 'time', return_value=OWNER.DEADLINE_EPOCH):
            with self.assertRaises(OWNER.Refused):
                OWNER.activate(self.dependencies(actions))
        self.assertEqual(actions, [])

    def dependencies(self, actions):
        deps = Mock()
        deps.replacement_started = True
        for name in ['preflight', 'apply_schema', 'verify_schema', 'rpc_check', 'backup',
                     'install', 'restart', 'health', 'restore', 'old_health']:
            label = {'apply_schema': 'schema', 'verify_schema': 'schema-check',
                     'rpc_check': 'rpc-check', 'old_health': 'old-health'}.get(name, name)
            getattr(deps, name).side_effect = lambda label=label: actions.append(label)
        return deps


if __name__ == '__main__':
    unittest.main()
