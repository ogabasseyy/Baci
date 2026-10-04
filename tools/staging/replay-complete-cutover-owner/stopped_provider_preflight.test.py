from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

try:
    import stopped_provider_preflight as module
except ModuleNotFoundError:
    module = None


class StoppedProviderTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(module, 'stopped collector not implemented')
        observed = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        self.directory = Path('/synthetic')
        self.blobs = {name: ('synthetic:' + name).encode() for name in module.FILES}
        self.pins = {name: hashlib.sha256(raw).hexdigest() for name, raw in self.blobs.items()}
        self.original = dict(receiptStorage=dict(status='processed', observedAt=observed),
            provenance=dict(sourceProofObservedAt=observed))
        self.provider = dict(status='provider-crosswalk-readonly-verified', observedAt=observed,
            publicWalletId=module.DESTINATION, faasWalletId=module.DESTINATION_FAAS,
            apiCustomerId=module.API_CUSTOMER, providerCustomerId=module.CUSTOMER,
            nativeCustomerId=module.CUSTOMER, publicFaasMatches=True)
        self.application = dict(observedAt=observed,
            appIdentity=dict(systemIdentifier='7685292944002592802', readOnly=True))
        self.background = dict(capturedAt=observed,
            identity=dict(systemIdentifier='7685292944002592802', readOnly=True))
        self.audit = dict(rawResponse='{"eventId":"fixture"}')
        self.configuration = dict(database={}, scope={}, evidence=dict(piggyvest=dict(apiSecret='PRIVATE_MARKER')))
        self.context = SimpleNamespace(owner=SimpleNamespace(read=Mock(side_effect=self.read),
            decode=Mock(side_effect=[self.audit, {'eventId': 'fixture'}, self.configuration])),
            finance={'command': Mock(return_value=json.dumps(self.provider)),
                'database': Mock(side_effect=[json.dumps(self.application), json.dumps(self.background)])},
            deadline=Mock())

    def read(self, path, pin, **kwargs):
        return self.blobs[Path(path).name] if Path(path).parent == self.directory else b'{}'

    def execute(self):
        with (patch.object(module, 'collect_original_receipt', return_value=self.original) as original,
              patch.object(module, 'checked_native'),
              patch.object(module, 'verify_financial_quiescence', return_value={'status': 'financial-writers-quiescent'}) as quiet):
            result = module.collect_stopped_provider(self.context, self.directory, self.pins)
        return result, original, quiet

    def test_collects_original_and_fixed_gets_between_measured_quiescence_without_live_preflight(self):
        result, original, quiet = self.execute()
        self.assertEqual(quiet.call_count, 2)
        original.assert_called_once_with(self.context, self.directory/'receipt_report.sql',
            self.pins['receipt_report.sql'], self.directory/'receipt_crypto.cjs', self.pins['receipt_crypto.cjs'])
        self.context.finance['command'].assert_called_once()
        arguments = self.context.finance['command'].call_args.args[0]
        self.assertEqual(arguments, ['/usr/bin/node', '/synthetic/provider_crosswalk.cjs'])
        self.assertNotIn('PRIVATE_MARKER', str(arguments) + json.dumps(result))
        self.assertFalse(result['financialActionAttempted'])
        self.assertFalse(result['newPaymentStarted'])

    def test_missing_extra_invalid_or_drifting_release_refuses_before_original_or_provider(self):
        base = dict(self.pins)
        for kind in ('missing', 'extra', 'invalid', 'drift'):
            self.pins = dict(base)
            if kind == 'missing': self.pins.pop('provider_json.cjs')
            elif kind == 'extra': self.pins['foreign.py'] = 'a'*64
            elif kind == 'invalid': self.pins['receipt_crypto.cjs'] = True
            else: self.blobs['receipt_crypto.cjs'] += b'changed'
            with patch.object(module, 'collect_original_receipt') as original:
                with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, '^stopped_provider_refused$'):
                    module.collect_stopped_provider(self.context, self.directory, self.pins)
                original.assert_not_called()
        self.context.finance['command'].assert_not_called()

    def test_failed_before_quiescence_never_reaches_provider_or_signature_read(self):
        with (patch.object(module, 'verify_financial_quiescence', side_effect=ValueError('PRIVATE_MARKER')),
              patch.object(module, 'collect_original_receipt') as original):
            with self.assertRaisesRegex(ValueError, '^stopped_provider_refused$'):
                module.collect_stopped_provider(self.context, self.directory, self.pins)
            original.assert_not_called()
        self.context.finance['command'].assert_not_called()

    def test_restart_at_postcollection_quiescence_refuses_without_any_restart_or_stop_command(self):
        with (patch.object(module, 'collect_original_receipt', return_value=self.original),
              patch.object(module, 'checked_native'), patch.object(module, 'verify_financial_quiescence',
                side_effect=[{'status':'financial-writers-quiescent'}, ValueError('PRIVATE_MARKER')])):
            with self.assertRaisesRegex(ValueError, '^stopped_provider_refused$'):
                module.collect_stopped_provider(self.context, self.directory, self.pins)
        self.assertEqual(self.context.finance['command'].call_count, 1)

    def test_integer_readonly_provider_boolean_or_unprocessed_receipt_refuses(self):
        for kind in ('readonly', 'provider', 'unprocessed'):
            self.setUp()
            if kind == 'readonly': self.application['appIdentity']['readOnly'] = 1
            elif kind == 'provider': self.provider['publicFaasMatches'] = 1
            else: self.original['receiptStorage']['status'] = 'quarantined'
            self.context.finance['command'].return_value = json.dumps(self.provider)
            self.context.finance['database'].side_effect = [json.dumps(self.application), json.dumps(self.background)]
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, '^stopped_provider_refused$'):
                self.execute()


if __name__ == '__main__':
    unittest.main()
