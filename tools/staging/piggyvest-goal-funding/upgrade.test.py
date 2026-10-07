import hashlib
import importlib.util
from contextlib import nullcontext
from pathlib import Path
import stat
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location('piggyvest_upgrade', HERE / 'upgrade.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
DEPLOY = MODULE.deploy
PREDECESSOR = b'''server {
    listen 443 ssl;
    server_name staging-auth.ogabassey.com;
    location = /api/storefront/customer/savings/funding {
        if ($request_method !~ ^(POST)$) { return 405; }
        proxy_pass http://127.0.0.1:4795;
    }
    location = /api/storefront/customer/savings/other-goal {
        if ($request_method !~ ^(GET|POST)$) { return 405; }
        proxy_pass http://127.0.0.1:4795;
    }
    location = /piggyvest/intake { proxy_pass http://127.0.0.1:4791; }
    location / { return 404; }
}
'''
PREDECESSOR_DIGEST = hashlib.sha256(PREDECESSOR).hexdigest()
NGINX = DEPLOY.render_nginx(PREDECESSOR, PREDECESSOR_DIGEST)
METADATA = SimpleNamespace(st_dev=1, st_ino=2, st_size=len(NGINX), st_mtime_ns=3,
                           st_ctime_ns=4, st_uid=0, st_gid=0, st_mode=stat.S_IFREG | 0o400)


class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.artifact = Mock()
        self.artifact.ROOT = Path('/opt/baci-savings-funding')
        self.artifact.prepare.return_value = Path('/opt/staged')
        self.artifact.activate.return_value = Path('/opt/baci-savings-funding.rollback-123')
        self.candidate = Mock()
        self.artifact.load_pinned.return_value = self.candidate
        self.artifact.swap.side_effect = lambda _backup, check: check()
        self.events = []
        self.clock = [DEPLOY.EXPIRY - 10]
        self.patches = [
            patch.object(DEPLOY, 'load_bundle', return_value=({'expectedNginxSha256': PREDECESSOR_DIGEST}, self.artifact)),
            patch.object(DEPLOY, 'deployment_lock', return_value=nullcontext()),
            patch.object(DEPLOY, 'secure_read', return_value=(NGINX, METADATA)),
            patch.object(DEPLOY, 'probe', side_effect=lambda *args, **kwargs: self.events.append(('probe', args, kwargs)) or 401),
            patch.object(DEPLOY, 'check_routes', side_effect=lambda _baseline, updated: self.events.append(('routes', updated))),
            patch.object(MODULE, 'verify', side_effect=lambda *args: self.events.append(('direct', args))),
            patch.object(MODULE.time, 'time', side_effect=lambda: self.clock[0]),
        ]
        for active_patch in self.patches:
            active_patch.start()
            self.addCleanup(active_patch.stop)
        self.artifact.prepare.side_effect = lambda: self.events.append('prepare') or Path('/opt/staged')
        self.artifact.activate.side_effect = lambda _staged: self.events.append('activate') or Path('/opt/baci-savings-funding.rollback-123')

    def test_preflight_requires_updated_get_post_put_and_public_baselines_before_activation(self):
        updated_flags = []

        def refuse_preflight(_baseline, updated):
            updated_flags.append(updated)
            raise DEPLOY.ReadinessRefused({'phase': 'preflight'})

        with patch.object(DEPLOY, 'check_routes', side_effect=refuse_preflight):
            with self.assertRaises(DEPLOY.ReadinessRefused):
                MODULE.install()
        self.assertEqual(updated_flags, [True])
        self.artifact.prepare.assert_not_called()
        self.artifact.activate.assert_not_called()
        self.assertEqual(self.events[0], ('probe', ('GET', DEPLOY.BASELINE[0][1]), {}))

    def test_nginx_pin_mismatch_refuses_before_activation(self):
        with patch.object(DEPLOY, 'secure_read', return_value=(NGINX + b'# drift\n', METADATA)):
            with self.assertRaisesRegex((DEPLOY.Refused, MODULE.Refused), 'predecessor'):
                MODULE.install()
        self.artifact.prepare.assert_not_called()
        self.artifact.activate.assert_not_called()

    def test_current_nginx_must_be_exact_output_of_pinned_post_guard_transformation(self):
        tampered = (
            NGINX.replace(b'server_name staging-auth.ogabassey.com;', b'server_name other.example;'),
            NGINX.replace(b'location = /api/storefront/customer/savings/funding', b'location /api/storefront/customer/savings/funding'),
            NGINX.replace(b'^(GET|POST)$', b'^(POST)$'),
            NGINX.replace(b'^(GET|POST)$', b'^(GET|POST|PUT)$'),
        )
        for content in tampered:
            with self.subTest(content=content), self.assertRaises((DEPLOY.Refused, MODULE.Refused)):
                MODULE.validate_current_nginx(content, PREDECESSOR_DIGEST)

    def test_unrelated_location_get_guard_is_preserved_during_pin_proof(self):
        MODULE.validate_current_nginx(NGINX, PREDECESSOR_DIGEST)
        self.assertEqual(NGINX.count(b'if ($request_method !~ ^(GET|POST)$) { return 405; }'), 2)

    def test_expired_lease_between_prepare_and_activate_refuses(self):
        self.clock[0] = DEPLOY.EXPIRY - 1
        self.artifact.prepare.side_effect = lambda: (self.clock.__setitem__(0, DEPLOY.EXPIRY), Path('/opt/staged'))[1]
        with self.assertRaisesRegex(MODULE.Refused, 'lease expired'):
            MODULE.install()
        self.artifact.activate.assert_not_called()

    def test_lease_expiring_during_final_nginx_read_refuses_activation(self):
        reads = [0]

        def expire_during_final_read(_path, _limit):
            reads[0] += 1
            if reads[0] == 2:
                self.clock[0] = DEPLOY.EXPIRY
            return NGINX, METADATA

        with patch.object(DEPLOY, 'secure_read', side_effect=expire_during_final_read):
            with self.assertRaisesRegex(MODULE.Refused, 'lease expired'):
                MODULE.install()
        self.assertEqual(reads[0], 2)
        self.artifact.activate.assert_not_called()

    def test_success_verifies_direct_and_public_routes_without_nginx_commands_or_writes(self):
        with patch.object(DEPLOY, 'atomic_replace') as nginx_write, patch.object(DEPLOY.subprocess, 'run') as command:
            result = MODULE.install()
        self.assertEqual(result['status'], 'active')
        self.assertLess(self.events.index(('routes', True)), self.events.index('prepare'))
        self.assertLess(self.events.index('prepare'), self.events.index('activate'))
        self.assertEqual(self.events.count(('routes', True)), 2)
        direct_events = [event for event in self.events if isinstance(event, tuple) and event[0] == 'direct']
        self.assertEqual(len(direct_events), 1)
        self.assertEqual(direct_events[0][1][0], DEPLOY.DIRECT_FUNDING_EXPECTATIONS)
        nginx_write.assert_not_called()
        command.assert_not_called()
        self.assertEqual(self.clock[0], DEPLOY.EXPIRY - 10)

    def test_direct_failure_rolls_back_only_artifact_after_validating_backup(self):
        report = {'phase': 'funding-service-ready', 'checks': [], 'deadlineReached': False}
        original_lstat = Path.lstat
        with patch.object(MODULE, 'verify', side_effect=DEPLOY.ReadinessRefused(report)), \
                patch.object(Path, 'lstat', autospec=True, side_effect=lambda path: SimpleNamespace(
                    st_mode=stat.S_IFDIR | 0o700, st_uid=0) if path == self.artifact.activate.return_value else original_lstat(path)):
            with self.assertRaises(DEPLOY.ReadinessRefused):
                MODULE.install()
        self.artifact.swap.assert_called_once()
        self.candidate._verify_artifact_tree.assert_called_once_with(self.artifact.activate.return_value)
        self.candidate._verify_service_artifact_access.assert_called_once_with(self.artifact.activate.return_value)

    def test_keyboard_interrupt_after_activation_rolls_back_artifact(self):
        original_lstat = Path.lstat
        with patch.object(MODULE, 'verify', side_effect=KeyboardInterrupt()), \
                patch.object(Path, 'lstat', autospec=True, side_effect=lambda path: SimpleNamespace(
                    st_mode=stat.S_IFDIR | 0o700, st_uid=0) if path == self.artifact.activate.return_value else original_lstat(path)):
            with self.assertRaises(KeyboardInterrupt):
                MODULE.install()
        self.artifact.swap.assert_called_once()

    def test_lease_expiry_after_postactivation_checks_rolls_back_artifact(self):
        original_lstat = Path.lstat
        route_checks = [0]

        def expire_after_final_route_check(_baseline, updated):
            self.assertTrue(updated)
            route_checks[0] += 1
            self.events.append(('routes', True))
            if route_checks[0] == 2:
                self.clock[0] = DEPLOY.EXPIRY

        with patch.object(DEPLOY, 'check_routes', side_effect=expire_after_final_route_check), \
                patch.object(Path, 'lstat', autospec=True, side_effect=lambda path: SimpleNamespace(
                    st_mode=stat.S_IFDIR | 0o700, st_uid=0) if path == self.artifact.activate.return_value else original_lstat(path)):
            with self.assertRaisesRegex(MODULE.Refused, 'lease expired'):
                MODULE.install()
        self.artifact.swap.assert_called_once()

    def test_public_failure_rolls_back_artifact_without_nginx_mutation(self):
        original_lstat = Path.lstat
        with patch.object(DEPLOY, 'check_routes', side_effect=[None, MODULE.Refused('public route failure')]), \
                patch.object(DEPLOY, 'atomic_replace') as nginx_write, \
                patch.object(Path, 'lstat', autospec=True, side_effect=lambda path: SimpleNamespace(
                    st_mode=stat.S_IFDIR | 0o700, st_uid=0) if path == self.artifact.activate.return_value else original_lstat(path)):
            with self.assertRaisesRegex(MODULE.Refused, 'public route failure'):
                MODULE.install()
        self.artifact.swap.assert_called_once()
        nginx_write.assert_not_called()

    def test_unsafe_backup_refuses_rollback(self):
        with patch.object(MODULE, 'verify', side_effect=DEPLOY.ReadinessRefused({})), \
                patch.object(MODULE, 'validate_backup', side_effect=MODULE.Refused('Artifact rollback path is unsafe')):
            with self.assertRaisesRegex(MODULE.Refused, 'operator recovery'):
                MODULE.install()
        self.artifact.swap.assert_not_called()

    def test_main_requires_explicit_install(self):
        with patch.object(sys, 'argv', ['upgrade.py']), patch.object(MODULE, 'install') as install:
            with self.assertRaisesRegex(MODULE.Refused, 'Explicit --install'):
                MODULE.main()
        install.assert_not_called()


if __name__ == '__main__':
    unittest.main()
