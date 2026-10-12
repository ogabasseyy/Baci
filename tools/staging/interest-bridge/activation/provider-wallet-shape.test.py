import hashlib
import importlib.util
import json
from pathlib import Path
import stat
from types import SimpleNamespace
from unittest.mock import patch
import unittest


SPEC = importlib.util.spec_from_file_location('provider_wallet_shape', Path(__file__).with_name('provider-wallet-shape.py'))
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)


class ProviderWalletShapeTests(unittest.TestCase):
    def test_reports_paths_and_types_without_personal_fields_or_raw_values(self):
        response = {
            'data': {
                'id': '01M3CQX27G9687EFSF1TKYMPR9',
                'customer_id': '01M2T3PAHG3P5A32REX8MH3HD7',
                'id_customer': 'c096507d-dc32-45d2-9c01-871a27abfd10',
                'name': 'private-name',
                'email': 'private@example.test',
                'phone': '+2348012345678',
                'bvn': '12345678901',
                'account_number': '0123456789',
                'third_party_identifier': 'baci-staging-probe',
                'unknown_string': 'must-not-be-logged',
                'interest_enabled': True,
            },
        }
        report = PROBE.summarize_response(response)
        rendered = str(report)
        self.assertIn({'path': 'data.id', 'type': 'string'}, report['fieldTypes'])
        self.assertIn({'path': 'data.interest_enabled', 'type': 'boolean'}, report['fieldTypes'])
        self.assertEqual(
            [(row['path'], row['kind'], row.get('value')) for row in report['identifiers']
             if 'value' in row],
            [
                ('data.id', 'wallet', '01M3CQX27G9687EFSF1TKYMPR9'),
                ('data.customer_id', 'customer', '01M2T3PAHG3P5A32REX8MH3HD7'),
                ('data.id_customer', 'customer', 'c096507d-dc32-45d2-9c01-871a27abfd10'),
            ],
        )
        third_party = next(row for row in report['identifiers'] if row['kind'] == 'third_party_identifier')
        self.assertEqual(third_party['sha256'], hashlib.sha256(b'baci-staging-probe').hexdigest())
        self.assertTrue(third_party['valueOmitted'])
        for forbidden in ('private-name', 'private@example.test', '+2348012345678', '12345678901',
                          '0123456789', 'must-not-be-logged', 'baci-staging-probe'):
            self.assertNotIn(forbidden, rendered)

    def test_alias_requires_both_identifiers_on_the_same_provider_object(self):
        proven = PROBE.summarize_response({'data': {
            'customer_id': PROBE.API_CUSTOMER_ID,
            'id_customer': PROBE.WEBHOOK_CUSTOMER_ID,
        }})
        self.assertEqual(proven['identityAliasEvidence']['status'], 'same-record-link-observed')
        self.assertEqual(proven['identityAliasEvidence']['relations'][0]['containerPath'], 'data')
        different_relational_id = PROBE.summarize_response({'data': {
            'customer_id': PROBE.API_CUSTOMER_ID,
            'id_customer': 'd096507d-dc32-45d2-9c01-871a27abfd10',
        }})
        self.assertEqual(different_relational_id['identityAliasEvidence']['status'],
                         'not-proven-by-wallet-response')
        unproven = PROBE.summarize_response({'data': {'customer_id': PROBE.API_CUSTOMER_ID},
                                             'other': {'id_customer': PROBE.WEBHOOK_CUSTOMER_ID}})
        self.assertEqual(unproven['identityAliasEvidence']['status'], 'not-proven-by-wallet-response')
        self.assertEqual(unproven['identityAliasEvidence']['relations'], [])

    def test_parses_bounded_provider_payload_without_emitting_its_raw_string(self):
        nested = {
            'customer_id': PROBE.API_CUSTOMER_ID,
            'id_customer': PROBE.WEBHOOK_CUSTOMER_ID,
            'faas_wallet_identifier': '01M3CQX27G9687EFSF1TKYMPR9',
            'parent_wallet_id': '01M3W0Y93XHJY9RPQ2G75X81WG',
            'third_party_identifier': 'contact@example.test',
            'email': 'secret@example.test',
        }
        raw_payload = json.dumps(nested)
        report = PROBE.summarize_response({'data': {
            'faas_wallet_identifier': '01M3CQX27G9687EFSF1TKYMPR9',
            'provider_payload': raw_payload,
        }})
        rendered = json.dumps(report)
        self.assertEqual(report['providerPayloads'], [{'path': 'data.provider_payload', 'status': 'parsed'}])
        paths = {item['path'] for item in report['fieldTypes']}
        self.assertIn('data.provider_payload<json>.customer_id', paths)
        self.assertIn('data.provider_payload<json>.id_customer', paths)
        identifiers = {item['path']: item for item in report['identifiers']}
        self.assertEqual(identifiers['data.faas_wallet_identifier']['kind'], 'wallet')
        self.assertEqual(identifiers['data.provider_payload<json>.faas_wallet_identifier']['kind'], 'wallet')
        self.assertEqual(identifiers['data.provider_payload<json>.parent_wallet_id']['kind'], 'wallet')
        self.assertEqual(report['identityAliasEvidence']['status'], 'same-record-link-observed')
        for hidden in (raw_payload, 'contact@example.test', 'secret@example.test'):
            self.assertNotIn(hidden, rendered)

    def test_provider_wallet_identity_is_whitelisted_only_at_exact_event_path(self):
        expected_id = 'c096507d-dc32-45d2-9c01-871a27abfd10'
        unrelated_id = 'd096507d-dc32-45d2-9c01-871a27abfd10'
        raw_payload = json.dumps({'eventData': {'identifier': expected_id},
                                  'private': {'identifier': unrelated_id}})
        report = PROBE.summarize_response({'data': {'provider_payload': raw_payload}})
        matches = [row for row in report['identifiers'] if row['kind'] == 'provider_wallet_identity']
        self.assertEqual(matches, [{'path': 'data.provider_payload<json>.eventData.identifier',
                                   'kind': 'provider_wallet_identity', 'value': expected_id}])
        rendered = json.dumps(report)
        self.assertNotIn(raw_payload, rendered)
        self.assertNotIn(unrelated_id, rendered)

    def test_wallet_meta_parsing_is_bounded_redacted_and_uses_existing_identifier_whitelist(self):
        wallet_meta = json.dumps({'faas_wallet_identifier': '01M3CQX27G9687EFSF1TKYMPR9',
                                  'eventData': {'identifier': PROBE.WEBHOOK_CUSTOMER_ID},
                                  'email': 'private@example.test'})
        report = PROBE.summarize_response({'data': {'wallet_meta': wallet_meta}})
        self.assertEqual(report['walletMeta'], [{'path': 'data.wallet_meta', 'status': 'parsed'}])
        ids = {row['path']: row for row in report['identifiers']}
        self.assertEqual(ids['data.wallet_meta<json>.faas_wallet_identifier']['kind'], 'wallet')
        self.assertNotIn('data.wallet_meta<json>.eventData.identifier', ids)
        rendered = json.dumps(report)
        self.assertNotIn(wallet_meta, rendered)
        self.assertNotIn('private@example.test', rendered)

        malformed = PROBE.summarize_response({'wallet_meta': 'private-malformed-meta'})
        self.assertEqual(malformed['walletMeta'][0]['status'], 'invalid-json')
        oversized_text = 'x' * (PROBE.MAX_PROVIDER_PAYLOAD_BYTES + 1)
        oversized = PROBE.summarize_response({'wallet_meta': oversized_text})
        self.assertEqual(oversized['walletMeta'][0]['status'], 'size-limit')
        self.assertNotIn(oversized_text, json.dumps(oversized))

    def test_compares_customer_aliases_only_across_the_two_target_wallets(self):
        shared = [
            {'walletProbe': 'existing', 'identifiers': [
                {'path': 'data.customer_id', 'kind': 'customer', 'value': PROBE.API_CUSTOMER_ID}]},
            {'walletProbe': 'empty_interest_true', 'identifiers': [
                {'path': 'data.provider_payload<json>.api_customer_id', 'kind': 'customer',
                 'value': PROBE.API_CUSTOMER_ID}]},
        ]
        evidence = PROBE.compare_wallet_customer_aliases(shared)
        self.assertEqual(evidence['status'], 'same-api-customer-alias-observed')
        self.assertTrue(evidence['matches'][0]['sameIdentifier'])
        shared[1]['identifiers'][0]['value'] = '01M2T3PAHG3P5A32REX8MH3HDE'
        self.assertEqual(PROBE.compare_wallet_customer_aliases(shared)['status'],
                         'not-proven-by-wallet-responses')

    def test_provider_payload_parse_is_bounded_and_never_reports_raw_invalid_text(self):
        malformed = PROBE.summarize_response({'provider_payload': 'private-malformed-payload'})
        self.assertEqual(malformed['providerPayloads'][0]['status'], 'invalid-json')
        oversized_text = 'x' * (PROBE.MAX_PROVIDER_PAYLOAD_BYTES + 1)
        oversized = PROBE.summarize_response({'provider_payload': oversized_text})
        self.assertEqual(oversized['providerPayloads'][0]['status'], 'size-limit')
        self.assertNotIn(oversized_text, json.dumps(oversized))

    def test_wallet_request_is_exact_get_and_rejects_other_wallets(self):
        request = PROBE.wallet_request(PROBE.WALLETS[0][1], 'secret-test-only')
        self.assertEqual(request.full_url, 'https://staging.piggyvest.business/api/v1/wallet/01M3CQX27G9687EFSF1TKYMPR9')
        self.assertEqual(request.get_method(), 'GET')
        self.assertEqual(request.get_header('User-agent'), PROBE.USER_AGENT)
        with self.assertRaisesRegex(ValueError, 'wallet-allowlist'):
            PROBE.wallet_request('unapproved-wallet', 'secret-test-only')
        self.assertIsNone(PROBE.NoRedirect().redirect_request(request, None, 302, 'Found', {}, 'https://example.test'))

    def test_provider_helper_is_loaded_from_adjacent_path_and_refuses_non_root_owner(self):
        self.assertEqual(PROBE.PROVIDER_HELPER, Path(PROBE.__file__).with_name('provider_interest_check.py'))
        metadata = SimpleNamespace(
            st_mode=stat.S_IFREG | 0o600,
            st_nlink=1,
            st_uid=12345,
            st_size=9769,
        )
        with patch.object(PROBE, 'PROVIDER_HELPER', Path('/private/test/provider_interest_check.py')):
            with patch.object(Path, 'lstat', return_value=metadata):
                with self.assertRaisesRegex(ValueError, 'provider-helper-metadata'):
                    PROBE._load_pinned_provider()

    def test_unknown_string_fields_are_type_only_and_shape_limits_fail_redacted(self):
        report = PROBE.summarize_response({'unrecognized': 'private-provider-text'})
        self.assertEqual(report['fieldTypes'], [{'path': 'unrecognized', 'type': 'string'}])
        self.assertNotIn('private-provider-text', str(report))
        weak_identifier = PROBE.summarize_response({'api_customer_id': 'JaneDoe'})
        self.assertEqual(weak_identifier['identifiers'], [])
        refusal = PROBE.refusal_report(ValueError('unknown-private-provider-field'))
        self.assertTrue(refusal['redacted'])
        self.assertNotIn('unknown-private-provider-field', str(refusal))
        with self.assertRaisesRegex(ValueError, 'provider-shape-bound'):
            PROBE.summarize_response({'nested': {'value': 'x'}, **{str(index): {} for index in range(1100)}})


if __name__ == '__main__':
    unittest.main()
