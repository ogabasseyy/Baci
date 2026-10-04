import copy
import json
import unittest
from unittest.mock import patch

import renewal_contract as contract


NOW = contract.milliseconds('2026-09-30T12:00:00.000Z')
ROUTES = (
    ('/rest/v1/products', ('GET', 'HEAD')),
    ('/rest/v1/customers', ('GET', 'HEAD')),
    ('/rest/v1/merchants', ('GET', 'HEAD')),
    ('/rest/v1/rpc/customer_savings_draft_command', ('POST',)),
    ('/rest/v1/rpc/get_storefront_product_variants', ('POST',)),
    ('/rest/v1/customer_savings_goals', ('GET', 'HEAD')),
    ('/rest/v1/rpc/get_merchant_paystack_subaccount_code', ('POST',)),
    ('/rest/v1/rpc/get_customer_savings_feature_settings', ('POST',)),
    ('/rest/v1/rpc/create_customer_savings_goal', ('POST',)),
    ('/rest/v1/piggyvest_plan_wallets', ('GET', 'HEAD')),
    ('/rest/v1/piggyvest_interest_payouts', ('GET', 'HEAD')),
    ('/rest/v1/customer_wallets', ('GET', 'HEAD')),
    ('/rest/v1/customer_wallet_transactions', ('GET', 'HEAD')),
    ('/rest/v1/customer_wallet_payment_accounts', ('GET', 'HEAD')),
    ('/rest/v1/customer_wallet_accounts', ('GET', 'HEAD')),
    ('/rest/v1/rpc/get_storefront_payment_settings', ('POST',)),
    ('/rest/v1/rpc/get_customer_savings_earnings', ('POST',)),
    ('/rest/v1/rpc/get_customer_savings_notifications', ('POST',)),
    ('/rest/v1/rpc/update_customer_savings_notification_preferences', ('POST',)),
    ('/rest/v1/rpc/mark_customer_savings_notification_read', ('POST',)),
    ('/rest/v1/rpc/register_push_token', ('POST',)),
    ('/rest/v1/push_tokens', ('PATCH',)),
    ('/rest/v1/rpc/allocate_customer_savings_contribution', ('POST',)),
)


def fixture():
    identity = {
        'host': 'staging-auth.ogabassey.com',
        'containers': {
            'auth': {'id': 'd18b947aa6f7231c38ce030000ba80bf96eb8347c0332943e20bef3cd9bee50c',
                     'ip': '172.23.0.3', 'endpointId': '44ea0cbed7076b2a9ee06897db4247d254558cff201d31d95b9e7ca42a8a098b'},
            'rest': {'id': '4462229a3bf517b0fa316105366b35f1ff605a02755f85d4c01a8f01fccd4db9',
                     'ip': '172.23.0.4', 'endpointId': '1ea8f51b828d416ae1773405a2ff9ee0e80171e9ba282ba78533646f58153c64'},
        },
        'networks': {
            'database': {'id': 'c8fdbe178c2abdab8cd27b98f40de95267f883296fb6b1266c9bce6576a33b8e', 'subnet': '172.23.0.0/16'},
            'mail': {'id': 'c112fbf4dab726de8c33fbdf91f277753c9a7bce6067489650ee28c01102cef7', 'subnet': '172.22.0.0/16'},
        },
        'restRoutes': [{'path': path, 'methods': list(methods)} for path, methods in ROUTES[:22]],
    }
    binding = {'version': 1, 'identity': identity, 'reviewedAt': '2026-09-22T15:59:10.442Z',
               'leaseNotBefore': '2026-09-22T15:59:10.442Z', 'leaseExpiresAt': contract.OLD_GATEWAY}
    binding = json.loads(json.dumps(binding, separators=(',', ':'), sort_keys=True))
    binding['identity']['restRoutes'].append({'path': ROUTES[-1][0], 'methods': list(ROUTES[-1][1])})
    identity = binding['identity']
    evidence = {'receipt': {'version': 1, **identity, 'verifiedAt': '2026-09-22T15:59:10.442Z',
                            'firewallVerified': True, 'hostReachabilityVerified': True},
                'inventory': {'observedAt': '2026-09-22T15:59:10.442Z'}}
    values = {path: b'Reviewed immutable source\n' for path in contract.PINS}
    values[contract.BINDING] = contract.canonical(binding)
    values[contract.EVIDENCE] = contract.canonical(evidence)
    values[contract.FUNDING_ENV] = b'PASSWORD=never-print-secret\nBACI_SAVINGS_LEASE_EXPIRES_AT=1790697550\nHISTORICAL=1790697550\n'
    values[contract.UNIT_DIRECTORY + 'baci-savings-drafts.service'] = b'[Service]\nRuntimeMaxSec=7d\nExecCondition=/bin/sh -c \'[ "$(/bin/date -u +%%s)" -lt 1790697550 ]\'\n'
    values[contract.UNIT_DIRECTORY + 'baci-savings-funding.service'] = b'[Service]\nRuntimeMaxSec=7d\nExecCondition=/bin/sh -c \'test "$BACI_SAVINGS_LEASE_EXPIRES_AT" = "1790697550" && test "$(/bin/date -u +%%s)" -lt "1790697550"\'\n'
    values[contract.UNIT_DIRECTORY + 'baci-savings-gateway.service'] = b'[Service]\nRuntimeMaxSec=7d\n'
    for name in ('baci-savings-drafts-deadline.timer', 'baci-savings-funding-deadline.timer'):
        values[contract.UNIT_DIRECTORY + name] = b'[Timer]\nOnCalendar=2026-09-29 15:59:10 UTC\nAccuracySec=1s\n'
    return values


def inventory():
    return {'readOnly': True, 'changesMade': False, 'renewalApplied': False, 'newPaymentStarted': False,
            'database': {'systemIdentifier': contract.SYSTEM, 'readOnly': True, 'principalKobo': 10000,
                         'treasury': {'id': 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57', 'verifiedAvailableKobo': 10000,
                                      'reservedKobo': 0, 'consumedKobo': 0},
                         'intents': [{'id': 'd8bcf921-61b3-4647-90e2-5648e4d6967d', 'phase': 'retired_unconfirmed'}]},
            'receiptDatabase': {'systemIdentifier': contract.RECEIPT_SYSTEM, 'readOnly': True},
            'files': [{'path': path, 'unverifiedJwtExpiryClaims': {'appToken': [contract.OLD_EPOCH],
                                                                  'secret-named-key': 'never-print-secret'},
                       'credentials': 'never-print-secret'} for path in contract.REPLAY_CONFIGS]}


def report_bytes(value):
    return contract.canonical(value) + b'\nSTAGING_WEEK_RENEWAL_INVENTORY_READY\n'


class ContractTests(unittest.TestCase):
    def test_production_pins_and_targets_are_exact(self):
        self.assertEqual(contract.PINS[contract.BINDING], '30b0e1b36b75f2e32348242d1f5808c1e2b58126ff1311540d6384cf1aeb2fb2')
        self.assertEqual(contract.GATEWAY_TARGET, '2026-10-06T15:59:10.442Z')
        self.assertEqual(contract.TARGET_EPOCH - contract.OLD_EPOCH, 604800)
        self.assertEqual(len(contract.PINS), 11)

    def test_bugfix_preserves_the_pinned_23_route_binding_including_manual_allocation(self):
        content = fixture()[contract.BINDING]
        self.assertEqual(contract.digest(content), contract.PINS[contract.BINDING])
        old = contract.parse_json(content)
        new = contract.parse_json(contract.renewed_binding(content, NOW))
        self.assertEqual(new['identity'], old['identity'])
        self.assertEqual(new['version'], old['version'])
        self.assertEqual(new['reviewedAt'], '2026-09-30T12:00:00.000Z')
        self.assertEqual(new['leaseNotBefore'], new['reviewedAt'])
        self.assertEqual(new['leaseExpiresAt'], contract.GATEWAY_TARGET)
        self.assertEqual(len(new['identity']['restRoutes']), 23)
        self.assertEqual(new['identity']['restRoutes'][-1],
                         {'path': '/rest/v1/rpc/allocate_customer_savings_contribution', 'methods': ['POST']})

    def test_only_exact_service_guard_calendar_and_env_line_change(self):
        values = fixture()
        with patch.object(contract, 'PINS', {path: contract.digest(content) for path, content in values.items()}):
            result = contract.candidates(values, NOW)
        self.assertEqual(len(result), 6)
        self.assertNotIn('startup-evidence.json', result)
        self.assertIn(b'PASSWORD=never-print-secret\n', result['funding-service.env'])
        self.assertIn(b'HISTORICAL=1790697550\n', result['funding-service.env'])
        self.assertIn(str(contract.TARGET_EPOCH).encode(), result['funding-service.env'])
        self.assertNotIn('baci-savings-gateway.service', result)
        self.assertNotIn('baci-prefunded-public.service', result)

    def test_predecessor_drift_refuses_before_candidate_render(self):
        values = fixture()
        with self.assertRaisesRegex(contract.Refused, 'predecessor-pin'):
            contract.candidates(values, NOW)

    def test_route_downgrade_duplicate_or_method_expansion_refuses(self):
        original = contract.parse_json(fixture()[contract.BINDING])
        for change in ('downgrade', 'duplicate', 'method', 'missing-allocation', 'unreviewed-path', 'method-expansion', 'order'):
            value = copy.deepcopy(original)
            routes = value['identity']['restRoutes']
            if change == 'downgrade':
                del routes[5:]
            elif change == 'duplicate':
                routes[1] = routes[0]
            elif change == 'missing-allocation':
                routes.pop()
            elif change == 'unreviewed-path':
                routes[-1]['path'] = '/rest/v1/rpc/unreviewed_contribution'
            elif change == 'method-expansion':
                routes[-1]['methods'] = ['GET', 'POST']
            elif change == 'order':
                routes.reverse()
            else:
                routes[0]['methods'] = ['DELETE']
            with self.assertRaises(contract.Refused):
                contract.renewed_binding(contract.canonical(value), NOW)

    def test_fixed_deadline_lease_window_and_unreviewed_lines_refuse(self):
        for now in (NOW - 604800000, contract.milliseconds(contract.GATEWAY_TARGET)):
            with self.assertRaises(contract.Refused):
                contract.renewed_binding(fixture()[contract.BINDING], now)
        for content in (b'other=1790697550\n', b'old\nold\n', b'old\r\n'):
            with self.assertRaises(contract.Refused):
                contract.replace_line(content, b'old\n', b'new\n')

    def test_duplicate_json_and_old_evidence_identity_mismatch_refuse(self):
        with self.assertRaises(contract.Refused):
            contract.parse_json(b'{"secret":"never-print-secret","secret":1}')
        values = fixture()
        values[contract.EVIDENCE] = b'{"receipt":{},"inventory":{}}'
        with patch.object(contract, 'PINS', {path: contract.digest(content) for path, content in values.items()}):
            with self.assertRaisesRegex(contract.Refused, 'evidence-identity'):
                contract.candidates(values, NOW)

    def test_replay_expiry_projection_is_redacted_and_never_signature_proof(self):
        result = contract.inventory_summary(report_bytes(inventory()))
        self.assertEqual(result['replayJwtExpiryUnverified'], [contract.OLD_EPOCH])
        self.assertFalse(result['replayJwtCoversTargetUnverified'])
        self.assertNotIn('never-print-secret', json.dumps(result))

    def test_crossed_physical_system_and_changed_principal_or_retired_intent_refuse(self):
        for change in ('app', 'receipt', 'principal', 'intent', 'reserved'):
            value = inventory()
            if change in ('app', 'receipt'):
                value['database' if change == 'app' else 'receiptDatabase']['systemIdentifier'] = 'wrong'
            elif change == 'principal':
                value['database']['principalKobo'] = 0
            elif change == 'intent':
                value['database']['intents'][0]['phase'] = 'pending'
            else:
                value['database']['treasury']['reservedKobo'] = 1
            with self.assertRaises(contract.Refused):
                contract.inventory_summary(report_bytes(value))

    def test_inventory_marker_and_noninteger_expiry_refuse(self):
        with self.assertRaises(contract.Refused):
            contract.inventory_summary(contract.canonical(inventory()))
        value = inventory()
        value['files'][0]['unverifiedJwtExpiryClaims']['appToken'] = [True]
        with self.assertRaises(contract.Refused):
            contract.inventory_summary(report_bytes(value))


if __name__ == '__main__':
    unittest.main()
