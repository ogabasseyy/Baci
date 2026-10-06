import importlib.util
import os
import tempfile
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    'renewal', Path(__file__).with_name('renew-isolated-savings-staging.py')
)
renewal = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(renewal)


class RenewalPolicyTests(unittest.TestCase):
    def test_renewal_deadline_is_exactly_seven_days_after_activation(self):
        self.assertEqual(renewal.renewal_expiry(1_789_991_000), 1_790_595_800)

    def test_regression_rejects_a_deadline_longer_than_owner_approved_week(self):
        with self.assertRaisesRegex(renewal.Refused, 'seven days'):
            renewal.validate_renewal_window(1_789_991_000, 1_790_595_801)

    def test_regression_preserves_original_receipt_bytes_when_archiving_expired_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / 'config'
            archive = root / 'archive'
            config.mkdir()
            original = b'{"verifiedAt":"2026-09-20T00:00:00.000Z"}\n'
            (config / 'startup-evidence.json').write_bytes(original)
            (config / 'binding.json').write_bytes(b'{"old":true}\n')

            archived = renewal.archive_expired_gateway_files(
                config, archive, owner_uid=os.getuid()
            )

            self.assertEqual(
                (archive / 'startup-evidence.json').read_bytes(), original
            )
            self.assertEqual(archived, ('binding.json', 'startup-evidence.json'))
            self.assertEqual(list(config.iterdir()), [])

    def test_regression_refuses_to_retimestamp_or_replace_an_existing_renewal_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / 'renewal-receipt.json'
            receipt.write_text('{"verifiedAt":"old"}\n', encoding='utf-8')

            with self.assertRaisesRegex(renewal.Refused, 'renewal receipt'):
                renewal.require_absent(receipt, 'renewal receipt')

    def test_draft_unit_update_changes_only_expiry_and_runtime_cap(self):
        old = (
            'ExecCondition=/bin/sh -c \'[ "$(/bin/date -u +%%s)" -lt 1789989845 ]\'\n'
            'RuntimeMaxSec=1d\n'
            'Environment=NEXT_PUBLIC_SUPABASE_ANON_KEY=not-printed\n'
        )
        updated = renewal.renew_draft_service(old, 1_790_595_800)

        self.assertIn('1790595800', updated)
        self.assertIn('RuntimeMaxSec=7d', updated)
        self.assertIn('NEXT_PUBLIC_SUPABASE_ANON_KEY=not-printed', updated)

    def test_regression_refuses_unexpected_draft_unit_shape(self):
        with self.assertRaisesRegex(renewal.Refused, 'draft service'):
            renewal.renew_draft_service('RuntimeMaxSec=1d\n', 1_790_595_800)


if __name__ == '__main__':
    unittest.main()
