import hashlib
import importlib.util
import unittest
from unittest.mock import call
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location(
    'customer_wallet_route_installer', Path(__file__).with_name('install-customer-wallet-route.py')
)
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)
def load_sibling(name, filename):
    spec = importlib.util.spec_from_file_location(
        name, Path(__file__).with_name(filename)
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


draft_routes = load_sibling('wallet_route_draft_fixture', 'install-customer-draft-routes.py')
intake_route = load_sibling('wallet_route_intake_fixture', 'install-intake-route.py')
CONFIG = (
    b'server {\n'
    b'    listen 443 ssl;\n'
    b'    server_name staging-auth.ogabassey.com;\n'
    + installer.HELPERS.LOCATIONS
    + draft_routes.LOCATIONS
    + intake_route.LOCATION
    + b'    location / { return 503; }\n'
    + b'}\n'
)
DIGEST = hashlib.sha256(CONFIG).hexdigest()


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.metadata = SimpleNamespace(
            st_mode=0o100640, st_uid=0, st_gid=0, st_dev=1, st_ino=2
        )
        self.backup = Mock()
        self.backup.read_bytes.return_value = CONFIG
        self.read_target = Mock(return_value=(CONFIG, self.metadata))
        self.write = Mock()
        self.write.side_effect = lambda value, *_: self.read_target.configure_mock(
            return_value=(value, self.metadata)
        )
        self.validate_reload = Mock()
        self.probe = Mock(
            side_effect=[200, 403, 404, 405, 401, 405, 401, 200, 403]
        )
        self.patches = [
            patch.object(installer.os, 'geteuid', return_value=0),
            patch.object(installer.os, 'getuid', return_value=0),
            patch.object(installer.HELPERS, 'read_target', self.read_target),
            patch.object(installer.HELPERS, 'make_backup', return_value=self.backup),
            patch.object(installer.HELPERS, 'atomic_write', self.write),
            patch.object(installer.HELPERS, 'validate_reload', self.validate_reload),
            patch.object(installer, 'probe_status', self.probe),
            patch.object(installer.time, 'monotonic', return_value=100),
            patch.object(installer.time, 'sleep'),
        ]
        for active_patch in self.patches:
            active_patch.start()
            self.addCleanup(active_patch.stop)

    def test_installs_after_hash_pin_and_safe_validation(self):
        installer.install(DIGEST)

        self.assertEqual(self.write.call_count, 1)
        self.assertEqual(self.write.call_args.args[0].count(b'location = /api/storefront/customer/wallet {'), 1)
        self.validate_reload.assert_called_once_with()
        self.assertEqual(self.probe.call_count, 9)
        self.probe.assert_has_calls(
            [
                call('GET', installer.INTAKE_PATH),
                call('POST', installer.INTAKE_PATH),
                call('GET', installer.WALLET_PATH, 10),
                call('POST', installer.WALLET_PATH, 10),
                call('GET', installer.WALLET_PATH, 10),
                call('POST', installer.WALLET_PATH, 10),
                call('GET', installer.DRAFTS_PATH),
                call('GET', installer.INTAKE_PATH),
                call('POST', installer.INTAKE_PATH),
            ]
        )

    def test_wrong_hash_has_no_backup_write_or_reload(self):
        with self.assertRaises(installer.Refused):
            installer.install('0' * 64)

        self.backup.read_bytes.assert_not_called()
        self.write.assert_not_called()
        self.validate_reload.assert_not_called()
        self.probe.assert_not_called()

    def test_terminal_wallet_probe_failure_restores_original_config(self):
        self.probe.side_effect = [200, 403, 404, 405, 404, 405]
        self.patches.append(patch.object(installer.time, 'monotonic', side_effect=[100, 100, 110]))
        self.patches[-1].start()
        self.addCleanup(self.patches[-1].stop)

        with self.assertRaisesRegex(installer.Refused, 'original configuration restored'):
            installer.install(DIGEST)

        self.assertEqual(self.write.call_count, 2)
        self.assertEqual(self.write.call_args.args[0], CONFIG)
        self.assertEqual(self.validate_reload.call_count, 2)

    def test_changed_intake_baseline_after_reload_restores_original_config(self):
        self.probe.side_effect = [200, 403, 401, 405, 401, 200, 502]

        with self.assertRaisesRegex(installer.Refused, 'original configuration restored'):
            installer.install(DIGEST)

        self.assertEqual(self.write.call_count, 2)
        self.assertEqual(self.write.call_args.args[0], CONFIG)
        self.assertEqual(self.validate_reload.call_count, 2)

    def test_rollback_failure_reports_generic_operator_attention(self):
        self.probe.side_effect = [200, 403, 500]
        self.validate_reload.side_effect = [None, RuntimeError('private reload output')]

        with self.assertRaisesRegex(installer.Refused, 'rollback requires operator attention'):
            installer.install(DIGEST)

        self.assertEqual(self.write.call_count, 2)
        self.assertEqual(self.write.call_args.args[0], CONFIG)


if __name__ == '__main__':
    unittest.main()
