import importlib.util
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


BASE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location(
    'funding_gateway_transition', BASE / 'funding-gateway-transition-candidate.py'
)
candidate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(candidate)


class FundingGatewayTransitionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.state = self.root / 'state'
        self.archive = self.state / 'renewals/approved-renewal'
        self.archive.mkdir(parents=True)
        self.inputs_path = self.root / 'inputs.json'
        self.manifest_path = self.root / 'post-renewal-manifest.json'
        self.package_path = self.root / 'funding-transition-package-manifest.json'
        self.gateway_unit = self.root / 'baci-savings-gateway.service'

    def tearDown(self):
        self.directory.cleanup()

    def write(self, path, value):
        path.write_text(json.dumps(value), encoding='utf-8')
        path.chmod(0o600)

    def inputs(self):
        return {
            'version': 1,
            'deadline': candidate.DEADLINE,
            'preRenewalManifestSha256': 'a' * 64,
            'postRenewalManifestSha256': 'b' * 64,
            'packageManifestSha256': 'c' * 64,
            'archive': {
                'name': 'approved-renewal',
                'bindingSha256': candidate._sha(b'binding'),
                'startupEvidenceSha256': candidate._sha(b'startup'),
            },
            'identity': {
                'restRoutes': [
                    {'path': path, 'methods': list(methods)}
                    for path, methods in candidate.ROUTES
                ]
            },
        }

    def fixture(self):
        inputs = self.inputs()
        receipt = {
            'version': 1,
            'manifestSha256': inputs['preRenewalManifestSha256'],
            'entries': [],
        }
        receipt_bytes = json.dumps(receipt).encode()
        self.write(self.state / 'receipt.json', receipt)
        self.write(
            self.state / 'renewal-receipt.json',
            {
                'version': 1,
                'activatedAt': 1790092750,
                'expiresAt': 1790697550,
                'predecessorReceiptSha256': candidate._sha(receipt_bytes),
                'archivedEvidence': {
                    'bindingSha256': inputs['archive']['bindingSha256'],
                    'startupEvidenceSha256': inputs['archive']['startupEvidenceSha256'],
                },
            },
        )
        for leaf in ('binding.json', 'startup-evidence.json'):
            (self.archive / leaf).unlink(missing_ok=True)
        (self.archive / 'binding.json').write_bytes(b'binding')
        (self.archive / 'startup-evidence.json').write_bytes(b'startup')
        for path in self.archive.iterdir():
            path.chmod(0o440)
        self.write(self.inputs_path, inputs)
        if self.gateway_unit.exists():
            self.gateway_unit.chmod(0o600)
        self.gateway_unit.write_bytes(b'post-renewal gateway unit')
        self.gateway_unit.chmod(0o444)
        self.write(
            self.manifest_path,
            {
                'version': 1,
                'files': {
                    'managed-gateway.service': candidate._sha(self.gateway_unit.read_bytes())
                },
            },
        )
        inputs['postRenewalManifestSha256'] = candidate._sha(self.manifest_path.read_bytes())
        self.write(self.package_path, {'reviewed': 'package'})
        inputs['packageManifestSha256'] = candidate._sha(self.package_path.read_bytes())
        self.write(self.inputs_path, inputs)
        return inputs

    def preflight(self):
        with patch.object(candidate, '_safe_ancestors'):
            return candidate.validate_preflight(
                self.inputs_path,
                self.state,
                self.manifest_path,
                self.gateway_unit,
                os.getuid(),
                candidate.DEADLINE_EPOCH - 1,
                self.package_path,
            )

    def test_accepts_exact_post_renewal_chain_and_renders_receipt_schema(self):
        self.fixture()
        receipt = json.loads(candidate.render_provenance(self.preflight()))
        self.assertEqual(receipt['deadline'], candidate.DEADLINE)
        self.assertEqual(receipt['routeContract'], self.inputs()['identity']['restRoutes'])

    def test_regression_rejects_bad_predecessor_receipt_chain(self):
        self.fixture()
        renewal = json.loads((self.state / 'renewal-receipt.json').read_text())
        renewal['predecessorReceiptSha256'] = 'd' * 64
        self.write(self.state / 'renewal-receipt.json', renewal)
        with self.assertRaisesRegex(candidate.Refused, 'chain'):
            self.preflight()

    def test_regression_rejects_any_expiry_other_than_fixed_deadline(self):
        inputs = self.fixture()
        inputs['deadline'] = '2026-10-01T15:59:10.000Z'
        self.write(self.inputs_path, inputs)
        with self.assertRaisesRegex(candidate.Refused, 'fixed expiry'):
            self.preflight()

    def test_regression_rejects_stale_pre_renewal_gateway_manifest_pin(self):
        inputs = self.fixture()
        inputs['postRenewalManifestSha256'] = inputs['preRenewalManifestSha256']
        self.write(self.inputs_path, inputs)
        with self.assertRaisesRegex(candidate.Refused, 'stale'):
            self.preflight()

    def test_transition_contract_is_eleven_routes_with_minimum_wallet_reads(self):
        self.assertEqual(len(candidate.ROUTES), 11)
        self.assertEqual(
            candidate.ROUTES[-2:],
            (
                ('/rest/v1/piggyvest_plan_wallets', ('GET', 'HEAD')),
                ('/rest/v1/piggyvest_interest_payouts', ('GET', 'HEAD')),
            ),
        )
        paths = [path for path, _ in candidate.ROUTES]
        self.assertEqual(len(set(paths)), 11)
        for path, methods in candidate.ROUTES:
            self.assertRegex(path, r'^/rest/v1/(rpc/)?[a-z][a-z0-9_]{0,62}$')
            self.assertTrue(methods)
            self.assertEqual(len(set(methods)), len(methods))

    def test_regression_rejects_extra_or_missing_hosted_funding_route(self):
        inputs = self.fixture()
        inputs['identity']['restRoutes'].pop()
        with self.assertRaisesRegex(candidate.Refused, 'route contract'):
            candidate._validate_inputs(inputs, candidate.DEADLINE_EPOCH - 1)
        inputs = self.fixture()
        inputs['identity']['restRoutes'].append({'path': '/auth/v1/admin', 'methods': ['GET']})
        with self.assertRaisesRegex(candidate.Refused, 'route contract'):
            candidate._validate_inputs(inputs, candidate.DEADLINE_EPOCH - 1)

    def test_regression_refuses_expired_current_time_or_changed_package_manifest(self):
        self.fixture()
        with patch.object(candidate, '_safe_ancestors'):
            with self.assertRaisesRegex(candidate.Refused, 'fixed expiry'):
                candidate.validate_preflight(
                    self.inputs_path,
                    self.state,
                    self.manifest_path,
                    self.gateway_unit,
                    os.getuid(),
                    candidate.DEADLINE_EPOCH,
                    self.package_path,
                )
        self.package_path.write_text('{"changed":true}', encoding='utf-8')
        self.package_path.chmod(0o600)
        with self.assertRaisesRegex(candidate.Refused, 'package manifest'):
            self.preflight()

    def test_regression_rejects_root_input_symlink_or_unsafe_owner(self):
        self.fixture()
        linked = self.root / 'linked.json'
        linked.symlink_to(self.inputs_path)
        with patch.object(candidate, '_safe_ancestors'):
            with self.assertRaisesRegex(candidate.Refused, 'unavailable'):
                candidate._read_root_file(linked, os.getuid())
        unsafe = os.stat(self.inputs_path)
        with patch.object(candidate.os, 'fstat', return_value=stat_result(unsafe, uid=os.getuid() + 1)):
            with patch.object(candidate, '_safe_ancestors'):
                with self.assertRaisesRegex(candidate.Refused, 'unsafe'):
                    candidate._read_root_file(self.inputs_path, os.getuid())

    def test_regression_refuses_reused_provenance_receipt(self):
        self.fixture()
        target = self.state / candidate.PROVENANCE_PATH.name
        target.write_text('old', encoding='utf-8')
        with self.assertRaisesRegex(candidate.Refused, 'already exists'):
            candidate.validate_provenance_target(target)

    def test_regression_archives_require_exact_0440(self):
        self.fixture()
        (self.archive / 'binding.json').chmod(0o600)
        with self.assertRaisesRegex(candidate.Refused, 'unsafe'):
            self.preflight()
        (self.archive / 'binding.json').chmod(0o440)
        (self.archive / 'startup-evidence.json').chmod(0o400)
        with self.assertRaisesRegex(candidate.Refused, 'unsafe'):
            self.preflight()

    def test_collect_pins_live_renewal_state(self):
        self.fixture()
        with patch.object(candidate, '_safe_ancestors'):
            source = candidate.collect_transition_source(
                self.state, self.gateway_unit, os.getuid()
            )
        self.assertEqual(source['preRenewalManifestSha256'], 'a' * 64)
        self.assertEqual(source['archive']['name'], 'approved-renewal')
        self.assertEqual(
            source['archive']['bindingSha256'], candidate._sha(b'binding')
        )
        self.assertEqual(
            source['archive']['startupEvidenceSha256'],
            candidate._sha(b'startup'),
        )
        self.assertEqual(
            source['unitSha256'],
            candidate._sha(b'post-renewal gateway unit'),
        )

    def test_collect_refuses_ambiguous_or_mismatched_archive(self):
        self.fixture()
        (self.state / 'renewals' / 'second').mkdir()
        with patch.object(candidate, '_safe_ancestors'):
            with self.assertRaisesRegex(candidate.Refused, 'exactly one'):
                candidate.collect_transition_source(
                    self.state, self.gateway_unit, os.getuid()
                )
        (self.state / 'renewals' / 'second').rmdir()
        (self.archive / 'binding.json').chmod(0o600)
        (self.archive / 'binding.json').write_bytes(b'tampered')
        (self.archive / 'binding.json').chmod(0o440)
        with patch.object(candidate, '_safe_ancestors'):
            with self.assertRaisesRegex(candidate.Refused, 'does not match'):
                candidate.collect_transition_source(
                    self.state, self.gateway_unit, os.getuid()
                )

    def test_builder_round_trip_passes_preflight(self):
        self.fixture()
        with patch.object(candidate, '_safe_ancestors'):
            source = candidate.collect_transition_source(
                self.state, self.gateway_unit, os.getuid()
            )
        post_renewal = candidate.render_post_renewal_manifest(
            source['unitSha256']
        )
        self.write(self.manifest_path, post_renewal)
        package_sha = candidate._sha(self.package_path.read_bytes())
        post_sha = candidate._sha(self.manifest_path.read_bytes())
        generated = candidate.render_owner_inputs(source, package_sha, post_sha)
        self.write(self.inputs_path, generated)
        with patch.object(candidate, '_safe_ancestors'):
            preflight = candidate.validate_preflight(
                self.inputs_path,
                self.state,
                self.manifest_path,
                self.gateway_unit,
                os.getuid(),
                candidate.DEADLINE_EPOCH - 1,
                self.package_path,
            )
        self.assertEqual(
            preflight['identity']['restRoutes'],
            self.inputs()['identity']['restRoutes'],
        )
        self.assertEqual(preflight['deadline'], candidate.DEADLINE)


def stat_result(original, uid):
    return type('Metadata', (), {
        'st_mode': original.st_mode,
        'st_uid': uid,
        'st_nlink': original.st_nlink,
        'st_size': original.st_size,
        'st_dev': original.st_dev,
        'st_ino': original.st_ino,
        'st_mtime_ns': original.st_mtime_ns,
        'st_ctime_ns': original.st_ctime_ns,
    })()


if __name__ == '__main__':
    unittest.main()
