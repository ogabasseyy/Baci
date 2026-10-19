import copy
import hashlib
import json
import unittest
from datetime import datetime, timezone

from proof_contract import reviewed_proof


class OwnerProofTests(unittest.TestCase):
    def setUp(self):
        self.intent = dict(intentId='intent', customerId='customer', merchantId='merchant',
            integrationId='integration', goalId='goal', requestFingerprint='fingerprint',
            amountKobo=10000, reference='pvb-first-intent', email='fixture@example.test')
        auth = dict(authorizationCode='AUTH_fixture', signature='signature', customerCode='CUS_fixture',
            brand='visa', last4='4081', expiryMonth='12', expiryYear='2030')
        collection = dict(providerTransactionId='1234', authorization=auth)
        self.data = dict(status='success', domain='test', channel='card', id=1234, amount=10000,
            currency='NGN', reference=self.intent['reference'], paidAt='2026-10-02T13:05:25Z',
            customer=dict(email=self.intent['email'], customer_code=auth['customerCode']),
            metadata=dict(transaction_type='prefunded_first_card', intent_id='intent', customer_id='customer',
                merchant_id='merchant', integration_id='integration', goal_id='goal', request_fingerprint='fingerprint'),
            authorization=dict(channel='card', reusable=True, authorization_code=auth['authorizationCode'],
                signature=auth['signature'], brand='visa', last4='4081', exp_month='12', exp_year='2030'))
        self.value = dict(kind='independently-verified-test-collection',
            verifiedAt=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            intent=self.intent, collection=collection, newPaymentStarted=False,
            paidAt=self.data['paidAt'], rawResponse='', responseSha256='')

    def response(self, data=None):
        value = copy.deepcopy(self.value)
        value['rawResponse'] = json.dumps(dict(status=True, data=self.data if data is None else data))
        value['responseSha256'] = hashlib.sha256(value['rawResponse'].encode()).hexdigest()
        return value

    def test_preserves_exact_provider_proof_without_financial_writes(self):
        proof = reviewed_proof(self.response(), self.intent)
        self.assertTrue(proof['independentlyVerified'])
        self.assertEqual(proof['paidAt'], self.data['paidAt'])

    def test_mismatched_amount_metadata_and_provider_auth_refuse(self):
        for key, value in (('amount', 10001), ('domain', 'live'), ('status', 'pending'),
                           ('metadata', {}), ('reference', 'foreign'), ('channel', 'bank')):
            changed = {**self.data, key: value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                reviewed_proof(self.response(changed), self.intent)
        changed = copy.deepcopy(self.data)
        changed['authorization']['signature'] = 'other'
        with self.assertRaises(ValueError):
            reviewed_proof(self.response(changed), self.intent)

    def test_hash_stale_and_new_payment_flags_refuse(self):
        for key, value in (('responseSha256', 'f'*64), ('verifiedAt', '2026-01-01T00:00:00Z'),
                           ('newPaymentStarted', True), ('intent', {})):
            changed = {**self.response(), key: value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                reviewed_proof(changed, self.intent)


if __name__ == '__main__':
    unittest.main()
