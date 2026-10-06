#!/usr/bin/env python3
"""Unit tests for the staging verification helpers (no network, no token)."""

import importlib.util
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load():
    spec = importlib.util.spec_from_file_location(
        'funding_staging_payloads', HERE / 'funding-staging-payloads.py'
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


payloads = _load()


class PayloadHelperTest(unittest.TestCase):
    def test_goal_ids_handles_list_shapes(self):
        self.assertEqual(
            payloads.goal_ids([{'id': 'a'}, {'id': 'b'}, {'nope': 1}]),
            ['a', 'b'],
        )
        self.assertEqual(
            payloads.goal_ids({'goals': [{'id': 'a'}]}), ['a']
        )
        self.assertEqual(payloads.goal_ids({'goals': []}), [])
        self.assertEqual(payloads.goal_ids({}), [])

    def test_created_goal_id_prefers_rows_then_scalar_keys(self):
        self.assertEqual(
            payloads.created_goal_id({'goals': [{'id': 'a'}]}), 'a'
        )
        self.assertEqual(payloads.created_goal_id({'goalId': 'b'}), 'b')
        self.assertEqual(payloads.created_goal_id({'goal_id': 'c'}), 'c')
        self.assertIsNone(payloads.created_goal_id({'error': 'x'}))

    def test_wallet_shape_ok(self):
        good = {
            'status': 'ready',
            'balanceKobo': 100,
            'paidInterestKobo': 0,
        }
        self.assertTrue(payloads.wallet_shape_ok(good))
        self.assertTrue(payloads.wallet_shape_ok({**good, 'status': 'none'}))
        self.assertFalse(payloads.wallet_shape_ok({**good, 'status': 'bogus'}))
        self.assertFalse(payloads.wallet_shape_ok({**good, 'balanceKobo': 'x'}))
        self.assertFalse(payloads.wallet_shape_ok({'status': 'ready'}))

    def test_goal_body_is_manual_and_idempotent_keyed(self):
        body = payloads.goal_body('m', 'p', 'stamp', 100, 'key-1')
        self.assertEqual(body['sourceMode'], 'manual')
        self.assertEqual(body['initialContributionIdempotencyKey'], 'key-1')
        self.assertTrue(body['termsAccepted'])
        self.assertTrue(body['nonWithdrawableAccepted'])
        keyed = payloads.goal_body('m', 'p', 'stamp', goal_key='goal-1')
        self.assertEqual(keyed['goalIdempotencyKey'], 'goal-1')
        plain = payloads.goal_body('m', 'p', 'stamp')
        self.assertNotIn('initialContributionIdempotencyKey', plain)
        self.assertNotIn('goalIdempotencyKey', plain)
        self.assertEqual(plain['initialContributionAmount'], 0)
        self.assertNotIn('variantId', plain)
        self.assertEqual(
            payloads.goal_body('m', 'p', 'stamp', variant_id='v')['variantId'],
            'v',
        )


if __name__ == '__main__':
    unittest.main()
