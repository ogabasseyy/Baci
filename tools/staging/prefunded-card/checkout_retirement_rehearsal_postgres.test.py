import hashlib
import importlib.util
from pathlib import Path
import re
import subprocess
import unittest
from unittest.mock import patch

from checkout_retirement_patches import definitions
from checkout_retirement_rehearsal import annotate, function_metadata, safe_result


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('rehearsal_transaction_fixture', HERE / 'checkout_retirement_transaction.test.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)


class RehearsalPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture_type = FIXTURE.CheckoutRetirementTransactionTests
        fixture_type.setUpClass()
        cls.addClassCleanup(fixture_type.doClassCleanups)
        cls.fixture = fixture_type()

    def test_real_rehearsal_markers_identify_refusal_and_never_persist_changes(self):
        fixture = self.fixture
        before = fixture.snapshot()
        persisted = fixture.persisted_state()
        original = fixture.render(before, rehearsal=True)
        baseline = hashlib.sha256(definitions(HERE)[0][1].encode()).hexdigest()
        wrong_pin = original.replace(baseline, 'b' * 64, 1)
        for source, expected_status, expected_check, expected_code in (
                (original, 'rolled-back', 'rolled-back', None),
                (wrong_pin, 'refused', 'function-guard_operation', '55000')):
            with self.subTest(status=expected_status):
                sql, labels = annotate(source, HERE)
                result = subprocess.run([
                    str(FIXTURE.CHECKOUT.CUSTOMER.MODULE.BIN / 'psql'), '-XqAt', '-v', 'ON_ERROR_STOP=1',
                    '-v', 'VERBOSITY=verbose', '-h', str(fixture.db.path), '-p', '55461',
                    '-U', 'harness_admin', '-d', 'postgres',
                ], input=sql, capture_output=True, text=True, timeout=60)
                report = safe_result(result, labels)
                self.assertEqual(report['status'], expected_status)
                self.assertEqual(report['failedCheck'], expected_check)
                self.assertEqual(report['sqlState'], expected_code)
                self.assertEqual(fixture.snapshot(), before)
                self.assertEqual(fixture.persisted_state(), persisted)

    def test_live_function_metadata_reports_each_pinned_body_without_exposing_it(self):
        import json
        with patch('checkout_retirement_rehearsal.probe', side_effect=lambda sql: json.loads(self.fixture.query(sql))):
            report = function_metadata(HERE)
        self.assertEqual(len(report), 11)
        self.assertTrue(all(item['bodyMatches'] and item['configurationMatches'] and item['languageMatches']
                            and item['definerMatches'] and item['present'] for item in report))
        self.assertTrue(all(item['ownerMatches'] is False for item in report))

    def test_identifies_exact_state_guard_hidden_by_original_42501_report(self):
        fixture = self.fixture
        before = fixture.snapshot()
        persisted = fixture.persisted_state()
        original = fixture.render(before, rehearsal=True)
        lease = ("UPDATE prefunded_card.operations SET verification_lease_expires_at="
                 "clock_timestamp()+interval '60 seconds';\n")
        active_lease = original.replace('SELECT prefunded_card.retire_unconfirmed_checkout(',
                                         lease + 'SELECT prefunded_card.retire_unconfirmed_checkout(', 1)
        wrong_fingerprint = re.sub(r'("requestFingerprint":")[a-f0-9]{64}',
                                   lambda match: match[1] + 'f' * 64, original)
        expired_evidence = re.sub(r'("verifiedAt":")[^"]+',
                                 lambda match: match[1] + '2026-01-01T00:00:00Z', original)
        for source, group, condition in (
                (active_lease, 'state', 'verification-lease-active'),
                (wrong_fingerprint, 'scope', 'approved-reference-or-fingerprint-mismatch'),
                (expired_evidence, 'state', 'provider-evidence-not-fresh')):
            with self.subTest(condition=condition):
                sql, labels = annotate(source, HERE)
                result = subprocess.run([
                    str(FIXTURE.CHECKOUT.CUSTOMER.MODULE.BIN / 'psql'), '-XqAt', '-v', 'ON_ERROR_STOP=1',
                    '-v', 'VERBOSITY=verbose', '-h', str(fixture.db.path), '-p', '55461',
                    '-U', 'harness_admin', '-d', 'postgres',
                ], input=sql, capture_output=True, text=True, timeout=60)
                report = safe_result(result, labels)
                self.assertEqual(report['status'], 'refused')
                self.assertEqual(report['sqlState'], '42501')
                self.assertEqual(report['guard'], dict(group=group, failedConditions=[condition]))
                self.assertEqual(fixture.snapshot(), before)
                self.assertEqual(fixture.persisted_state(), persisted)


if __name__ == '__main__':
    unittest.main()
