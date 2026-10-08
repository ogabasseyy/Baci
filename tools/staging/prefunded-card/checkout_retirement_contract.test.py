import json
from pathlib import Path
import unittest

import checkout_retirement_contract as contract
from treasury_owner_contract import Refused


class ContractTests(unittest.TestCase):
    def report(self):
        return dict(systemIdentifier=contract.SYSTEM, database='postgres', withinDeadline=True,
                    intentId=contract.INTENT, phase='pending', amountKobo=10000, reference=contract.REFERENCE,
                    principalKobo=10000.0, reservedKobo=10000, consumedKobo=0, hasCheckoutUrl=False,
                    collectionStatus='pending', transferStatus='not_started', projectionStatus='unapplied',
                    operationCount=1, intentCount=1, requestFingerprint='a' * 64, protected='b' * 64)

    def test_accepts_numeric_principal_but_rejects_wrong_scope_or_advanced_state(self):
        contract.validate(self.report())
        for key, value in (('systemIdentifier', '1'), ('amountKobo', 10001), ('principalKobo', 0),
                           ('hasCheckoutUrl', True), ('reservedKobo', 0), ('consumedKobo', 1),
                           ('phase', 'ready'), ('collectionStatus', 'verified_success'),
                           ('operationCount', 2), ('withinDeadline', False), ('protected', "'bad")):
            with self.subTest(key=key), self.assertRaises(Refused):
                contract.validate({**self.report(), key: value})

    def test_rehearsal_and_apply_include_same_guards_and_only_one_atomic_release(self):
        directory = Path(__file__).parent
        evidence = dict(providerResult='transaction_not_found', note="not 'failed'")
        live = contract.render_transaction(directory, self.report(), evidence)
        rehearsal = contract.render_transaction(directory, self.report(), evidence, rehearsal=True)
        self.assertEqual(live.removesuffix('COMMIT;'), rehearsal.removesuffix('ROLLBACK;'))
        self.assertIn(contract.INTENT, live)
        self.assertIn(contract.SYSTEM, live)
        self.assertIn('retired_unconfirmed', live)
        self.assertIn("not ''failed''", live)
        self.assertNotIn('DISABLE TRIGGER', live)
        self.assertEqual(live.count('SET reserved_kobo=reserved_kobo-intent.amount_kobo'), 1)
        self.assertNotIn('paystackSecret', json.dumps(contract.approval(self.report(), evidence)))


if __name__ == '__main__':
    unittest.main()
