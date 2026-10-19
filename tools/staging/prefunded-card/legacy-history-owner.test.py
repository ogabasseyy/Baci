import hashlib
from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import Mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
spec = importlib.util.spec_from_file_location(
    'legacy_history_owner', HERE / 'legacy-history-owner.py'
)
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)
from legacy_history_owner_proof import InvalidProof, run_mode, validate_proof


NOW = datetime(2026, 9, 27, 12, 0, tzinfo=timezone.utc)
SCOPE = {
    'systemIdentifier': '7685292944002592802',
    'integrationId': 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
    'businessId': '01M2381RG34HQJMHQKE7DWDACR',
    'merchantId': '10000000-0000-4000-8000-000000000001',
    'customerId': '10000000-0000-4000-8000-000000000002',
    'goalId': '430314fd-cd8b-4579-98d4-e9f345713dd6',
    'providerWalletId': '01M3CQX27G9687EFSF1TKYMPR9',
    'providerCustomerId': 'c096507d-dc32-45d2-9c01-871a27abfd10',
    'currency': 'NGN',
}


def report():
    credit = {
        'receiptId': 'receipt-fixed', 'payloadSha256': 'a' * 64,
        'originalPayloadIntegrity': 'aead_authenticated',
        'provenance': 'provider_reconciliation', 'signatureStatus': 'unavailable',
        'legacyProviderTransactionId': 'legacy-id', 'contributionId': 'contribution-id',
        'observation': {
            'amountKobo': 10000, 'currency': 'NGN', 'status': 'verified',
            'kind': 'bank_inflow', 'providerTransactionId': "txn'\\;SELECT 1--",
        },
        'providerReconciliation': {
            'transactionId': "txn'\\;SELECT 1--", 'responseSha256': 'b' * 64,
            'retrievedAt': '2026-09-27T11:59:00Z',
        },
    }
    return {
        'appSystemIdentifier': SCOPE['systemIdentifier'],
        'receiptSystemIdentifier': '7686901100561231906',
        'integrationId': SCOPE['integrationId'], 'businessId': SCOPE['businessId'],
        'merchantId': SCOPE['merchantId'], 'customerId': SCOPE['customerId'],
        'goalId': SCOPE['goalId'], 'providerWalletId': SCOPE['providerWalletId'],
        'providerCustomerId': SCOPE['providerCustomerId'], 'principalKobo': 10000,
        'changesMade': False,
        'history': [{'legacyProviderTransactionId': 'legacy-id'}],
        'proofs': [{'legacyProviderTransactionId': 'legacy-id'}],
        'ownerSealed': {
            'schemaVersion': 1, 'verifiedAt': '2026-09-27T12:00:00Z',
            'scope': dict(SCOPE), 'credits': [credit],
        },
    }


class LegacyHistoryOwnerTests(unittest.TestCase):
    def test_rejects_wrong_scope_and_invalid_amount(self):
        value = report()
        value['ownerSealed']['scope']['goalId'] = 'wrong'
        with self.assertRaises(InvalidProof):
            validate_proof(value, NOW)
        value = report()
        value['ownerSealed']['credits'][0]['observation']['amountKobo'] = 9999
        with self.assertRaises(InvalidProof):
            validate_proof(value, NOW)

    def test_rejects_wrong_signature_status_and_stale_proof(self):
        value = report()
        value['ownerSealed']['credits'][0]['signatureStatus'] = 'verified'
        with self.assertRaises(InvalidProof):
            validate_proof(value, NOW)
        value = report()
        value['ownerSealed']['verifiedAt'] = '2026-09-27T11:44:59Z'
        with self.assertRaises(InvalidProof):
            validate_proof(value, NOW)

    def test_json_proof_injection_escapes_apostrophe_and_backslash(self):
        validated = validate_proof(report(), NOW)
        sql = owner.inject_proof('SELECT ' + owner.PROOF_MARKER + ';', validated)
        self.assertTrue(sql.startswith('SET standard_conforming_strings = on;'))
        self.assertIn("txn''\\\\;SELECT 1--", sql)
        self.assertEqual(sql.count(owner.PROOF_MARKER), 0)

    def test_missing_or_changed_bundle_files_are_refused(self):
        contents = {'one.sql': b'sql', 'two.sql': b'include'}
        expected = {name: hashlib.sha256(data).hexdigest() for name, data in contents.items()}
        owner.verify_bundle_files(expected, contents)
        with self.assertRaises(owner.Refused):
            owner.verify_bundle_files(expected, {'one.sql': contents['one.sql']})
        changed = {**contents, 'two.sql': b'changed'}
        with self.assertRaises(owner.Refused):
            owner.verify_bundle_files(expected, changed)

    def test_manifest_is_fixed_to_pinned_sql_scope(self):
        files = {'legacy-enrollment-candidate.sql': 'a' * 64,
                 'legacy-enrollment-scope-preflight.sql': 'b' * 64,
                 'legacy-enrollment-preflight.sql': 'c' * 64}
        manifest = {
            'schemaVersion': 1, 'container': owner.CONTAINER,
            'database': owner.DATABASE, 'systemIdentifier': owner.SYSTEM_IDENTIFIER,
            'deadline': owner.DEADLINE, 'files': files,
        }
        parsed = owner.parse_manifest(
            manifest, owner.CONTAINER, owner.DATABASE, owner.SYSTEM_IDENTIFIER,
            owner.DEADLINE, owner.CANDIDATE_NAME, owner.MAX_BUNDLE_FILES,
            owner.FILE_RE, owner.SHA_RE,
        )
        self.assertEqual(parsed, files)
        manifest['container'] = 'other'
        with self.assertRaises(InvalidProof):
            owner.parse_manifest(
                manifest, owner.CONTAINER, owner.DATABASE, owner.SYSTEM_IDENTIFIER,
                owner.DEADLINE, owner.CANDIDATE_NAME, owner.MAX_BUNDLE_FILES,
                owner.FILE_RE, owner.SHA_RE,
            )

    def test_actual_candidate_includes_flatten_and_terminal_result(self):
        names = (
            'legacy-enrollment-candidate.sql', 'legacy-enrollment-scope-preflight.sql',
            'legacy-enrollment-preflight.sql',
        )
        contents = {name: (HERE / name).read_bytes() for name in names}
        flattened = owner.flatten_sql(contents)
        owner.validate_sql_pins(flattened)
        self.assertIn("SELECT 'migrated' AS legacy_enrollment_result", flattened)
        self.assertIn("SELECT 'already_complete' AS legacy_enrollment_result", flattened)
        injected = owner.inject_proof(flattened, validate_proof(report(), NOW))
        self.assertEqual(injected.count(owner.PROOF_MARKER), 0)
        self.assertIn("SET standard_conforming_strings = on;", injected)

    def test_check_mode_never_calls_dispatcher(self):
        dispatcher = Mock(side_effect=AssertionError('unexpected DB call'))
        result = run_mode(True, 'SQL', 'f' * 64, dispatcher)
        self.assertFalse(result['databaseContacted'])
        self.assertFalse(result['changesMade'])
        dispatcher.assert_not_called()

    def test_apply_reader_preserves_confirmed_success_statuses(self):
        applied = run_mode(False, 'SQL', 'f' * 64, lambda _sql: True)
        complete = run_mode(False, 'SQL', 'f' * 64, lambda _sql: False)
        self.assertEqual(applied['status'], 'applied')
        self.assertIs(applied['changesMade'], True)
        self.assertEqual(complete['status'], 'already-complete')
        self.assertIs(complete['changesMade'], False)

    def test_apply_requires_terminal_marker_and_reports_unknown_conservatively(self):
        def runner_for(stdout, returncode=0):
            return lambda *_args, **kwargs: subprocess.CompletedProcess(
                args=kwargs, returncode=returncode, stdout=stdout, stderr='private error'
            )

        result = owner.apply_sql('proof-not-argv', runner_for('migrated\n'))
        self.assertIs(result, True)
        result = owner.apply_sql('proof-not-argv', runner_for('already_complete\n'))
        self.assertIs(result, False)
        unknown = owner.apply_sql('proof-not-argv', runner_for('other\n'))
        self.assertIsNone(unknown['changesMade'])
        self.assertEqual(unknown['diagnostic']['failure'], 'unknown-terminal-marker')
        failed = owner.apply_sql('proof-not-argv', runner_for('', 1))
        self.assertIsNone(failed['changesMade'])
        self.assertEqual(failed['diagnostic']['exitCode'], 1)
        self.assertEqual(failed['diagnostic']['failure'], 'nonzero-exit')
        result = run_mode(False, 'SQL', 'f' * 64, lambda _sql: None)
        self.assertEqual(result['status'], 'apply-unconfirmed')
        self.assertIsNone(result['changesMade'])

    def test_failed_subprocess_exposes_only_sqlstate_and_safe_diagnostic(self):
        secret = 'password=do-not-print SELECT secret_table'
        stderr = f'ERROR:  42501\nDETAIL: {secret}\n'
        runner = lambda *_args, **_kwargs: subprocess.CompletedProcess(
            args=['psql'], returncode=1, stdout='', stderr=stderr
        )
        outcome = owner.apply_sql('sensitive SQL', runner)
        result = run_mode(False, 'sensitive SQL', 'f' * 64, lambda _sql: outcome)
        self.assertEqual(result['status'], 'apply-unconfirmed')
        self.assertIsNone(result['changesMade'])
        self.assertEqual(result['diagnostic']['sqlState'], '42501')
        self.assertEqual(result['diagnostic']['phase'], 'subprocess')
        self.assertNotIn(secret, repr(result))
        self.assertNotIn(secret, repr(outcome))

    def test_timeout_reports_timeout_without_exception_output(self):
        secret = 'token=do-not-print'

        def timeout(*_args, **_kwargs):
            raise subprocess.TimeoutExpired('psql', 90, stderr=secret)

        outcome = owner.apply_sql('sensitive SQL', timeout)
        result = run_mode(False, 'sensitive SQL', 'f' * 64, lambda _sql: outcome)
        self.assertEqual(result['status'], 'apply-unconfirmed')
        self.assertIsNone(result['changesMade'])
        self.assertTrue(result['diagnostic']['timedOut'])
        self.assertEqual(result['diagnostic']['failure'], 'timeout')
        self.assertNotIn(secret, repr(result))

    def test_unknown_terminal_marker_does_not_claim_changes_or_echo_output(self):
        secret = 'private-row-detail'
        runner = lambda *_args, **_kwargs: subprocess.CompletedProcess(
            args=['psql'], returncode=0, stdout=f'{secret}\n', stderr=''
        )
        outcome = owner.apply_sql('sensitive SQL', runner)
        result = run_mode(False, 'sensitive SQL', 'f' * 64, lambda _sql: outcome)
        self.assertEqual(result['status'], 'apply-unconfirmed')
        self.assertIsNone(result['changesMade'])
        self.assertEqual(result['diagnostic']['failure'], 'unknown-terminal-marker')
        self.assertNotIn(secret, repr(result))

    def test_apply_passes_sql_only_on_stdin_with_bounded_psql_command(self):
        captured = {}
        sql = "SET standard_conforming_strings = on; SELECT 'proof''\\\\data';"

        def runner(command, **options):
            captured['command'] = command
            captured['options'] = options
            return subprocess.CompletedProcess(command, 0, stdout='migrated\n', stderr='')

        self.assertIs(owner.apply_sql(sql, runner), True)
        self.assertEqual(captured['options']['input'], sql)
        self.assertEqual(captured['options']['timeout'], 90)
        self.assertFalse(captured['options']['shell'])
        self.assertIn('-qAt', captured['command'])
        self.assertIn('VERBOSITY=sqlstate', captured['command'])
        self.assertNotIn('proof', ' '.join(captured['command']))

    def test_timeout_is_unconfirmed_not_unchanged(self):
        def timeout(*_args, **_kwargs):
            raise subprocess.TimeoutExpired('psql', 90)

        result = run_mode(False, 'SQL', 'f' * 64, lambda sql: owner.apply_sql(sql, timeout))
        self.assertEqual(result['status'], 'apply-unconfirmed')
        self.assertIsNone(result['changesMade'])

    def test_relative_or_symlinked_root_bundle_path_is_refused(self):
        with self.assertRaises(owner.Refused):
            owner.assert_root_directory('relative/path')
        with self.assertRaises(owner.Refused):
            owner.assert_root_directory('/tmp')


if __name__ == '__main__':
    unittest.main()
