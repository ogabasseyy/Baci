import copy
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from contract import digest, sha256
from renderer import render_transaction
from test_support import bundle, fixture_pin


class RendererTests(unittest.TestCase):
    def setUp(self):
        for pin in fixture_pin():
            pin.start()
            self.addCleanup(pin.stop)
        self.value = bundle()
        self.reviewed = digest(self.value)

    def test_render_transaction_rejects_unexpected_public_now_keyword(self):
        for mode in ('rollback', 'apply'):
            with self.subTest(mode=mode), self.assertRaisesRegex(TypeError, "unexpected keyword argument 'now'"):
                render_transaction(self.value, self.reviewed, mode=mode, now=None)

    def test_default_rollback_and_apply_requires_exact_independently_reviewed_receipt(self):
        rollback = render_transaction(self.value, self.reviewed)
        self.assertTrue(rollback.endswith('ROLLBACK;\n'))
        self.assertIn('SET SESSION AUTHORIZATION prefunded_authorizer;', rollback)
        self.assertNotIn('CREATE OR REPLACE FUNCTION prefunded_card.', rollback)
        self.assertNotIn('DISABLE TRIGGER', rollback)
        self.assertNotIn('GRANT EXECUTE ON FUNCTION prefunded_card.', rollback)
        receipt = dict(manifestSha256=self.reviewed, rollbackSqlSha256=sha256(rollback),
                       preflightSha256=digest(self.value['preflight']), rolledBack=True,
                       postflightPassed=True, independentlyReviewed=True, reviewedAt=self.value['proof']['verifiedAt'])
        applied = render_transaction(self.value, self.reviewed, mode='apply', receipt=receipt,
                                     reviewed_receipt_sha256=digest(receipt))
        self.assertEqual(applied, rollback.removesuffix('ROLLBACK;\n') + 'COMMIT;\n')
        for key in ('rolledBack', 'postflightPassed', 'independentlyReviewed', 'rollbackSqlSha256'):
            changed = copy.deepcopy(receipt)
            changed[key] = False if isinstance(changed[key], bool) else 'f' * 64
            with self.subTest(key=key), self.assertRaises(ValueError):
                render_transaction(self.value, self.reviewed, mode='apply', receipt=changed,
                                   reviewed_receipt_sha256=digest(changed))
        with self.assertRaises(ValueError):
            render_transaction(self.value, self.reviewed, mode='apply')
        observed = datetime.now(timezone.utc)
        future_receipt = {**receipt, 'reviewedAt': (observed + timedelta(seconds=1)).isoformat().replace('+00:00', 'Z')}
        with patch('renderer.datetime', wraps=datetime) as clock:
            clock.now.return_value = observed
            with self.assertRaisesRegex(ValueError, 'independently_reviewed_rollback_receipt'):
                render_transaction(self.value, self.reviewed, mode='apply', receipt=future_receipt,
                                   reviewed_receipt_sha256=digest(future_receipt))

    def test_secret_quotes_cannot_escape_bound_json_literal(self):
        self.value['collection']['authorization']['brand'] = "bank'; SELECT '$reviewed_call$"
        self.value['proof']['collectionSha256'] = digest(self.value['collection'])
        rendered = render_transaction(self.value, digest(self.value))
        self.assertIn("bank''; SELECT ''", rendered)
        self.assertNotIn('DO $reviewed_call$', rendered)

    def test_rollback_sql_is_identical_after_private_canonical_json_round_trip(self):
        original = render_transaction(self.value, self.reviewed)
        stored = json.loads(json.dumps(self.value, sort_keys=True, separators=(',', ':')))
        self.assertEqual(render_transaction(stored, self.reviewed), original)


if __name__ == '__main__':
    unittest.main()
