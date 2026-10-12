import importlib.util
from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).parent))
specification = importlib.util.spec_from_file_location('checkout', Path(__file__).with_name('phone-checkout-readback.py'))
checkout = importlib.util.module_from_spec(specification)
specification.loader.exec_module(checkout)


class CheckoutReadbackTests(unittest.TestCase):
    def fixture(self):
        return dict(goalId=checkout.GOAL, enabled=True, maximumAmountKobo=10000, currency='NGN')

    def test_reports_capability_without_claiming_a_payment(self):
        report = checkout.summarize(self.fixture())
        self.assertTrue(report['firstCardEnabled'])
        self.assertFalse(report['newPaymentStarted'])
        self.assertFalse(report['financialChangesMade'])

    def test_denies_extra_fields_wrong_goal_and_overspending(self):
        for change in (dict(authorizationUrl='private'), dict(goalId='foreign'),
                       dict(maximumAmountKobo=10001), dict(maximumAmountKobo=True),
                       dict(maximumAmountKobo=0), dict(enabled='true')):
            with self.subTest(change=change), self.assertRaises(ValueError):
                checkout.summarize({**self.fixture(), **change})

    def test_reports_disabled_capability_honestly(self):
        report = checkout.summarize({**self.fixture(), 'enabled': False, 'maximumAmountKobo': 0})
        self.assertFalse(report['firstCardEnabled'])


if __name__ == '__main__':
    unittest.main()
