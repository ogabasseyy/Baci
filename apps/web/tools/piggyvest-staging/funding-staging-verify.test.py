#!/usr/bin/env python3
"""Unit tests for the staging verification helpers (no network, no token)."""

import importlib.util
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load():
    spec = importlib.util.spec_from_file_location(
        'funding_staging_verify', HERE / 'funding-staging-verify.py'
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


verify = _load()


class VerifyHelperTest(unittest.TestCase):
    def test_goal_ids_handles_list_shapes(self):
        self.assertEqual(
            verify.goal_ids([{'id': 'a'}, {'id': 'b'}, {'nope': 1}]),
            ['a', 'b'],
        )
        self.assertEqual(
            verify.goal_ids({'goals': [{'id': 'a'}]}), ['a']
        )
        self.assertEqual(verify.goal_ids({'goals': []}), [])
        self.assertEqual(verify.goal_ids({}), [])

    def test_created_goal_id_prefers_rows_then_scalar_keys(self):
        self.assertEqual(
            verify.created_goal_id({'goals': [{'id': 'a'}]}), 'a'
        )
        self.assertEqual(verify.created_goal_id({'goalId': 'b'}), 'b')
        self.assertEqual(verify.created_goal_id({'goal_id': 'c'}), 'c')
        self.assertIsNone(verify.created_goal_id({'error': 'x'}))

    def test_wallet_shape_ok(self):
        good = {
            'status': 'ready',
            'balanceKobo': 100,
            'paidInterestKobo': 0,
        }
        self.assertTrue(verify.wallet_shape_ok(good))
        self.assertTrue(verify.wallet_shape_ok({**good, 'status': 'none'}))
        self.assertFalse(verify.wallet_shape_ok({**good, 'status': 'bogus'}))
        self.assertFalse(verify.wallet_shape_ok({**good, 'balanceKobo': 'x'}))
        self.assertFalse(verify.wallet_shape_ok({'status': 'ready'}))

    def test_goal_body_is_manual_and_idempotent_keyed(self):
        body = verify.goal_body('m', 'p', 'stamp', 100, 'key-1')
        self.assertEqual(body['sourceMode'], 'manual')
        self.assertEqual(body['initialContributionIdempotencyKey'], 'key-1')
        self.assertTrue(body['termsAccepted'])
        self.assertTrue(body['nonWithdrawableAccepted'])
        keyed = verify.goal_body('m', 'p', 'stamp', goal_key='goal-1')
        self.assertEqual(keyed['goalIdempotencyKey'], 'goal-1')
        plain = verify.goal_body('m', 'p', 'stamp')
        self.assertNotIn('initialContributionIdempotencyKey', plain)
        self.assertNotIn('goalIdempotencyKey', plain)
        self.assertEqual(plain['initialContributionAmount'], 0)
        self.assertNotIn('variantId', plain)
        self.assertEqual(
            verify.goal_body('m', 'p', 'stamp', variant_id='v')['variantId'],
            'v',
        )


if __name__ == '__main__':
    unittest.main()
