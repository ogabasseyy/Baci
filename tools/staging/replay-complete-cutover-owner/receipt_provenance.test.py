import copy
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import receipt_provenance as module


HERE = Path(__file__).resolve().parent


def fixture():
    return dict(identity=dict(systemIdentifier='7686901100561231906', sessionUser='supabase_admin',
        currentUser='supabase_admin', database='postgres', localUnix=True, readOnly=True),
        observedAt='2026-10-03T08:00:00Z', receiptId=module.RECEIPT,
        payloadSha256=module.PAYLOAD, signatureReceiptId=module.RECEIPT,
        signaturePayloadSha256=module.PAYLOAD, receiptCount=1, signatureCount=1,
        signaturePreserved=True, signedPayloadHashMatches=True, status='processed',
        claimTokenPresent=False, leaseExpiresAt=None,
        sealed=dict(payloadSha256=module.PAYLOAD, ciphertext='cHJpdmF0ZQ==', nonce='bm9uY2U=',
                    authTag='dGFn', keyVersion='staging-v1'), providerSignature='private-signature')


class ReceiptProvenanceTests(unittest.TestCase):
    def test_live_sql_is_readonly_scoped_and_returns_original_ciphertext_only_to_parent(self):
        source = (HERE / 'receipt_report.sql').read_text()
        self.assertIn('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;', source)
        self.assertIn('ROLLBACK;', source)
        self.assertIn("session_user<>'supabase_admin'", source)
        self.assertIn("inet_client_addr() IS NOT NULL", source)
        self.assertIn('7686901100561231906', source)
        self.assertIn(module.RECEIPT, source)
        self.assertIn('signature.provider_signature', source)
        self.assertNotIn('claim_piggyvest', source)
        self.assertNotIn('UPDATE ', source)

    def test_removes_private_ciphertext_and_signature_after_binding_actual_storage(self):
        report = fixture()
        before = copy.deepcopy(report)
        with patch.object(module, '_fresh'):
            storage = module.checked_storage(report)
        self.assertEqual(report, before)
        self.assertNotIn('sealed', storage)
        self.assertNotIn('providerSignature', storage)
        self.assertNotIn('private-signature', json.dumps(storage))

    def test_wrong_identity_payload_signature_link_and_leased_receipt_refuse(self):
        for name, value in [('receiptId', 'foreign'), ('payloadSha256', '0' * 64),
            ('signaturePayloadSha256', '0' * 64), ('signatureCount', 2),
            ('claimTokenPresent', True), ('leaseExpiresAt', '2026-10-03T08:01:00Z')]:
            report = fixture()
            report[name] = value
            with patch.object(module, '_fresh'), self.assertRaisesRegex(ValueError, 'receipt_storage_refused'):
                module.checked_storage(report)
        report = fixture()
        report['identity']['readOnly'] = False
        with patch.object(module, '_fresh'), self.assertRaisesRegex(ValueError, 'receipt_storage_refused'):
            module.checked_storage(report)

    def test_actual_native_namespaces_are_scoped_without_confusing_business_or_transaction_ids(self):
        event = dict(eventId=module.EVENT, eventType='wallet-transfer.outflow.success',
            eventCategory='wallet_transfer', customer_id=module.CUSTOMER,
            pvb_wallet=module.SOURCE, pvb_destination_wallet=module.DESTINATION,
            pvb_third_party_reference=module.REFERENCE,
            eventData=dict(customer_id=module.CUSTOMER, source_wallet=module.SOURCE_FAAS,
                destination_wallet=module.DESTINATION_FAAS, amount=10000, currency='NGN',
                status='COMPLETED', third_party_reference=module.TRANSACTION,
                initiator_reference=module.TRANSACTION, reference=module.NATIVE_REFERENCE,
                internal_reference=module.NATIVE_REFERENCE,
                transaction_id='2d3ee34a-74e9-4992-b0c2-f8a653e4ff02'))
        module.checked_native(event)
        event['customer_id'] = '01M2381RG34HQJMHQKE7DWDACR'
        with self.assertRaisesRegex(ValueError, 'original_native_identity_refused'):
            module.checked_native(event)

    def test_private_transport_error_is_redacted_and_never_returned_as_proof(self):
        context = SimpleNamespace(owner=SimpleNamespace(read=lambda *args, **kwargs:
            (_ for _ in ()).throw(RuntimeError('secret-provider-signature'))))
        with self.assertRaisesRegex(ValueError, '^original_receipt_provenance_refused$'):
            module.collect_original_receipt(context, HERE / 'receipt_report.sql', '0' * 64,
                                           HERE / 'receipt_crypto.cjs', '1' * 64)


if __name__ == '__main__':
    unittest.main()
