from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import provider_preflight as module


class ProviderPreflightTests(unittest.TestCase):
    def setUp(self):
        observed = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        self.provider = dict(status='provider-crosswalk-readonly-verified', observedAt=observed,
            publicWalletId=module.DESTINATION, faasWalletId=module.DESTINATION_FAAS,
            apiCustomerId=module.API_CUSTOMER, providerCustomerId=module.CUSTOMER,
            nativeCustomerId=module.CUSTOMER, publicFaasMatches=True)
        self.audit = dict(rawResponse='{"eventId":"synthetic"}')
        self.configuration = dict(database={}, evidence=dict(piggyvest=dict(apiSecret='private')), scope={})
        self.application = dict(observedAt=observed,
            appIdentity=dict(systemIdentifier='7685292944002592802', readOnly=True))
        self.background = dict(version=1, identity=dict(systemIdentifier='7685292944002592802', readOnly=True),
            blockers=['target_queue'], phase='verify_existing_transfer', capturedAt=observed)
        self.context = SimpleNamespace(owner=SimpleNamespace(read=Mock(return_value=b'{}'),
            decode=Mock(side_effect=[self.audit, {'eventId': 'synthetic'}, self.configuration])),
            finance={'command': Mock(return_value=json.dumps(self.provider)),
                     'database': Mock(side_effect=[json.dumps(self.application), json.dumps(self.background)])},
            deadline=Mock())
        self.pins = {name: 'a' * 64 for name in module.FILES}
        self.original = dict(receipt=dict(receiptStorage=dict(status='quarantined', observedAt=observed),
            provenance=dict(sourceProofObservedAt=observed)))

    def execute(self):
        with (patch.object(module, 'receipt_preflight', return_value=self.original),
              patch.object(module, 'checked_native')):
            return module.provider_preflight(self.context, Path('/synthetic'), self.pins)

    def test_authenticates_original_then_passes_only_private_stdin_to_four_get_collector(self):
        result = self.execute()
        arguments, = self.context.finance['command'].call_args.args
        self.assertEqual(arguments, ['/usr/bin/node', '/synthetic/provider_crosswalk.cjs'])
        request = json.loads(self.context.finance['command'].call_args.kwargs['input_text'])
        self.assertEqual(request, dict(event={'eventId': 'synthetic'}, piggyvest={'apiSecret': 'private'},
            executionDeadline='2026-10-06T15:59:10Z'))
        self.assertNotIn('private', json.dumps(result))
        self.assertEqual(result['provider'], self.provider)
        self.assertEqual(result['background']['blockers'], ['target_queue'])
        self.assertFalse(result['financialActionAttempted'])
        self.assertFalse(result['newPaymentStarted'])
        self.assertGreaterEqual(self.context.deadline.call_count, 2)

    def test_refuses_missing_extra_or_invalid_pins_before_any_provider_contact(self):
        variants = [dict(self.pins), dict(self.pins, extra='b' * 64), dict(self.pins)]
        variants[0].pop('provider_json.cjs')
        variants[2]['provider_crosswalk.cjs'] = 'invalid'
        for pins in variants:
            with self.assertRaisesRegex(ValueError, 'provider_release_refused'):
                module.provider_preflight(self.context, Path('/synthetic'), pins)
        self.context.finance['command'].assert_not_called()

    def test_original_authentication_failure_prevents_provider_or_application_contact(self):
        with patch.object(module, 'receipt_preflight', side_effect=ValueError('original_refused')):
            with self.assertRaisesRegex(ValueError, 'original_refused'):
                module.provider_preflight(self.context, Path('/synthetic'), self.pins)
        self.context.finance['command'].assert_not_called()
        self.context.finance['database'].assert_not_called()

    def test_false_or_foreign_provider_crosswalk_never_becomes_live_proof(self):
        for name, value in [('publicFaasMatches', 1), ('nativeCustomerId', 'foreign'),
                            ('faasWalletId', 'foreign'), ('extra', True)]:
            self.context.finance['command'].return_value = json.dumps(dict(self.provider, **{name: value}))
            self.context.owner.decode.side_effect = [self.audit, {'eventId': 'synthetic'}, self.configuration]
            with self.assertRaisesRegex(ValueError, 'provider_report_refused'):
                self.execute()
        self.context.finance['database'].assert_not_called()

    def test_stale_provider_observation_is_refused_before_database_contact(self):
        self.provider['observedAt'] = '2026-10-02T00:00:00Z'
        self.context.finance['command'].return_value = json.dumps(self.provider)
        with self.assertRaisesRegex(ValueError, 'provider_report_refused'):
            self.execute()
        self.context.finance['database'].assert_not_called()

    def test_physical_application_identity_or_integer_readonly_flag_is_refused(self):
        self.application['appIdentity']['readOnly'] = 1
        self.context.finance['database'].side_effect = [json.dumps(self.application), json.dumps(self.background)]
        with self.assertRaisesRegex(ValueError, 'application_identity_refused'):
            self.execute()

    def test_delayed_collection_rejects_stale_original_or_sql_observations_before_handoff(self):
        records = ((self.original['receipt']['receiptStorage'], 'observedAt'),
            (self.original['receipt']['provenance'], 'sourceProofObservedAt'),
            (self.application, 'observedAt'), (self.background, 'capturedAt'))
        stale = (datetime.now(timezone.utc) - timedelta(seconds=120)).isoformat().replace('+00:00', 'Z')
        for record, name in records:
            with self.subTest(field=name):
                fresh = record[name]
                record[name] = stale
                self.context.owner.decode.side_effect = [self.audit, {'eventId': 'synthetic'}, self.configuration]
                self.context.finance['database'].side_effect = [json.dumps(self.application), json.dumps(self.background)]
                with self.assertRaisesRegex(ValueError, '^combined_report_stale$'):
                    self.execute()
                record[name] = fresh


if __name__ == '__main__':
    unittest.main()
