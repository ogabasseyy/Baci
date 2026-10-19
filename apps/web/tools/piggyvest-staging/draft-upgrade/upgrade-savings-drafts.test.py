import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


DIRECTORY = Path(__file__).resolve().parent
sys.path.insert(0, str(DIRECTORY))


def load(name, filename):
    specification = importlib.util.spec_from_file_location(name, DIRECTORY / filename)
    module = importlib.util.module_from_spec(specification)
    sys.modules[name] = module
    specification.loader.exec_module(module)
    return module


artifact = load('artifact_validation', 'artifact_validation.py')
descriptor_copy = load('descriptor_copy', 'descriptor_copy.py')
identity = load('systemd_identity', 'systemd_identity.py')
upgrade = load('upgrade', 'upgrade-savings-drafts.py')


class ArtifactTests(unittest.TestCase):
    def test_manifest_uses_string_order_for_package_and_package_dot_js(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'artifact'
            root.mkdir()
            self.build(root)
            (root / 'node_modules/package').mkdir()
            (root / 'node_modules/package/index.js').write_text('module')
            entries = artifact.artifact_entries(root)
            self.assertEqual(entries, sorted(entries, key=lambda entry: entry['path']))
            manifest, digest = self.manifest(root, Path(directory))
            self.assertEqual(artifact.read_manifest(manifest, digest), entries)

    def build(self, root):
        for directory in ('apps/web/.next/static', 'apps/web/public', 'node_modules'):
            (root / directory).mkdir(parents=True)
        (root / 'apps/web/server.js').write_text('server')
        (root / 'apps/web/.next/static/main.js').write_text('static')
        (root / 'apps/web/public/logo.svg').write_text('public')
        (root / 'node_modules/package.js').write_text('module')

    def manifest(self, root, directory):
        path = directory / 'manifest.json'
        path.write_bytes(json.dumps({'version': 1, 'entries': artifact.artifact_entries(root)}).encode())
        return path, hashlib.sha256(path.read_bytes()).hexdigest()

    def test_regression_requires_static_and_public_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'artifact'
            root.mkdir()
            self.build(root)
            (root / 'apps/web/public/logo.svg').unlink()
            (root / 'apps/web/public').rmdir()
            with self.assertRaisesRegex(artifact.Refused, 'required assets'):
                artifact.artifact_entries(root)

    def test_regression_refuses_env_dangling_cyclic_and_ancestor_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'artifact'
            root.mkdir()
            self.build(root)
            (root / '.env.production').write_text('secret')
            with self.assertRaisesRegex(artifact.Refused, 'Environment'):
                artifact.artifact_entries(root)
            (root / '.env.production').unlink()
            (root / 'apps/web/dangling').symlink_to('missing')
            with self.assertRaisesRegex(artifact.Refused, 'Dangling'):
                artifact.artifact_entries(root)
            (root / 'apps/web/dangling').unlink()
            (root / 'apps/web/cycle').symlink_to('cycle')
            with self.assertRaisesRegex(artifact.Refused, 'cyclic'):
                artifact.artifact_entries(root)
            (root / 'apps/web/cycle').unlink()
            (root / 'apps/web/link-directory').symlink_to('../web')
            with self.assertRaisesRegex(artifact.Refused, 'ancestor'):
                artifact.assert_ancestor_directories(root, root / 'apps/web/link-directory/child')

    def test_regression_manifest_is_hashed_and_parsed_from_the_same_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / 'artifact'
            root.mkdir()
            self.build(root)
            manifest, digest = self.manifest(root, base)
            contents = manifest.read_bytes()
            def replace_after_read(_):
                manifest.write_text('{"version":1,"entries":[]}')
                return contents
            with patch.object(artifact, 'regular_bytes', side_effect=replace_after_read):
                self.assertEqual(artifact.read_manifest(manifest, digest), artifact.artifact_entries(root))

    def test_regression_descriptor_copy_removes_candidate_after_a_copy_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source, destination = base / 'source', base / 'opt/drafts'
            source.mkdir()
            destination.parent.mkdir()
            self.build(source)
            entries = artifact.artifact_entries(source)
            with patch.object(descriptor_copy, 'copy_file', side_effect=artifact.Refused('changed')):
                with self.assertRaisesRegex(artifact.Refused, 'changed'):
                    descriptor_copy.copy_verified(source, destination, entries)
            self.assertEqual(list(destination.parent.glob('.drafts.new-*')), [])

    def test_regression_owner_script_imports_helpers_when_run_directly(self):
        result = subprocess.run([sys.executable, str(DIRECTORY / 'upgrade-savings-drafts.py'), '--help'],
                                check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)




class UpgradeTransitionTests(unittest.TestCase):
    def exchange(self, base, left, right):
        temporary = base / 'temporary'
        left.rename(temporary)
        right.rename(left)
        temporary.rename(right)

    def test_regression_old_service_stops_before_exchange_and_health_retries(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            destination, candidate = base / 'drafts', base / '.drafts.new'
            destination.mkdir()
            candidate.mkdir()
            events = []
            old = identity.Invocation(identity.SERVICE, 'o' * 32, 1)
            new = identity.Invocation(identity.SERVICE, 'n' * 32, 2)
            with patch.object(upgrade.os, 'getuid', return_value=0), patch.object(upgrade.os, 'geteuid', return_value=0), \
                    patch.object(upgrade, 'DESTINATION', destination), patch.object(upgrade, 'read_manifest', return_value=[]), \
                    patch.object(upgrade, 'copy_verified', return_value=candidate), patch.object(upgrade, 'capture_live', side_effect=[old, old]), \
                    patch.object(upgrade, 'assert_timer'), patch.object(upgrade, 'stop_owned', side_effect=lambda *_args, **_kwargs: events.append('stop-old')), \
                    patch.object(upgrade, 'exchange', side_effect=lambda left, right: events.append('exchange') or self.exchange(base, left, right)), \
                    patch.object(upgrade, 'smoke', side_effect=lambda: events.append('smoke')), \
                    patch.object(upgrade, 'start_owned', return_value=new), patch.object(upgrade, 'wait_for_401', side_effect=lambda *_args, **_kwargs: events.append('health')), \
                    patch.object(upgrade.time, 'time', return_value=1):
                upgrade.upgrade(Path('/source'), Path('/manifest'), 'a' * 64)
            self.assertEqual(events, ['stop-old', 'exchange', 'smoke', 'health'])

    def test_regression_failed_smoke_stops_its_captured_invocation(self):
        smoke_invocation = identity.Invocation(identity.SMOKE, 's' * 32, 7)
        with patch.object(upgrade, 'start_owned', return_value=smoke_invocation), \
                patch.object(upgrade, 'wait_for_401', side_effect=artifact.Refused('smoke-health')), \
                patch.object(upgrade, 'stop_owned') as stop:
            with self.assertRaisesRegex(artifact.Refused, 'smoke-health'):
                upgrade.smoke()
        stop.assert_called_once_with(smoke_invocation, upgrade.SMOKE_FRAGMENT, restricted=True)

    def test_regression_unproven_smoke_start_prevents_any_rollback_exchange(self):
        with patch.object(upgrade, 'start_owned', side_effect=artifact.Refused('capture-failed')), \
                patch.object(upgrade, 'smoke_is_inactive', return_value=False), patch.object(upgrade, 'stop_owned') as stop:
            with self.assertRaisesRegex(upgrade.UnsafeSmokeState, 'manual recovery'):
                upgrade.smoke()
        stop.assert_not_called()

    def test_regression_changed_smoke_invocation_requires_manual_recovery(self):
        smoke_invocation = identity.Invocation(identity.SMOKE, 's' * 32, 7)
        with patch.object(upgrade, 'start_owned', return_value=smoke_invocation), \
                patch.object(upgrade, 'wait_for_401', side_effect=artifact.Refused('health')), \
                patch.object(upgrade, 'stop_owned', side_effect=artifact.Refused('changed')), \
                patch.object(upgrade, 'smoke_is_inactive', return_value=False):
            with self.assertRaisesRegex(upgrade.UnsafeSmokeState, 'manual recovery'):
                upgrade.smoke()

    def test_regression_changed_smoke_invocation_prevents_artifact_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            destination, candidate = base / 'drafts', base / '.drafts.new'
            destination.mkdir()
            candidate.mkdir()
            old = identity.Invocation(identity.SERVICE, 'o' * 32, 1)
            with patch.object(upgrade.os, 'getuid', return_value=0), patch.object(upgrade.os, 'geteuid', return_value=0), \
                    patch.object(upgrade, 'DESTINATION', destination), patch.object(upgrade, 'read_manifest', return_value=[]), \
                    patch.object(upgrade, 'copy_verified', return_value=candidate), patch.object(upgrade, 'capture_live', side_effect=[old, old]), \
                    patch.object(upgrade, 'assert_timer'), patch.object(upgrade, 'stop_owned'), \
                    patch.object(upgrade, 'exchange', side_effect=lambda left, right: self.exchange(base, left, right)), \
                    patch.object(upgrade, 'smoke', side_effect=upgrade.UnsafeSmokeState('manual recovery')), \
                    patch.object(upgrade, 'restore') as restore, patch.object(upgrade.time, 'time', return_value=1):
                with self.assertRaisesRegex(upgrade.UnsafeSmokeState, 'manual recovery'):
                    upgrade.upgrade(Path('/source'), Path('/manifest'), 'a' * 64)
            restore.assert_not_called()

    def test_regression_failed_new_health_stops_only_captured_invocation_before_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            destination, candidate = base / 'drafts', base / '.drafts.new'
            destination.mkdir()
            candidate.mkdir()
            (destination / 'old').write_text('old')
            (candidate / 'new').write_text('new')
            old = identity.Invocation(identity.SERVICE, 'o' * 32, 1)
            new = identity.Invocation(identity.SERVICE, 'n' * 32, 2)
            stopped = []
            with patch.object(upgrade.os, 'getuid', return_value=0), patch.object(upgrade.os, 'geteuid', return_value=0), \
                    patch.object(upgrade, 'DESTINATION', destination), patch.object(upgrade, 'read_manifest', return_value=[]), \
                    patch.object(upgrade, 'copy_verified', return_value=candidate), patch.object(upgrade, 'capture_live', side_effect=[old, old]), \
                    patch.object(upgrade, 'assert_timer'), patch.object(upgrade, 'stop_owned', side_effect=lambda invocation, *_args, **_kwargs: stopped.append(invocation)), \
                    patch.object(upgrade, 'exchange', side_effect=lambda left, right: self.exchange(base, left, right)), \
                    patch.object(upgrade, 'smoke'), patch.object(upgrade, 'start_owned', side_effect=[new, old]), \
                    patch.object(upgrade, 'wait_for_401', side_effect=[artifact.Refused('health'), None]), patch.object(upgrade.time, 'time', return_value=1):
                with self.assertRaisesRegex(artifact.Refused, 'health'):
                    upgrade.upgrade(Path('/source'), Path('/manifest'), 'a' * 64)
            self.assertEqual(stopped, [old, new])
            self.assertEqual((destination / 'old').read_text(), 'old')

    def test_regression_exchange_failure_restarts_proven_old_service(self):
        old = identity.Invocation(identity.SERVICE, 'o' * 32, 1)
        with patch.object(upgrade.os, 'getuid', return_value=0), patch.object(upgrade.os, 'geteuid', return_value=0), \
                patch.object(upgrade, 'read_manifest', return_value=[]), patch.object(upgrade, 'capture_live', side_effect=[old, old]), \
                patch.object(upgrade, 'assert_timer'), patch.object(upgrade, 'copy_verified', return_value=Path('/candidate')), \
                patch.object(upgrade.Path, 'is_dir', return_value=True), patch.object(upgrade, 'stop_owned'), \
                patch.object(upgrade, 'exchange', side_effect=OSError('exchange')), patch.object(upgrade, 'start_owned', return_value=old) as start, \
                patch.object(upgrade, 'wait_for_401'), patch.object(upgrade.time, 'time', return_value=1):
            with self.assertRaisesRegex(OSError, 'exchange'):
                upgrade.upgrade(Path('/source'), Path('/manifest'), 'a' * 64)
        start.assert_called_once_with(upgrade.SERVICE, upgrade.SERVICE_FRAGMENT, restricted=False)

    def test_regression_backup_rename_failure_restores_old_candidate_path(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            destination, candidate = base / 'drafts', base / '.drafts.new'
            destination.mkdir()
            candidate.mkdir()
            (destination / 'old').write_text('old')
            (candidate / 'new').write_text('new')
            old = identity.Invocation(identity.SERVICE, 'o' * 32, 1)
            restored = []
            with patch.object(upgrade.os, 'getuid', return_value=0), patch.object(upgrade.os, 'geteuid', return_value=0), \
                    patch.object(upgrade, 'DESTINATION', destination), patch.object(upgrade, 'read_manifest', return_value=[]), \
                    patch.object(upgrade, 'copy_verified', return_value=candidate), patch.object(upgrade, 'capture_live', side_effect=[old, old]), \
                    patch.object(upgrade, 'assert_timer'), patch.object(upgrade, 'stop_owned'), \
                    patch.object(upgrade, 'exchange', side_effect=lambda left, right: self.exchange(base, left, right)), \
                    patch.object(upgrade.os, 'replace', side_effect=OSError('rename')), \
                    patch.object(upgrade, 'restore', side_effect=lambda artifact_path, _invocation: restored.append(artifact_path)), \
                    patch.object(upgrade.time, 'time', return_value=1):
                with self.assertRaisesRegex(OSError, 'rename'):
                    upgrade.upgrade(Path('/source'), Path('/manifest'), 'a' * 64)
            self.assertEqual(restored, [candidate])


if __name__ == '__main__':
    unittest.main()
