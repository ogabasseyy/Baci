import unittest

from policy_contract import validate_evidence
from policy_test_fixture import policy_test_fixture


class ContractTests(unittest.TestCase):
    def test_accepts_all_required_sanitized_evidence_shapes(self):
        bundle, _ = policy_test_fixture()
        for record in bundle['evidence']:
            self.assertTrue(validate_evidence(record))

    def test_refuses_malformed_or_secret_bearing_evidence_without_throwing(self):
        bundle, _ = policy_test_fixture()
        valid = bundle['evidence'][0]
        for record in (None, [], {}, {'kind': []}, {**valid, 'provenance': []},
                       {**valid, 'token': 'do-not-log-this'},
                       {**valid, 'apiCustomerId': ' leading-space'},
                       {**valid, 'provenance': 'caller_claim'}):
            with self.subTest(record_type=type(record).__name__):
                self.assertFalse(validate_evidence(record))

    def test_refuses_coerced_boolean_and_numeric_evidence(self):
        bundle, _ = policy_test_fixture()
        wallet = next(record for record in bundle['evidence'] if record['kind'] == 'wallet')
        binding = next(record for record in bundle['evidence'] if record['kind'] == 'goal_binding')
        for value in (1, 'true', None):
            self.assertFalse(validate_evidence({**wallet, 'interestEnabled': value}))
        for value in (True, 10000.0, '10000', -1, 9007199254740992):
            self.assertFalse(validate_evidence({**binding, 'principalKobo': value}))


if __name__ == '__main__':
    unittest.main()
