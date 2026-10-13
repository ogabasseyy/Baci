import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock


spec = importlib.util.spec_from_file_location('verify_denials', Path(__file__).with_name('verify-denials.py'))
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class VerificationTests(unittest.TestCase):
    def capability(self, enabled=False):
        return dict(goalId=verify.GOAL, enabled=enabled,
                    maximumAmountKobo=10000 if enabled else 0, currency='NGN')

    def test_aborts_before_post_or_patch_if_readonly_capability_is_not_proven(self):
        send = Mock(return_value=(200, self.capability(True)))
        with self.assertRaises(ValueError):
            verify.verify({'Authorization': 'secret'}, send)
        self.assertEqual(send.call_count, 1)

    def test_verifies_owned_get_and_denied_mutations_without_logging_headers(self):
        denied = dict(error='First-card savings checkout unavailable', code='PREFUNDED_CARD_CHECKOUT_UNAVAILABLE')
        send = Mock(side_effect=[(200, self.capability()), (503, denied), (503, denied)])
        result = verify.verify({'Authorization': 'secret'}, send)
        self.assertEqual([row['http'] for row in result['checks']], [200, 503, 503])
        self.assertNotIn('secret', str(result))
        self.assertFalse(result['newPaymentStarted'])

    def test_does_not_accept_successful_or_unexpected_mutation_response(self):
        for status in (200, 202, 400, 403, 502):
            send = Mock(side_effect=[(200, self.capability()), (status, {})])
            with self.assertRaises(ValueError):
                verify.verify({}, send)
            self.assertEqual(send.call_count, 2)


if __name__ == '__main__':
    unittest.main()
