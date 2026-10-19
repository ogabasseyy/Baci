import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import mixed_public_contract as contract
SPEC = importlib.util.spec_from_file_location('bundle_fixture', HERE / 'activation_bundle.test.py')
fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixture)


class MixedPublicContractTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture.ActivationBundleTests()
        self.fixture.setUp()
        root = self.fixture.candidate / 'artifacts'
        self.activation = (root / 'activation.prepared.json').read_bytes().replace(
            b'2026-10-06T15:59:10Z', b'2026-09-29T15:59:10Z')
        self.checkout = (root / 'public/checkout.json').read_bytes()
        self.launcher = b'fixture-launcher'
        self.receipt = json.dumps({'deadline': contract.DEADLINE, 'archiveSha256': contract.ARCHIVE,
            'manifestSha256': contract.MANIFEST, 'mutationsEnabled': False,
            'checkoutSha256': hashlib.sha256(self.checkout).hexdigest(),
            'anonSha256': '4763e070945b3ab7a954c12e8da7ed9d3cd79b44b30ef6843eb2da567126934e',
            'predecessorArchiveSha256': '8f3babb4f2d6a9ecbbdc9d87c8209cbe45dbe6e124b7f059e1e391eeeb113134',
            'predecessorManifestSha256': '7790f11a4a4254c5c79d5841e92fc927163f29ed06007466696e9fd4d91f8bf3'}).encode()
        units = contract.public_service_contract.units()
        self.service = units['baci-prefunded-public.service'].replace('1790697550', '1791302350').encode()
        self.timer = units['baci-prefunded-public-deadline.timer'].replace(
            '2026-09-29 15:59:10 UTC', '2026-10-06 15:59:10 UTC').encode()

    def tearDown(self):
        try:
            self.fixture.tearDown()
        finally:
            self.fixture.doCleanups()

    def validate(self, checkout=None, receipt=None, service=None):
        with patch.object(contract, 'LAUNCHER', hashlib.sha256(self.launcher).hexdigest()):
            contract.validate_mixed_public(self.activation, checkout or self.checkout,
                receipt or self.receipt, self.launcher, service or self.service, self.timer)

    def test_accepts_only_exact_already_renewed_readonly_public_contract(self):
        self.validate()

    def test_refuses_scope_or_provider_drift_hidden_in_current_deadline_config(self):
        changed = json.loads(self.checkout)
        changed['maximumAmountKobo'] = 20000
        with self.assertRaisesRegex(ValueError, 'mixed_public_checkout_refused'):
            self.validate(checkout=json.dumps(changed, sort_keys=True, separators=(',', ':')).encode())

    def test_refuses_current_receipt_if_mutations_or_installed_manifest_changed(self):
        for key, value in (('mutationsEnabled', True), ('manifestSha256', '0' * 64)):
            changed = {**json.loads(self.receipt), key: value}
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'mixed_public_receipt_refused'):
                self.validate(receipt=json.dumps(changed).encode())

    def test_refuses_unapproved_service_change_even_with_correct_deadline_epoch(self):
        with self.assertRaisesRegex(ValueError, 'mixed_public_units_refused'):
            self.validate(service=self.service + b'Environment=UNREVIEWED=true\n')


if __name__ == '__main__':
    unittest.main()
