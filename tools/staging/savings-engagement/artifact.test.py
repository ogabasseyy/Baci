import importlib.util
import io
import errno
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('engagement_artifact', Path(__file__).with_name('artifact.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ArtifactTests(unittest.TestCase):
    @staticmethod
    def _archive():
        content = io.BytesIO()
        with tarfile.open(fileobj=content, mode='w:gz') as archive:
            files = {
                'apps/web/server.js': b'server',
                'apps/web/.next/server/app/api/storefront/customer/savings/notifications/route.js': b'route',
            }
            for name in ('apps', 'apps/web', 'apps/web/.next', 'apps/web/.next/server',
                         'apps/web/.next/server/app', 'apps/web/.next/server/app/api',
                         'apps/web/.next/server/app/api/storefront',
                         'apps/web/.next/server/app/api/storefront/customer',
                         'apps/web/.next/server/app/api/storefront/customer/savings',
                         'apps/web/.next/server/app/api/storefront/customer/savings/notifications'):
                info = tarfile.TarInfo(name)
                info.type = tarfile.DIRTYPE
                archive.addfile(info)
            for name, data in files.items():
                info = tarfile.TarInfo(name)
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        return content.getvalue()

    def _verify(self, root, archive_bytes):
        root.mkdir(parents=True)
        for name, value in {
            'apps/web/server.js': b'server',
            'apps/web/.next/server/app/api/storefront/customer/savings/notifications/route.js': b'route',
        }.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(value)
        candidate = SimpleNamespace(
            verify_artifact=lambda: None,
            verify_config_metadata=lambda: None,
            _verify_artifact_tree=lambda path: None,
            _verify_service_artifact_access=lambda path: None,
            render_unit=lambda: '[Service]\nExecStart=/srv/server.js\n',
        )
        installer = SimpleNamespace(_verify_manifest=lambda path, manifest: None)
        contents = {
            'funding-deploy.tar.gz': archive_bytes,
            'funding-deploy.manifest.json': b'{"version":1}',
        }
        with (
            patch.object(MODULE, 'ROOT', root),
            patch.object(MODULE, 'read_artifact_pins', return_value={'tarballSha256': 'a' * 64, 'manifestSha256': 'b' * 64}),
            patch.object(MODULE, 'read_pinned', side_effect=lambda name, _digest: contents[name]),
            patch.object(MODULE, 'load_pinned', side_effect=lambda name, _digest: installer if name.startswith('install-') else candidate),
            patch.object(MODULE, '_read_root_file', return_value=candidate.render_unit().encode()),
            patch.object(MODULE, 'probe_health') as health,
            patch.object(MODULE, 'run_service') as service,
            patch.object(MODULE.os, 'rename') as rename,
            patch.object(MODULE.tarfile.TarFile, 'extractall', side_effect=AssertionError),
            patch.object(MODULE.os, 'geteuid', return_value=0),
        ):
            result = MODULE.verify_installed()
        return result, health, service, rename

    def test_verify_installed_checks_pinned_artifact_and_health_without_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            result, health, service, rename = self._verify(Path(directory) / 'funding', self._archive())
        self.assertEqual(result['status'], 'verified')
        health.assert_called_once_with()
        service.assert_not_called()
        rename.assert_not_called()

    def test_verify_installed_rejects_extra_file_without_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'funding'
            root.mkdir()
            (root / 'unexpected.txt').write_text('drift')
            (root / 'unexpected-link').symlink_to('unexpected.txt')
            snapshot = sorted((path.relative_to(root).as_posix(), path.read_bytes() if path.is_file() else None)
                              for path in root.rglob('*'))
            with (
                patch.object(MODULE, 'ROOT', root),
                patch.object(MODULE, '_installed_entries', wraps=MODULE._installed_entries),
                patch.object(MODULE, 'read_artifact_pins', return_value={'tarballSha256': 'a' * 64, 'manifestSha256': 'b' * 64}),
                patch.object(MODULE, 'read_pinned', side_effect=lambda name, _digest: self._archive() if name.endswith('.tar.gz') else b'{"version":1}'),
                patch.object(MODULE, 'load_pinned', side_effect=lambda name, _digest: SimpleNamespace(_verify_manifest=lambda path, manifest: None) if name.startswith('install-') else SimpleNamespace(
                    verify_artifact=lambda: None, verify_config_metadata=lambda: None,
                    _verify_artifact_tree=lambda _path: None, _verify_service_artifact_access=lambda _path: None,
                    render_unit=lambda: '[Service]\nExecStart=/srv/server.js\n',
                )),
                patch.object(MODULE, 'probe_health') as health,
                patch.object(MODULE, 'run_service') as service,
                patch.object(MODULE.os, 'rename') as rename,
                patch.object(MODULE.tarfile.TarFile, 'extractall', side_effect=AssertionError),
                patch.object(MODULE.os, 'geteuid', return_value=0),
            ):
                with self.assertRaisesRegex(RuntimeError, 'file set drift'):
                    MODULE.verify_installed()
            after = sorted((path.relative_to(root).as_posix(), path.read_bytes() if path.is_file() else None)
                           for path in root.rglob('*'))
            self.assertEqual(after, snapshot)
            health.assert_not_called()
            service.assert_not_called()
            rename.assert_not_called()

    def test_protected_file_reads_use_nofollow_and_reject_mtime_drift(self):
        parent = SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0)
        first = SimpleNamespace(st_mode=stat.S_IFREG | 0o400, st_uid=0, st_nlink=1,
                                st_ino=3, st_size=4, st_mtime_ns=10)
        changed = SimpleNamespace(**{**vars(first), 'st_mtime_ns': 11})

        class Handle:
            def __enter__(self): return self
            def __exit__(self, *_args): return None
            def fileno(self): return 9
            def read(self, _limit): return b'data'

        with (
            patch.object(Path, 'lstat', return_value=parent),
            patch.object(MODULE.os, 'open', return_value=9) as open_file,
            patch.object(MODULE.os, 'fdopen', return_value=Handle()),
            patch.object(MODULE.os, 'fstat', side_effect=[first, changed]),
        ):
            with self.assertRaisesRegex(RuntimeError, 'changed during read'):
                MODULE._read_root_file(Path('/root/pinned.json'))
        self.assertTrue(open_file.call_args.args[1] & MODULE.os.O_NOFOLLOW)

    def test_protected_file_read_does_not_follow_symlink(self):
        parent = SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0)
        with (
            patch.object(Path, 'lstat', return_value=parent),
            patch.object(MODULE.os, 'open', side_effect=OSError(errno.ELOOP, 'symlink')) as open_file,
        ):
            with self.assertRaises(OSError):
                MODULE._read_root_file(Path('/root/pinned.json'))
        self.assertTrue(open_file.call_args.args[1] & MODULE.os.O_NOFOLLOW)

    def test_replaces_only_after_candidate_and_current_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            current, staged = Path(directory) / 'live', Path(directory) / 'staged'
            current.mkdir()
            staged.mkdir()
            (current / 'version').write_text('old')
            (staged / 'version').write_text('new')
            order = []
            with patch.object(MODULE, 'ROOT', current), patch.object(MODULE, 'run_service', side_effect=order.append), patch.object(MODULE, 'probe_health', side_effect=lambda: order.append('healthy')):
                backup = MODULE.swap(staged, lambda: order.append('verified'))
            self.assertEqual(order, ['verified', 'stop', 'start', 'healthy'])
            self.assertEqual((current / 'version').read_text(), 'new')
            self.assertEqual((backup / 'version').read_text(), 'old')

    def test_failed_candidate_never_stops_live_service(self):
        with patch.object(MODULE, 'run_service') as service:
            with self.assertRaises(RuntimeError):
                MODULE.swap(Path('/unused'), lambda: (_ for _ in ()).throw(RuntimeError('bad candidate')))
            service.assert_not_called()

    def test_failed_backup_rename_restarts_the_untouched_service(self):
        with patch.object(MODULE, 'run_service') as service, patch.object(MODULE.os, 'rename', side_effect=OSError('rename refused')):
            with self.assertRaisesRegex(RuntimeError, 'backup'):
                MODULE.swap(Path('/unused'), lambda: None)
        self.assertEqual([call.args[0] for call in service.call_args_list], ['stop', 'start'])

    def test_failed_new_health_restores_old_artifact_without_deleting_either(self):
        with tempfile.TemporaryDirectory() as directory:
            current, staged = Path(directory) / 'live', Path(directory) / 'staged'
            current.mkdir()
            staged.mkdir()
            (current / 'version').write_text('old')
            (staged / 'version').write_text('new')
            with patch.object(MODULE, 'ROOT', current), patch.object(MODULE, 'run_service'), patch.object(MODULE, 'probe_health', side_effect=[RuntimeError('unhealthy'), None]):
                with self.assertRaisesRegex(RuntimeError, 'rolled back'):
                    MODULE.swap(staged, lambda: None)
            self.assertEqual((current / 'version').read_text(), 'old')
            failed = list(Path(directory).glob('live.failed-*'))
            self.assertEqual(len(failed), 1)
            self.assertEqual((failed[0] / 'version').read_text(), 'new')


if __name__ == '__main__':
    unittest.main()
