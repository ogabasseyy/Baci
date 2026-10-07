#!/usr/bin/env python3
"""Unit tests for staging verification scenarios (transport stubbed)."""

import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def _load():
    spec = importlib.util.spec_from_file_location(
        'funding_staging_scenarios', HERE / 'funding-staging-scenarios.py'
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


scenarios = _load()


class ScenarioTest(unittest.TestCase):
    def test_discover_product_passes_through_a_given_product(self):
        steps = []
        with patch.object(scenarios, '_request') as request:
            ok, product_id = scenarios.discover_product(
                lambda *a: steps.append(a), 'rest', 'token', 'm', 'p-1', 15
            )

        self.assertTrue(ok)
        self.assertEqual(product_id, 'p-1')
        request.assert_not_called()
        self.assertEqual(steps[0][:2], ('discover-product', 'pass'))

    def test_contribution_idempotency_skips_when_wallet_unfunded(self):
        steps = []
        with patch.object(
            scenarios, '_request', return_value=(409, {'code': 'insufficient_balance'})
        ):
            ok, created = scenarios.check_contribution_idempotency(
                lambda *a: steps.append(a),
                'api',
                'merchantId=m',
                'token',
                'm',
                'p',
                'stamp',
                'v',
                50000,
                15,
                set(),
            )

        self.assertTrue(ok)
        self.assertEqual(created, 1)
        self.assertEqual(steps[0][:2], ('idempotency', 'skip'))

    def test_goal_key_idempotency_fails_when_changed_payload_accepted(self):
        steps = []
        calls = {'n': 0}

        def request(*args, **kwargs):
            calls['n'] += 1
            return (201, {'id': 'goal-c'})

        with patch.object(scenarios, '_request', side_effect=request):
            ok = scenarios.check_goal_key_idempotency(
                lambda *a: steps.append(a),
                'api',
                'merchantId=m',
                'token',
                'm',
                'p',
                'stamp',
                'v',
                50000,
                15,
                set(),
                2,
            )

        self.assertFalse(ok)
        self.assertEqual(calls['n'], 3)
        self.assertEqual(steps[0][0], 'goal-idempotency')
        self.assertEqual(steps[0][1], 'fail')


if __name__ == '__main__':
    unittest.main()
