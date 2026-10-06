import contextlib
import io
import importlib.util
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('savings_engagement_gateway', HERE / 'gateway.py')
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)
ROUTES_16 = tuple((path, tuple(methods.split())) for path, methods in (
    ('/rest/v1/products', 'GET HEAD'), ('/rest/v1/customers', 'GET HEAD'),
    ('/rest/v1/merchants', 'GET HEAD'), ('/rest/v1/rpc/customer_savings_draft_command', 'POST'),
    ('/rest/v1/rpc/get_storefront_product_variants', 'POST'), ('/rest/v1/customer_savings_goals', 'GET HEAD'),
    ('/rest/v1/rpc/get_merchant_paystack_subaccount_code', 'POST'), ('/rest/v1/rpc/get_customer_savings_feature_settings', 'POST'),
    ('/rest/v1/rpc/create_customer_savings_goal', 'POST'), ('/rest/v1/piggyvest_plan_wallets', 'GET HEAD'),
    ('/rest/v1/piggyvest_interest_payouts', 'GET HEAD'), ('/rest/v1/customer_wallets', 'GET HEAD'),
    ('/rest/v1/customer_wallet_transactions', 'GET HEAD'), ('/rest/v1/customer_wallet_payment_accounts', 'GET HEAD'),
    ('/rest/v1/customer_wallet_accounts', 'GET HEAD'), ('/rest/v1/rpc/get_storefront_payment_settings', 'POST'),
))
activator = SimpleNamespace(
    DEADLINE_EPOCH=1790697550,
    _routes_tuple=lambda rows: tuple((row['path'], tuple(row['methods'])) for row in rows),
    _lease_moment=lambda value, fallback: fallback if value is None else int(datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()),
)
installer = SimpleNamespace(
    NEW_ROUTES=ROUTES_16[11:],
    routes_16=lambda fixture: tuple(fixture.ROUTES) + installer.NEW_ROUTES,
    render_binding=lambda current, routes: json.dumps({**current, 'identity': {**current['identity'], 'restRoutes': [{'path': p, 'methods': list(m)} for p, m in routes]}}).encode(),
)
candidate = SimpleNamespace(ROUTES=ROUTES_16[:11])
def current_binding():
    routes = installer.routes_16(candidate)
    return {
        'version': 1,
        'identity': {
            'host': 'staging-auth.ogabassey.com',
            'containers': {'auth': {'id': 'a' * 64}, 'rest': {'id': 'b' * 64}},
            'networks': {'database': {'id': 'c' * 64}},
            'restRoutes': [
                {'path': path, 'methods': list(methods)}
                for path, methods in routes
            ],
        },
        'reviewedAt': '2026-09-22T15:59:10.442Z',
        'leaseNotBefore': '2026-09-22T15:59:10.442Z',
        'leaseExpiresAt': gateway.LEASE_EXPIRES_AT,
    }
def expanded_binding():
    before = current_binding()
    before['identity']['restRoutes'] += [
        {'path': path, 'methods': list(methods)}
        for path, methods in gateway.NEW_ROUTES
    ]
    return before
class SavingsEngagementGatewayContractTests(unittest.TestCase):
    def test_appends_exact_six_routes_to_the_known_16_route_contract(self):
        routes = gateway.routes_22(installer, candidate)
        self.assertEqual(len(routes), 22)
        self.assertEqual(routes[:16], tuple(installer.routes_16(candidate)))
        self.assertEqual(
            routes[16:],
            (
                ('/rest/v1/rpc/get_customer_savings_earnings', ('POST',)),
                ('/rest/v1/rpc/get_customer_savings_notifications', ('POST',)),
                ('/rest/v1/rpc/update_customer_savings_notification_preferences', ('POST',)),
                ('/rest/v1/rpc/mark_customer_savings_notification_read', ('POST',)),
                ('/rest/v1/rpc/register_push_token', ('POST',)),
                ('/rest/v1/push_tokens', ('PATCH',)),
            ),
        )
    def test_target_binding_preserves_every_non_route_field_and_fixed_lease(self):
        before = current_binding()
        original = json.loads(json.dumps(before))
        target = gateway.build_target_binding(
            before, activator, installer, candidate, now_seconds=1790180000
        )
        self.assertEqual(target['identity']['restRoutes'], [
            {'path': path, 'methods': list(methods)}
            for path, methods in gateway.routes_22(installer, candidate)
        ])
        self.assertEqual(
            {key: value for key, value in target.items() if key != 'identity'},
            {key: value for key, value in original.items() if key != 'identity'},
        )
        self.assertEqual(
            {key: value for key, value in target['identity'].items() if key != 'restRoutes'},
            {key: value for key, value in original['identity'].items() if key != 'restRoutes'},
        )
        self.assertEqual(target['leaseExpiresAt'], '2026-09-29T15:59:10.442Z')
    def test_refuses_nonexact_predecessor_and_changed_fixed_lease(self):
        before = current_binding()
        before['identity']['restRoutes'].pop()
        with self.assertRaises(gateway.Refused):
            gateway.build_target_binding(
                before, activator, installer, candidate, now_seconds=1790180000
            )
        before = current_binding(); before['leaseExpiresAt'] = '2026-09-29T15:59:10.000Z'
        with self.assertRaises(gateway.Refused): gateway.build_target_binding(before, activator, installer, candidate, now_seconds=1790180000)
    def test_refuses_routes_22_if_wallet_installer_predecessor_drifts(self):
        changed = SimpleNamespace(
            ROUTES=tuple(candidate.ROUTES)
            + (('/rest/v1/rpc/unreviewed', ('POST',)),)
        )
        with self.assertRaises(gateway.Refused):
            gateway.routes_22(installer, changed)
    def test_matching_own_receipt_allows_only_exact_current_22_route_binding(self):
        binding = expanded_binding()
        binding_bytes = json.dumps(binding, separators=(',', ':')).encode()
        receipt = gateway.build_own_receipt(binding, binding_bytes, {'observedAt': 'fresh'})
        verified = gateway.validate_own_receipt(
            binding, binding_bytes, receipt, activator, installer, candidate, now_ms=1790180000000
        )
        self.assertEqual(verified['bindingSha256'], gateway._sha(binding_bytes))
        changed = json.loads(json.dumps(binding))
        changed['identity']['host'] = 'other-auth.example'
        with self.assertRaises(gateway.Refused):
            gateway.validate_own_receipt(
                changed,
                json.dumps(changed, separators=(',', ':')).encode(),
                receipt,
                activator,
                installer,
                candidate,
                now_ms=1790180000000,
            )
    def test_22_route_noop_requires_receipt_and_validates_fresh_inventory(self):
        binding = expanded_binding()
        binding_bytes = json.dumps(binding, separators=(',', ':')).encode()
        receipt = gateway.build_own_receipt(binding, binding_bytes, {'observedAt': 'old'})
        calls = []
        fake = SimpleNamespace(
            DEADLINE_EPOCH=activator.DEADLINE_EPOCH,
            _lease_moment=activator._lease_moment,
            GATEWAY_SERVICE='gateway.service',
            DRAFTS_SERVICE='drafts.service',
            _service_state=lambda name: {'ActiveState': 'active'},
            _firewall_preflight=lambda: calls.append('firewall'),
            _reachability_preflight=lambda identity: calls.append(('reach', identity['host'])),
            _probe_baseline=lambda: ['baseline'],
            _collect_inventory=lambda: ({'observedAt': 'fresh'}, 1790180005000),
            _build_evidence=lambda target, inventory, started: ({'inventory': inventory}, b'evidence'),
            _validate_evidence=lambda _target, _evidence, started, now: calls.append((started, now)),
            _verify_post_transition=lambda *_args: calls.append('baseline'),
            _gateway_account=lambda: (100, 200),
            _verify_socket=lambda *_args: calls.append('socket'),
            _probe_baseline_marker=True,
        )
        with (
            patch.object(gateway.time, 'time', side_effect=[1790180000, 1790180006]),
            patch.object(gateway, '_probe_routes', return_value=[('route',)] * 22) as routes,
        ):
            context = gateway._prepare_noop(fake, installer, candidate, binding, binding_bytes, receipt)
        self.assertEqual(context['status'], 'already_applied')
        self.assertGreaterEqual(calls[-3][1], calls[-3][0])
        self.assertEqual(len(routes.call_args.args[1]), 22)
        with self.assertRaises(gateway.Refused):
            gateway.validate_own_receipt(
                binding, binding_bytes, b'{}', activator, installer, candidate, now_ms=1790180000000
            )
    def test_apply_mode_is_a_safe_noop_for_verified_existing_22_route_binding(self):
        lock_path = Path('/run/shared-transition.lock')
        lock_calls = []
        fake = SimpleNamespace(
            verify_graph=lambda: None,
            LOCK_PATH=lock_path,
            _locked=lambda path: (lock_calls.append(path), contextlib.nullcontext())[1],
        )
        context = {'status': 'already_applied', 'routeBaseline': [None] * 22}
        with (patch.object(gateway.os, 'geteuid', return_value=0),
              patch.object(gateway, 'load_dependencies', return_value=(fake, installer, candidate)),
              patch.object(gateway, '_prepare', return_value=context),
              patch.object(gateway, 'apply_transition', side_effect=AssertionError)):
            for mode in ('--check', '--apply'):
                with patch('sys.stdout', new_callable=io.StringIO) as output:
                    self.assertEqual(gateway.main([mode]), 0)
                    result = json.loads(output.getvalue())
                    self.assertEqual(result['status'], 'already_applied')
                    self.assertEqual(result['routesBefore'], result['routesAfter'])
        self.assertEqual(lock_calls, [lock_path, lock_path])
    def test_nonroot_refuses_before_verifying_graph_or_loading_dependencies(self):
        with (
            patch.object(gateway.os, 'geteuid', return_value=501),
            patch.object(gateway, 'load_dependencies', side_effect=AssertionError),
            patch('sys.stderr', new_callable=io.StringIO) as error,
        ):
            self.assertEqual(gateway.main(['--check']), 1)
        self.assertEqual(error.getvalue().strip(), 'savings_gateway_transition:root_required')
    def test_failed_health_probe_restores_exact_binding_bytes_and_keeps_backup(self):
        original_binding = b'{ "binding": "exact predecessor bytes" }\n'
        with tempfile.TemporaryDirectory() as temporary:
            events = []
            state = Path(temporary) / 'state'
            state.mkdir()
            fake = SimpleNamespace(
                STATE_DIRECTORY=state,
                BINDING_PATH=Path('/etc/baci-savings-gateway/binding.json'),
                EVIDENCE_PATH=Path('/etc/baci-savings-gateway/startup-evidence.json'),
                GATEWAY_SERVICE='gateway.service',
                _safe_ancestors=lambda *_args: None,
                _install_managed=lambda path, content, _gid: events.append(
                    (path, content)
                ),
                _read_root_file=lambda path, *_args: Path(path).read_bytes(),
                _collect_inventory=lambda: ({}, 10),
                _build_evidence=lambda *_args: ({}, b'fresh predecessor evidence'),
                _validate_evidence=lambda *_args: None,
                _service_state=lambda _name: {'InvocationID': 'changed-invocation'},
                _restart_gateway=lambda: events.append(('restart', b'')),
                _poll_gateway=lambda *_args: None,
                _verify_post_transition=lambda *_args: None,
            )
            context = {
                'currentBytes': original_binding,
                'previousEvidence': b'old evidence',
                'targetBytes': b'target binding',
                'evidenceBytes': b'target evidence',
                'gid': 20,
                'uid': 10,
                'gateway': {'InvocationID': 'before'},
                'baseline': [],
                'routeBaseline': [],
                'beforeRoutes': (),
            }
            with (
                patch.object(gateway.os, 'geteuid', return_value=0),
                patch.object(
                    gateway,
                    '_verify_health',
                    side_effect=gateway.Refused('new route probe failed'),
                ),
                patch.object(gateway, '_verify_routes'),
                self.assertRaises(gateway.RolledBack),
            ):
                gateway.apply_transition(fake, context)
            binding_installs = [
                content
                for path, content in events
                if path == fake.BINDING_PATH
            ]
            self.assertEqual(binding_installs, [b'target binding', original_binding])
            backup = next((state / 'savings-engagement-route-backups').iterdir())
            self.assertEqual((backup / 'binding.json').read_bytes(), original_binding)
            self.assertEqual((backup / 'startup-evidence.json').read_bytes(), b'old evidence')
    def test_initial_backup_directory_is_created_before_ancestor_validation(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / 'state'
            state.mkdir(); context = {'currentBytes': b'binding', 'previousEvidence': b'evidence'}
            calls = []
            def safe_ancestors(path, _owner):
                if path.name == 'sentinel':
                    calls.append(path.parent.is_dir())
                    if not path.parent.is_dir():
                        raise gateway.Refused('Missing backup ancestor')
            fake = SimpleNamespace(STATE_DIRECTORY=state, _safe_ancestors=safe_ancestors)
            with (
                patch.object(gateway.stat, 'S_ISDIR', return_value=True),
                patch.object(gateway.stat, 'S_IMODE', return_value=0o700),
                patch.object(Path, 'lstat', return_value=SimpleNamespace(st_mode=0o700, st_uid=0)),
            ):
                backup = gateway._save_backup(fake, context)
            self.assertTrue(backup.is_dir())
            self.assertEqual(calls, [True])
    def test_partial_receipt_write_rolls_back_and_retry_publishes_receipt(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary); target = expanded_binding()
            fake = SimpleNamespace(STATE_DIRECTORY=state, BINDING_PATH=Path('/binding'), EVIDENCE_PATH=Path('/evidence'),
                _safe_ancestors=lambda *_args: None, _install_managed=lambda *_args: None,
                _restart_gateway=lambda: None, _poll_gateway=lambda *_args: None)
            context = {'target': target, 'targetBytes': json.dumps(target).encode(), 'inventory': {}, 'evidenceBytes': b'evidence',
                'gid': 0, 'gateway': {'InvocationID': 'old'}, 'uid': 0, 'baseline': [], 'routeBaseline': [], 'beforeRoutes': ()}
            receipt = state / gateway.RECEIPT_PATH_NAME; calls = 0; real_write = gateway.os.write
            def partial_write(descriptor, data):
                nonlocal calls
                calls += 1
                if calls == 1: return real_write(descriptor, data[:2])
                raise OSError('simulated disk full')
            with (patch.object(gateway.os, 'geteuid', return_value=0),
                  patch.object(gateway, '_save_backup', return_value=state),
                  patch.object(gateway, '_verify_health'),
                  patch.object(gateway, '_rollback') as rollback,
                  patch.object(gateway.os, 'write', side_effect=partial_write),
                  self.assertRaises(gateway.RolledBack)):
                gateway.apply_transition(fake, context)
            rollback.assert_called_once(); self.assertFalse(receipt.exists())
            with (patch.object(gateway.os, 'geteuid', return_value=0),
                  patch.object(gateway, '_save_backup', return_value=state),
                  patch.object(gateway, '_verify_health'),
                  patch.object(gateway, '_rollback')):
                result = gateway.apply_transition(fake, context)
            self.assertEqual(result['status'], 'applied'); self.assertTrue(receipt.is_file())
if __name__ == '__main__':
    unittest.main()
