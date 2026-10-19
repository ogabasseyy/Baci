import copy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest


spec = importlib.util.spec_from_file_location('test_payment_gateway', Path(__file__).with_name('gateway.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class GatewayTests(unittest.TestCase):
    def test_resume_refuses_receipt_identity_or_lease_drift(self):
        from unittest.mock import Mock
        routes = [{'path': '/rpc', 'methods': ['POST']}]
        binding = {'version': 1, 'reviewedAt': 'start', 'leaseNotBefore': 'start', 'leaseExpiresAt': module.EXPIRY, 'identity': {'host': {}, 'containers': {}, 'networks': {}, 'restRoutes': routes}}
        raw = json.dumps(binding).encode()
        receipt = {'version': 1, 'bindingSha256': module.hashlib.sha256(raw).hexdigest(), 'identitySha256': module.hashlib.sha256(json.dumps(binding['identity'], separators=(',', ':')).encode()).hexdigest(), 'routesSha256': module.hashlib.sha256(json.dumps(routes, separators=(',', ':')).encode()).hexdigest(), 'leaseExpiresAt': module.EXPIRY, 'inventorySha256': 'a' * 64}
        activator = SimpleNamespace(_lease_moment=Mock(side_effect=lambda value, _deadline: 1790697550 if value == module.EXPIRY else 1790000000), DEADLINE_EPOCH=1790697550)
        module.validate_resume(binding, raw, receipt, routes, activator, 1790100000)
        for key in ('identitySha256', 'routesSha256', 'leaseExpiresAt', 'inventorySha256'):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                module.validate_resume(binding, raw, {**receipt, key: 'tampered'}, routes, activator, 1790100000)
        with self.assertRaises(RuntimeError):
            module.validate_resume(binding, raw, receipt, routes, activator, 1790700000)

    def test_appends_only_manual_allocation_and_preserves_identity_lease(self):
        routes = tuple((f'/existing/{number}', ('POST',)) for number in range(22))
        source = {'version': 1, 'leaseExpiresAt': module.EXPIRY, 'reviewedAt': 'unchanged', 'leaseNotBefore': 'unchanged', 'identity': {'host': 'unchanged', 'networks': {'private': 'same'}, 'containers': {'db': 'same'}, 'restRoutes': [{'path': path, 'methods': list(methods)} for path, methods in routes]}}
        previous = copy.deepcopy(source)
        target = module.extend(source, routes)
        self.assertEqual(source, previous)
        self.assertEqual(target['identity']['restRoutes'][-1], {'path': module.ROUTE, 'methods': ['POST']})
        target['identity']['restRoutes'].pop()
        self.assertEqual(target, previous)

    def test_refuses_route_or_lease_drift(self):
        source = {'leaseExpiresAt': module.EXPIRY, 'identity': {'restRoutes': []}}
        with self.assertRaises(RuntimeError):
            module.extend(source, (('expected', ('POST',)),))
        source['leaseExpiresAt'] = '2027-01-01T00:00:00Z'
        with self.assertRaises(RuntimeError):
            module.extend(source, ())

    def test_activation_failure_restores_predecessor_and_never_publishes_success(self):
        from unittest.mock import Mock
        activator = SimpleNamespace(_install_managed=Mock(), _restart_gateway=Mock(side_effect=RuntimeError('failed')), BINDING_PATH='binding', EVIDENCE_PATH='evidence')
        base = SimpleNamespace(_save_backup=Mock(return_value='backup'), _rollback=Mock())
        context = {'targetBytes': b'target', 'evidenceBytes': b'evidence', 'gid': 1}
        with self.assertRaises(RuntimeError):
            module.apply(activator, base, context)
        base._rollback.assert_called_once_with(activator, context, 'backup')


if __name__ == '__main__':
    unittest.main()
