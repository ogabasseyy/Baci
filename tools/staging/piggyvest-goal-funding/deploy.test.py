import hashlib
import importlib.util
from contextlib import nullcontext
from pathlib import Path
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location('piggyvest_deploy', Path(__file__).with_name('deploy.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

NGINX = b'''server {
    listen 443 ssl;
    server_name staging-auth.ogabassey.com;
    location = /api/storefront/customer/savings/funding {
        if ($request_method !~ ^(POST)$) { return 405; }
        proxy_pass http://127.0.0.1:4795;
    }
    location = /piggyvest/intake { proxy_pass http://127.0.0.1:4791; }
    location / { return 404; }
}
'''


class DeployTests(unittest.TestCase):
    def setUp(self):
        clock = patch('readiness.time.time', return_value=MODULE.EXPIRY - 100)
        clock.start()
        self.addCleanup(clock.stop)

    def test_rewrites_only_post_limit_for_exact_staging_funding_location(self):
        rendered = MODULE.render_nginx(NGINX, hashlib.sha256(NGINX).hexdigest())
        replacement = b'if ($request_method !~ ^(GET|POST)$) { return 405; }'
        self.assertEqual(rendered.replace(replacement, b'if ($request_method !~ ^(POST)$) { return 405; }'), NGINX)
        self.assertIn(replacement, rendered)

    def test_direct_probe_pins_its_origin_and_respects_remaining_timeout(self):
        with patch.object(MODULE.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='401')) as command:
            self.assertEqual(MODULE.probe('GET', MODULE.FUNDING, timeout=0.125, direct=True), 401)
        self.assertEqual(command.call_args.kwargs['timeout'], 0.125)
        self.assertEqual(command.call_args.args[0][-1], 'http://127.0.0.1:4795' + MODULE.FUNDING)
        self.assertIn('Host: staging.ogabassey.com', command.call_args.args[0])

    def test_refuses_hash_drift_wrong_method_duplicate_location_and_other_host(self):
        cases = (
            (NGINX, '0' * 64),
            (NGINX.replace(b'^(POST)$', b'^(GET)$'), hashlib.sha256(NGINX.replace(b'^(POST)$', b'^(GET)$')).hexdigest()),
            (NGINX + NGINX, hashlib.sha256(NGINX + NGINX).hexdigest()),
            (NGINX.replace(b'staging-auth.ogabassey.com', b'other.example'), hashlib.sha256(NGINX.replace(b'staging-auth.ogabassey.com', b'other.example')).hexdigest()),
        )
        for content, expected in cases:
            with self.subTest(expected=expected), self.assertRaises(MODULE.Refused):
                MODULE.render_nginx(content, expected)

    def test_refuses_unanchored_or_broadened_post_guard(self):
        for guard in (b'POST', b'(POST)', b'^POST', b'POST$', b'^(GET|POST)$', b'^(POST|PUT)$'):
            content = NGINX.replace(b'^(POST)$', guard)
            with self.subTest(guard=guard), self.assertRaises(MODULE.Refused):
                MODULE.render_nginx(content, hashlib.sha256(content).hexdigest())

    def test_refuses_duplicate_guards_in_the_same_funding_location(self):
        guard = b'if ($request_method !~ ^(POST)$) { return 405; }'
        content = NGINX.replace(guard, guard + b'\n' + guard)
        with self.assertRaises(MODULE.Refused):
            MODULE.render_nginx(content, hashlib.sha256(content).hexdigest())

    def test_nginx_shape_refusal_does_not_prepare_or_activate_an_artifact(self):
        artifact = Mock()
        content = NGINX.replace(b'^(POST)$', b'^(PUT)$')
        with (
            patch.object(MODULE, 'load_bundle', return_value=({'expectedNginxSha256': hashlib.sha256(content).hexdigest()}, artifact)),
            patch.object(MODULE, 'deployment_lock', return_value=nullcontext()),
            patch.object(MODULE, 'secure_read', return_value=(content, Mock())),
            patch.object(MODULE.time, 'time', return_value=MODULE.EXPIRY - 1),
        ):
            with self.assertRaises(MODULE.Refused):
                MODULE.install()
        artifact.prepare.assert_not_called()
        artifact.activate.assert_not_called()

    def test_private_funding_and_baseline_probes_require_expected_statuses(self):
        statuses = {(method, route): expected if expected is not None else 405 for method, route, expected in MODULE.BASELINE}
        baseline = statuses.copy()
        statuses[('GET', MODULE.FUNDING)] = 401
        statuses[('POST', MODULE.FUNDING)] = 401
        statuses[('PUT', MODULE.FUNDING)] = 405
        with patch.object(MODULE, 'probe', side_effect=lambda method, route, timeout: statuses[(method, route)]):
            MODULE.check_routes(baseline, updated=True)
        statuses[('GET', MODULE.FUNDING)] = 200
        with patch.object(MODULE, 'probe', side_effect=lambda method, route, timeout: statuses[(method, route)]):
            with self.assertRaises(MODULE.ReadinessRefused) as failure:
                MODULE.check_routes(baseline, updated=True)
        self.assertEqual(failure.exception.report['phase'], 'nginx-ready')
        self.assertEqual(failure.exception.report['checks'][-1]['actual'], 200)
        statuses[('GET', MODULE.FUNDING)] = 405
        with patch.object(MODULE, 'probe', side_effect=lambda method, route, timeout: statuses[(method, route)]):
            MODULE.check_routes(baseline, updated=False)

    def test_stages_and_activates_artifact_before_nginx_write(self):
        events = []
        artifact = Mock()
        artifact.prepare.side_effect=lambda: events.append('prepare') or Path('/opt/staged')
        artifact.activate.side_effect=lambda staged: events.append('activate') or Path('/opt/baci-savings-funding.rollback-test')
        artifact.ROOT = Path('/opt/baci-savings-funding')
        metadata = SimpleNamespace(st_dev=1, st_ino=2, st_size=len(NGINX), st_mtime_ns=3, st_ctime_ns=4,
                                   st_uid=0, st_gid=0, st_mode=0o100400)
        probe_state = {'updated': False}

        def probe(method, route):
            if route == MODULE.FUNDING:
                return 401 if method == 'POST' or probe_state['updated'] else 405
            return next(status for expected_method, expected_route, status in MODULE.BASELINE
                        if (expected_method, expected_route) == (method, route))

        def replace(_path, _content, _expected, _metadata):
            events.append('nginx-write')
            probe_state['updated'] = True

        with (
            patch.object(MODULE, 'load_bundle', return_value=({'expectedNginxSha256': hashlib.sha256(NGINX).hexdigest()}, artifact)),
            patch.object(MODULE, 'deployment_lock', return_value=nullcontext()),
            patch.object(MODULE, 'secure_read', return_value=(NGINX, metadata)),
            patch.object(MODULE, 'save_backup', return_value=Path('/var/lib/backup')),
            patch.object(MODULE, 'atomic_replace', side_effect=replace),
            patch.object(MODULE, 'probe', side_effect=probe),
            patch.object(MODULE, 'check_routes', side_effect=lambda baseline, updated: events.append('routes-updated' if updated else 'routes-baseline')),
            patch.object(MODULE, 'verify', side_effect=lambda *args: events.append('direct-health')),
            patch.object(MODULE, 'subprocess') as commands,
            patch.object(MODULE, 'time') as mocked_time,
        ):
            mocked_time.time.return_value = MODULE.EXPIRY - 1
            MODULE.install()
        self.assertLess(events.index('prepare'), events.index('activate'))
        self.assertLess(events.index('activate'), events.index('nginx-write'))
        self.assertLess(events.index('direct-health'), events.index('nginx-write'))
        self.assertTrue(any(call.args[0][:2] == ['/usr/sbin/nginx', '-t'] for call in commands.run.call_args_list))

    def test_graceful_reload_old_get_405_waits_for_two_new_worker_401_samples(self):
        baseline = {(method, route): expected if expected is not None else 405 for method, route, expected in MODULE.BASELINE}
        observed = []

        def probe(method, route, timeout=2):
            if route == MODULE.FUNDING:
                if method == 'GET':
                    observed.append(405 if not observed else 401)
                    return observed[-1]
                return 401 if method == 'POST' else 405
            return baseline[(method, route)]

        with patch.object(MODULE, 'probe', side_effect=probe), patch('readiness.time.sleep'):
            MODULE.check_routes(baseline, updated=True)
        self.assertEqual(observed, [405, 401, 401])

    def test_direct_get_failure_restores_artifact_before_any_nginx_write(self):
        artifact = Mock()
        artifact.ROOT = Path('/opt/baci-savings-funding')
        artifact.activate.return_value = Path('/opt/baci-savings-funding.rollback-test')
        candidate = artifact.load_pinned.return_value
        artifact.swap.side_effect = lambda staged, verify: verify()
        report = {'phase': 'funding-service-ready', 'checks': [
            {'method': 'GET', 'path': MODULE.FUNDING, 'expected': 401, 'actual': 500},
        ], 'deadlineReached': False}
        original_lstat = Path.lstat
        with (
            patch.object(MODULE, 'load_bundle', return_value=({'expectedNginxSha256': hashlib.sha256(NGINX).hexdigest()}, artifact)),
            patch.object(MODULE, 'deployment_lock', return_value=nullcontext()),
            patch.object(MODULE, 'secure_read', return_value=(NGINX, Mock())),
            patch.object(MODULE, 'save_backup', return_value=Path('/var/lib/backup')),
            patch.object(MODULE, 'atomic_replace') as nginx_write,
            patch.object(MODULE, 'probe', return_value=401),
            patch.object(MODULE, 'check_routes'),
            patch.object(MODULE, 'verify', side_effect=MODULE.ReadinessRefused(report)),
            patch.object(Path, 'lstat', autospec=True, side_effect=lambda path: SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0) if path == artifact.activate.return_value else original_lstat(path)),
            patch.object(MODULE.time, 'time', return_value=MODULE.EXPIRY - 1),
        ):
            with self.assertRaises(MODULE.ReadinessRefused) as failure:
                MODULE.install()
        self.assertEqual(failure.exception.report, report)
        nginx_write.assert_not_called()
        artifact.swap.assert_called_once()
        candidate._verify_artifact_tree.assert_called_once_with(artifact.activate.return_value)
        candidate._verify_service_artifact_access.assert_called_once_with(artifact.activate.return_value)

    def test_failed_post_activation_route_check_restores_nginx_and_artifact(self):
        artifact = Mock()
        artifact.prepare.return_value = Path('/opt/staged')
        artifact.activate.return_value = Path('/opt/baci-savings-funding.rollback-test')
        artifact.ROOT = Path('/opt/baci-savings-funding')
        candidate = Mock()
        artifact.load_pinned.return_value = candidate
        artifact.swap.side_effect = lambda staged, verify: verify()
        metadata = SimpleNamespace(st_dev=1, st_ino=2, st_size=len(NGINX), st_mtime_ns=3, st_ctime_ns=4,
                                   st_uid=0, st_gid=0, st_mode=0o100400)
        observed = {'changed': False}

        def read(_path, _limit):
            return (MODULE.render_nginx(NGINX, hashlib.sha256(NGINX).hexdigest()), metadata) if observed['changed'] else (NGINX, metadata)

        replacements = []
        original_lstat = Path.lstat

        def replace(_path, content, _expected, _metadata):
            replacements.append(content)
            observed['changed'] = content != NGINX

        with (
            patch.object(MODULE, 'load_bundle', return_value=({'expectedNginxSha256': hashlib.sha256(NGINX).hexdigest()}, artifact)),
            patch.object(MODULE, 'deployment_lock', return_value=nullcontext()),
            patch.object(Path, 'lstat', autospec=True, side_effect=lambda path: SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0) if path == artifact.activate.return_value else original_lstat(path)),
            patch.object(MODULE, 'secure_read', side_effect=read),
            patch.object(MODULE, 'save_backup', return_value=Path('/var/lib/backup')),
            patch.object(MODULE, 'atomic_replace', side_effect=replace),
            patch.object(MODULE, 'probe', return_value=401),
            patch.object(MODULE, 'check_routes', side_effect=[None, MODULE.Refused('readiness failed')]),
            patch.object(MODULE, 'verify'),
            patch.object(MODULE, 'subprocess') as commands,
            patch.object(MODULE, 'time') as mocked_time,
        ):
            mocked_time.time.return_value = MODULE.EXPIRY - 1
            with self.assertRaisesRegex(MODULE.Refused, 'readiness failed'):
                MODULE.install()
        self.assertEqual(replacements, [MODULE.render_nginx(NGINX, hashlib.sha256(NGINX).hexdigest()), NGINX])
        artifact.swap.assert_called_once()
        self.assertEqual(commands.run.call_count, 4)
        candidate._verify_artifact_tree.assert_called_once_with(artifact.activate.return_value)
        candidate._verify_service_artifact_access.assert_called_once_with(artifact.activate.return_value)

    def test_nginx_rollback_failure_does_not_skip_artifact_restore(self):
        artifact = Mock()
        artifact.prepare.return_value = Path('/opt/staged')
        artifact.activate.return_value = Path('/opt/baci-savings-funding.rollback-test')
        artifact.ROOT = Path('/opt/baci-savings-funding')
        artifact.load_pinned.return_value = Mock()
        metadata = SimpleNamespace(st_dev=1, st_ino=2, st_size=len(NGINX), st_mtime_ns=3, st_ctime_ns=4,
                                   st_uid=0, st_gid=0, st_mode=0o100400)
        current = {'content': NGINX}
        original_lstat = Path.lstat

        def read(_path, _limit):
            return current['content'], metadata

        def replace(_path, content, _expected, _metadata):
            current['content'] = content

        with (
            patch.object(MODULE, 'load_bundle', return_value=({'expectedNginxSha256': hashlib.sha256(NGINX).hexdigest()}, artifact)),
            patch.object(MODULE, 'deployment_lock', return_value=nullcontext()),
            patch.object(MODULE, 'secure_read', side_effect=read),
            patch.object(MODULE, 'save_backup', return_value=Path('/var/lib/backup')),
            patch.object(MODULE, 'atomic_replace', side_effect=replace),
            patch.object(MODULE, 'probe', side_effect=lambda method, route: 401 if route == MODULE.FUNDING and current['content'] != NGINX or route != MODULE.FUNDING else 405),
            patch.object(MODULE, 'check_routes', side_effect=[None, MODULE.Refused('readiness failed')]),
            patch.object(MODULE, 'verify'),
            patch.object(MODULE.Path, 'lstat', autospec=True, side_effect=lambda path: SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0) if path == artifact.activate.return_value else original_lstat(path)),
            patch.object(MODULE, 'subprocess') as commands,
            patch.object(MODULE, 'time') as mocked_time,
        ):
            mocked_time.time.return_value = MODULE.EXPIRY - 1
            commands.run.side_effect = [None, None, RuntimeError('nginx reload failed')]
            with self.assertRaisesRegex(MODULE.Refused, 'operator recovery'):
                MODULE.install()
        artifact.swap.assert_called_once()


if __name__ == '__main__':
    unittest.main()
