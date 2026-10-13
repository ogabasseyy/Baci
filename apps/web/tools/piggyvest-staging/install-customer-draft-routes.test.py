import hashlib
import importlib.util
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location('draft_installer', Path(__file__).with_name('install-customer-draft-routes.py'))
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)
CONFIG = b'''server {
    listen 443 ssl;
    server_name staging-auth.ogabassey.com;
    ssl_certificate /etc/ssl/example.pem;
    location / { return 503; }
}
# retained trailing comment
'''


def digest(content=CONFIG):
    return hashlib.sha256(content).hexdigest()


class RenderTests(unittest.TestCase):
    def test_preserves_every_original_byte_and_adds_three_exact_locations(self):
        rendered = installer.render_config(CONFIG, digest())
        self.assertEqual(rendered.replace(b'\n' + installer.LOCATIONS, b'', 1), CONFIG)
        self.assertEqual(rendered.count(b'location = /api/storefront/customer/savings/drafts {'), 1)
        self.assertEqual(rendered.count(b'location = /api/storefront/customer/savings/drafts/policy {'), 1)
        self.assertEqual(rendered.count(b'location = /api/storefront/customer/savings/drafts/catalogue {'), 1)
        self.assertEqual(rendered.count(b'proxy_pass http://127.0.0.1:4792;'), 3)
        self.assertEqual(rendered.count(b'proxy_set_header Host staging.ogabassey.com;'), 3)
        self.assertEqual(rendered.count(b'proxy_set_header X-Forwarded-Host staging.ogabassey.com;'), 3)
        self.assertEqual(rendered.count(b'proxy_set_header X-Forwarded-Proto https;'), 3)
        self.assertEqual(rendered.count(b'proxy_set_header Forwarded "";'), 3)
        self.assertEqual(rendered.count(b'proxy_set_header x-middleware-subrequest "";'), 3)
        self.assertIn(b'if ($request_method !~ ^(GET|POST)$) { return 405; }', rendered)
        self.assertIn(b'if ($request_method !~ ^GET$) { return 405; }', rendered)

    def test_renders_no_wildcard_webhook_or_auth_override(self):
        rendered = installer.render_config(CONFIG, digest())
        self.assertNotIn(b'location /api/', rendered)
        self.assertNotIn(b'api/webhooks/piggyvest', rendered)
        self.assertNotIn(b'piggyvest/intake', rendered)
        self.assertNotIn(b'auth_basic off', rendered)
        self.assertNotIn(b'satisfy any', rendered)
        self.assertNotIn(b'$proxy_add_x_forwarded_for', rendered)

    def test_invalid_hash_is_rejected(self):
        for expected in ('', 'z' * 64, '0' * 64, 'a' * 63):
            with self.subTest(expected=expected), self.assertRaises(installer.Refused):
                installer.render_config(CONFIG, expected)

    def test_missing_duplicate_or_aliased_host_is_rejected(self):
        for content in (CONFIG.replace(installer.HOST, b'other.example'),
                        CONFIG + CONFIG,
                        CONFIG.replace(installer.HOST, installer.HOST + b' other.example')):
            with self.subTest(content=content), self.assertRaises(installer.Refused):
                installer.render_config(content, digest(content))

    def test_existing_route_is_rejected(self):
        rendered = installer.render_config(CONFIG, digest())
        with self.assertRaises(installer.Refused):
            installer.render_config(rendered, digest(rendered))

    def test_wrong_final_server_or_unbalanced_input_is_rejected(self):
        for content in (CONFIG + b'server { server_name other.example; }', CONFIG + b'}', CONFIG + b'"'):
            with self.subTest(content=content), self.assertRaises(installer.Refused):
                installer.render_config(content, digest(content))


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.metadata = SimpleNamespace(st_mode=stat.S_IFREG | 0o640, st_uid=0,
                                        st_gid=0, st_dev=1, st_ino=2)
        self.backup = Mock()
        self.backup.read_bytes.return_value = CONFIG
        self.patches = [patch.object(installer.os, 'geteuid', return_value=0),
                        patch.object(installer.os, 'getuid', return_value=0),
                        patch.object(installer, 'read_target', return_value=(CONFIG, self.metadata)),
                        patch.object(installer, 'make_backup', return_value=self.backup),
                        patch.object(installer, 'atomic_write'),
                        patch.object(installer.subprocess, 'run')]
        self.euid, self.uid, self.read, self.backup_call, self.write, self.run = [
            self.enterContext(patcher) for patcher in self.patches]
        self.write.side_effect = lambda content, *_: setattr(self.read, 'return_value', (content, self.metadata))

    def test_wrong_hash_has_no_mutations_or_commands(self):
        with self.assertRaises(installer.Refused):
            installer.install('0' * 64)
        self.backup_call.assert_not_called()
        self.write.assert_not_called()
        self.run.assert_not_called()

    def test_root_checks_precede_file_access(self):
        for effective, real in ((1, 0), (0, 1)):
            self.euid.return_value, self.uid.return_value = effective, real
            with self.assertRaises(installer.Refused):
                installer.install(digest())
        self.read.assert_not_called()
        self.write.assert_not_called()

    def test_success_tests_before_reload_and_suppresses_output(self):
        installer.install(digest())
        self.assertEqual(self.write.call_count, 1)
        self.assertEqual([call.args[0] for call in self.run.call_args_list],
                         [['/usr/sbin/nginx', '-t'], ['/usr/bin/systemctl', 'reload', 'nginx']])
        for call in self.run.call_args_list:
            self.assertEqual(call.kwargs['stderr'], subprocess.DEVNULL)
            self.assertEqual(call.kwargs['stdout'], subprocess.DEVNULL)

    def test_test_or_reload_failure_restores_exact_backup_and_reloads(self):
        failure = subprocess.CalledProcessError(1, 'secret command')
        for outcomes in ([failure, None, None], [None, failure, None, None]):
            with self.subTest(outcomes=outcomes):
                self.run.reset_mock()
                self.write.reset_mock()
                self.run.side_effect = outcomes
                with self.assertRaisesRegex(installer.Refused, 'original configuration restored'):
                    installer.install(digest())
                self.write.assert_called_with(CONFIG, self.backup, self.metadata)
                self.assertEqual(self.write.call_count, 2)
                self.assertEqual([call.args[0] for call in self.run.call_args_list[-2:]],
                                 [['/usr/sbin/nginx', '-t'], ['/usr/bin/systemctl', 'reload', 'nginx']])

    def test_rollback_failure_reports_only_generic_message(self):
        self.run.side_effect = RuntimeError('secret output')
        with self.assertRaisesRegex(installer.Refused, '^Install failed; rollback requires operator attention.$'):
            installer.install(digest())

    def test_atomic_write_failure_before_replacement_does_not_restore(self):
        self.write.side_effect = [OSError('private details'), None]
        with self.assertRaisesRegex(installer.Refused, 'rollback requires operator attention'):
            installer.install(digest())
        self.assertEqual(self.write.call_count, 1)
        self.run.assert_not_called()

    def test_rollback_preserves_concurrent_operator_content(self):
        self.read.side_effect = [(CONFIG, self.metadata)] * 3 + [(b'operator edit', self.metadata)]
        self.run.side_effect = RuntimeError('private details')
        with self.assertRaisesRegex(installer.Refused, 'rollback requires operator attention'):
            installer.install(digest())
        self.assertEqual(self.write.call_count, 1)
        self.assertEqual(self.run.call_count, 1)
        self.backup.read_bytes.assert_not_called()

    def test_rollback_refuses_target_that_fails_safe_read(self):
        self.read.side_effect = [(CONFIG, self.metadata)] * 3 + [installer.Refused()]
        self.run.side_effect = RuntimeError('private details')
        with self.assertRaisesRegex(installer.Refused, 'rollback requires operator attention'):
            installer.install(digest())
        self.assertEqual(self.write.call_count, 1)
        self.assertEqual(self.run.call_count, 1)
        self.backup.read_bytes.assert_not_called()

    def test_changed_target_is_not_overwritten(self):
        self.read.side_effect = [(CONFIG, self.metadata), (b'changed', self.metadata)]
        with self.assertRaises(installer.Refused):
            installer.install(digest())
        self.write.assert_not_called()
        self.backup_call.assert_not_called()


class FilesystemTests(unittest.TestCase):
    def test_read_target_rejects_group_or_world_writable_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'config'
            target.write_bytes(CONFIG)
            for mode in (0o620, 0o602, 0o666):
                metadata = SimpleNamespace(st_mode=stat.S_IFREG | mode, st_uid=0)
                with self.subTest(mode=mode), patch.object(installer, 'TARGET', target), \
                        patch.object(installer.os, 'fstat', return_value=metadata):
                    with self.assertRaises(installer.Refused):
                        installer.read_target()

    def test_symlink_and_non_root_owned_files_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'config'
            target.write_bytes(CONFIG)
            link = Path(directory) / 'link'
            link.symlink_to(target)
            with patch.object(installer, 'TARGET', link), self.assertRaises(OSError):
                installer.read_target()
            for mode, owner in ((stat.S_IFREG | 0o600, 123), (stat.S_IFIFO | 0o600, 0)):
                metadata = SimpleNamespace(st_mode=mode, st_uid=owner)
                with patch.object(installer, 'TARGET', target), patch.object(installer.os, 'fstat', return_value=metadata):
                    with self.assertRaises(installer.Refused):
                        installer.read_target()

    def test_atomic_write_and_backup_preserve_bytes_mode_and_timestamps(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'config'
            target.write_bytes(CONFIG)
            target.chmod(0o640)
            metadata = target.stat()
            with patch.object(installer, 'TARGET', target), patch.object(installer, 'BACKUP_DIR', Path(directory)), \
                    patch.object(installer.os, 'chown'), patch.object(installer.os, 'fchown'):
                backup = installer.make_backup(CONFIG, metadata)
                self.assertEqual(stat.S_IMODE(backup.parent.stat().st_mode), 0o700)
                self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)
                self.assertEqual(backup.read_bytes(), CONFIG)
                installer.atomic_write(b'new', backup, metadata)
                self.assertEqual(target.read_bytes(), b'new')
                installer.atomic_write(backup.read_bytes(), backup, metadata)
                self.assertEqual(target.read_bytes(), CONFIG)
                self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o640)
                self.assertEqual(target.stat().st_mtime_ns, metadata.st_mtime_ns)


if __name__ == '__main__':
    unittest.main()
