import importlib.util
import hashlib
import os
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


BASE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location(
    'funding_service_install', BASE / 'funding-service-install.py'
)
install = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(install)


class FundingServiceInstallTests(unittest.TestCase):
    def test_update_unit_rewrites_only_pinned_prior_rendering(self):
        old = install.render_unit().replace(
            'unset CREDENTIALS_DIRECTORY; ', '', 1
        )
        with tempfile.TemporaryDirectory() as tmp:
            unit_dir = Path(tmp)
            target = unit_dir / install.UNIT_NAME
            staging = unit_dir / (install.UNIT_NAME + '.candidate-update')
            target.write_text(old, encoding='utf-8')
            real_lstat = Path.lstat

            def fake_lstat(path_self):
                if path_self in (target, staging) and os.path.lexists(path_self):
                    return SimpleNamespace(
                        st_mode=stat.S_IFREG | 0o644, st_uid=0, st_nlink=1
                    )
                return real_lstat(path_self)

            with (
                patch.object(install, 'UNIT_DIRECTORY', unit_dir),
                patch.object(install.os, 'geteuid', return_value=0),
                patch.object(install, 'verify_artifact'),
                patch.object(install, 'verify_config_metadata'),
                patch.object(install, 'verify_unit_directory'),
                patch.object(Path, 'lstat', fake_lstat),
                patch.object(install.os, 'chown'),
            ):
                self.assertEqual(install.update_unit(), 'updated')
                self.assertEqual(
                    target.read_text(encoding='utf-8'), install.render_unit()
                )
                self.assertFalse(staging.exists())
                self.assertEqual(install.update_unit(), 'already current')


    def test_update_unit_clears_stale_regular_staging(self):
        old = install.render_unit().replace(
            'unset CREDENTIALS_DIRECTORY; ', '', 1
        )
        with tempfile.TemporaryDirectory() as tmp:
            unit_dir = Path(tmp)
            target = unit_dir / install.UNIT_NAME
            staging = unit_dir / (install.UNIT_NAME + '.candidate-update')
            target.write_text(old, encoding='utf-8')
            staging.write_text('stale', encoding='utf-8')
            real_lstat = Path.lstat

            def fake_lstat(path_self):
                if path_self in (target, staging) and os.path.lexists(path_self):
                    return SimpleNamespace(
                        st_mode=stat.S_IFREG | 0o644, st_uid=0, st_nlink=1
                    )
                return real_lstat(path_self)

            with (
                patch.object(install, 'UNIT_DIRECTORY', unit_dir),
                patch.object(install.os, 'geteuid', return_value=0),
                patch.object(install, 'verify_artifact'),
                patch.object(install, 'verify_config_metadata'),
                patch.object(install, 'verify_unit_directory'),
                patch.object(Path, 'lstat', fake_lstat),
                patch.object(install.os, 'chown'),
            ):
                self.assertEqual(install.update_unit(), 'updated')
                self.assertEqual(
                    target.read_text(encoding='utf-8'), install.render_unit()
                )


    def test_update_unit_refuses_foreign_missing_or_unsafe_unit(self):
        with tempfile.TemporaryDirectory() as tmp:
            unit_dir = Path(tmp)
            target = unit_dir / install.UNIT_NAME
            real_lstat = Path.lstat

            def fake_lstat(path_self):
                if path_self == target and os.path.lexists(path_self):
                    return SimpleNamespace(
                        st_mode=stat.S_IFREG | 0o644, st_uid=0, st_nlink=1
                    )
                return real_lstat(path_self)

            with (
                patch.object(install, 'UNIT_DIRECTORY', unit_dir),
                patch.object(install.os, 'geteuid', return_value=0),
                patch.object(install, 'verify_artifact'),
                patch.object(install, 'verify_config_metadata'),
                patch.object(install, 'verify_unit_directory'),
                patch.object(Path, 'lstat', fake_lstat),
                patch.object(install.os, 'chown'),
            ):
                target.write_text('[foreign]\n', encoding='utf-8')
                with self.assertRaisesRegex(install.Refused, 'outside the candidate'):
                    install.update_unit()
                target.unlink()
                with self.assertRaisesRegex(install.Refused, 'required for update'):
                    install.update_unit()
            with (
                patch.object(install, 'UNIT_DIRECTORY', unit_dir),
                patch.object(install.os, 'geteuid', return_value=0),
                patch.object(install, 'verify_artifact'),
                patch.object(install, 'verify_config_metadata'),
                patch.object(install, 'verify_unit_directory'),
            ):
                target.write_text('[foreign]\n', encoding='utf-8')
                with self.assertRaisesRegex(install.Refused, 'unsafe for update'):
                    install.update_unit()
            with patch.object(install.os, 'geteuid', return_value=501):
                with self.assertRaisesRegex(install.Refused, 'root execution'):
                    install.update_unit()


    def test_install_stays_root_only_and_uses_fixed_unit_directory(self):
        with patch.object(install.os, 'geteuid', return_value=501):
            with self.assertRaisesRegex(install.Refused, 'root execution'):
                install.install_unit()
        self.assertEqual(install.UNIT_DIRECTORY, Path('/etc/systemd/system'))


if __name__ == '__main__':
    unittest.main()
