from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import receipt_preflight as module


class ReceiptPreflightTests(unittest.TestCase):
    def setUp(self):
        self.context = SimpleNamespace(owner=SimpleNamespace(read=Mock()), deadline=Mock())
        self.pins = {name: 'a' * 64 for name in module.FILES}

    def test_checks_entire_sealed_closure_before_original_receipt_collection(self):
        proof = dict(receiptStorage=dict(status='quarantined'), provenance=dict(hmacSha512Verified=True))
        with (patch.object(module, 'preflight', return_value={'readOnly': True}) as runtime,
              patch.object(module, 'collect_original_receipt', return_value=proof) as collector):
            result = module.receipt_preflight(self.context, Path('/synthetic'), self.pins)
        self.assertEqual(self.context.owner.read.call_count, len(module.FILES))
        runtime.assert_called_once_with(self.context)
        collector.assert_called_once_with(self.context, Path('/synthetic/receipt_report.sql'),
            'a' * 64, Path('/synthetic/receipt_crypto.cjs'), 'a' * 64)
        self.context.deadline.assert_called_once_with()
        self.assertEqual(result['receipt'], proof)
        self.assertFalse(result['financialActionAttempted'])
        self.assertFalse(result['newPaymentStarted'])

    def test_refuses_missing_extra_or_unpinned_source_before_database_contact(self):
        variants = [dict(self.pins), dict(self.pins, extra='b' * 64), dict(self.pins)]
        variants[0].pop('receipt_crypto.cjs')
        variants[2]['receipt_crypto.cjs'] = 'invalid'
        for pins in variants:
            with (patch.object(module, 'preflight') as runtime,
                  self.assertRaisesRegex(ValueError, 'receipt_release_refused')):
                module.receipt_preflight(self.context, Path('/synthetic'), pins)
            runtime.assert_not_called()

    def test_stops_when_original_cryptography_or_deadline_fails(self):
        with patch.object(module, 'preflight'), patch.object(module,
            'collect_original_receipt', side_effect=ValueError('original_receipt_provenance_refused')):
            with self.assertRaisesRegex(ValueError, 'original_receipt_provenance_refused'):
                module.receipt_preflight(self.context, Path('/synthetic'), self.pins)
        self.context.deadline.assert_not_called()
        self.context.deadline.side_effect = ValueError('deadline_expired')
        with patch.object(module, 'preflight'), patch.object(module, 'collect_original_receipt'):
            with self.assertRaisesRegex(ValueError, 'deadline_expired'):
                module.receipt_preflight(self.context, Path('/synthetic'), self.pins)


if __name__ == '__main__':
    unittest.main()
