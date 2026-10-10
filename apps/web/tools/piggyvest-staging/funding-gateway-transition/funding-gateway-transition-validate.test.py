import importlib.util
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


BASE = Path(__file__).parent


def _load_fixture():
    spec = importlib.util.spec_from_file_location(
        'transition_fixture', BASE / 'funding-gateway-transition-fixture.py'
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fixture = _load_fixture()
validate = fixture.validate
paths = fixture.paths
render = fixture.load_registered('render')
stat_result = fixture.stat_result


class TransitionValidateTests(fixture.TransitionFixtureMixin, unittest.TestCase):
    def test_accepts_exact_post_renewal_chain_and_renders_receipt_schema(self):
        self.fixture()
        receipt = json.loads(render.render_provenance(self.preflight()))
        self.assertEqual(receipt['deadline'], validate.DEADLINE)
        self.assertEqual(receipt['routeContract'], self.inputs()['identity']['restRoutes'])


    def test_regression_rejects_bad_predecessor_receipt_chain(self):
        self.fixture()
        renewal = json.loads((self.state / 'renewal-receipt.json').read_text())
        renewal['predecessorReceiptSha256'] = 'd' * 64
        self.write(self.state / 'renewal-receipt.json', renewal)
        with self.assertRaisesRegex(validate.Refused, 'chain'):
            self.preflight()


    def test_regression_rejects_any_expiry_other_than_fixed_deadline(self):
        inputs = self.fixture()
        inputs['deadline'] = '2026-10-01T15:59:10.000Z'
        self.write(self.inputs_path, inputs)
        with self.assertRaisesRegex(validate.Refused, 'fixed expiry'):
            self.preflight()


    def test_regression_rejects_stale_pre_renewal_gateway_manifest_pin(self):
        inputs = self.fixture()
        inputs['postRenewalManifestSha256'] = inputs['preRenewalManifestSha256']
        self.write(self.inputs_path, inputs)
        with self.assertRaisesRegex(validate.Refused, 'stale'):
            self.preflight()


    def test_transition_contract_is_eleven_routes_with_minimum_wallet_reads(self):
        self.assertEqual(len(validate.ROUTES), 11)
        self.assertEqual(
            validate.ROUTES[-2:],
            (
                ('/rest/v1/piggyvest_plan_wallets', ('GET', 'HEAD')),
                ('/rest/v1/piggyvest_interest_payouts', ('GET', 'HEAD')),
            ),
        )
        paths = [path for path, _ in validate.ROUTES]
        self.assertEqual(len(set(paths)), 11)
        for path, methods in validate.ROUTES:
            self.assertRegex(path, r'^/rest/v1/(rpc/)?[a-z][a-z0-9_]{0,62}$')
            self.assertTrue(methods)
            self.assertEqual(len(set(methods)), len(methods))


    def test_regression_rejects_extra_or_missing_hosted_funding_route(self):
        inputs = self.fixture()
        inputs['identity']['restRoutes'].pop()
        with self.assertRaisesRegex(validate.Refused, 'route contract'):
            validate._validate_inputs(inputs, validate.DEADLINE_EPOCH - 1)
        inputs = self.fixture()
        inputs['identity']['restRoutes'].append({'path': '/auth/v1/admin', 'methods': ['GET']})
        with self.assertRaisesRegex(validate.Refused, 'route contract'):
            validate._validate_inputs(inputs, validate.DEADLINE_EPOCH - 1)


    def test_regression_refuses_expired_current_time_or_changed_package_manifest(self):
        self.fixture()
        with patch.object(paths, '_safe_ancestors'):
            with self.assertRaisesRegex(validate.Refused, 'fixed expiry'):
                validate.validate_preflight(
                    self.inputs_path,
                    self.state,
                    self.manifest_path,
                    self.gateway_unit,
                    os.getuid(),
                    validate.DEADLINE_EPOCH,
                    self.package_path,
                )
        self.package_path.write_text('{"changed":true}', encoding='utf-8')
        self.package_path.chmod(0o600)
        with self.assertRaisesRegex(validate.Refused, 'package manifest'):
            self.preflight()


    def test_regression_rejects_root_input_symlink_or_unsafe_owner(self):
        self.fixture()
        linked = self.root / 'linked.json'
        linked.symlink_to(self.inputs_path)
        with patch.object(paths, '_safe_ancestors'):
            with self.assertRaisesRegex(validate.Refused, 'unavailable'):
                paths._read_root_file(linked, os.getuid())
        unsafe = os.stat(self.inputs_path)
        with patch.object(paths.os, 'fstat', return_value=stat_result(unsafe, uid=os.getuid() + 1)):
            with patch.object(paths, '_safe_ancestors'):
                with self.assertRaisesRegex(validate.Refused, 'unsafe'):
                    paths._read_root_file(self.inputs_path, os.getuid())


    def test_regression_refuses_reused_provenance_receipt(self):
        self.fixture()
        target = self.state / paths.PROVENANCE_PATH.name
        target.write_text('old', encoding='utf-8')
        with self.assertRaisesRegex(validate.Refused, 'already exists'):
            validate.validate_provenance_target(target)


    def test_regression_archives_require_exact_0440(self):
        self.fixture()
        (self.archive / 'binding.json').chmod(0o600)
        with self.assertRaisesRegex(validate.Refused, 'unsafe'):
            self.preflight()
        (self.archive / 'binding.json').chmod(0o440)
        (self.archive / 'startup-evidence.json').chmod(0o400)
        with self.assertRaisesRegex(validate.Refused, 'unsafe'):
            self.preflight()


if __name__ == '__main__':
    unittest.main()
