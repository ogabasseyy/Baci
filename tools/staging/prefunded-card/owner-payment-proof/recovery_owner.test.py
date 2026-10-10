import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import recovery_owner


class OwnerRecoveryDriverTests(unittest.TestCase):
    def test_default_renderer_never_enables_apply(self):
        with patch.object(recovery_owner, 'execute', return_value='ROLLBACK;') as execute:
            self.assertEqual(recovery_owner.render({'proof': 'fixture'}), 'ROLLBACK;')
        command, payload = execute.call_args.args
        self.assertIn('-I', command)
        parsed = json.loads(payload)
        self.assertNotIn('mode', parsed)
        self.assertNotIn('now', parsed)
        self.assertEqual(parsed['reviewed_sha256'], recovery_owner.digest(parsed['bundle']))

    def test_apply_renderer_requires_exact_receipt_hash(self):
        receipt = dict(rolledBack=True, independentlyReviewed=True)
        with patch.object(recovery_owner, 'execute', return_value='COMMIT;') as execute:
            recovery_owner.render({'proof': 'fixture'}, receipt)
        parsed = json.loads(execute.call_args.args[1])
        self.assertEqual(parsed['mode'], 'apply')
        self.assertEqual(parsed['reviewed_receipt_sha256'], recovery_owner.digest(receipt))

    def test_foreign_apply_path_refuses_before_database_contact(self):
        with patch.object(recovery_owner, 'snapshot') as snapshot:
            with self.assertRaises(AssertionError):
                recovery_owner.apply({}, '/tmp/foreign/attempt-fixture', 'a'*64, 'b'*64)
            snapshot.assert_not_called()

    def test_bundle_pin_drift_refuses_before_database_contact(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            audit = root / 'attempt-fixture'
            audit.mkdir()
            (audit / 'bundle.json').write_text('{}')
            (audit / 'rollback-receipt.json').write_text('{}')
            with patch.object(recovery_owner, 'SOURCE', root), patch.object(recovery_owner, 'snapshot') as snapshot:
                with self.assertRaises(AssertionError):
                    recovery_owner.apply({}, str(audit), 'a'*64, 'b'*64)
                snapshot.assert_not_called()


if __name__ == '__main__':
    unittest.main()
