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
    'funding_service_validation', BASE / 'funding-service-validation.py'
)
validation = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validation)


class FundingServiceValidationTests(unittest.TestCase):
    def artifact(self, root: Path) -> None:
        app = root / 'apps/web'
        (app / 'public').mkdir(parents=True)
        (app / '.next/static').mkdir(parents=True)
        (root / 'node_modules').mkdir()
        (app / 'server.js').write_text('server', encoding='utf-8')


    def test_regression_refuses_non_fixed_artifact_root(self):
        with self.assertRaisesRegex(validation.Refused, 'fixed funding service path'):
            validation.verify_artifact(Path('/tmp/standalone'))


    def test_regression_rejects_writable_or_symlinked_artifact_entries(self):
        writable = SimpleNamespace(st_mode=stat.S_IFREG | 0o664, st_uid=0)
        symlink = SimpleNamespace(st_mode=stat.S_IFLNK | 0o644, st_uid=0)
        with patch.object(Path, 'lstat', return_value=writable):
            with self.assertRaisesRegex(validation.Refused, 'unsafe'):
                validation._require_safe_path(
                    Path('/opt/baci-savings-funding/app'),
                    stat.S_IFREG,
                    'Funding artifact tree',
                )
        with patch.object(Path, 'lstat', return_value=symlink):
            with self.assertRaisesRegex(validation.Refused, 'unsafe'):
                validation._require_safe_path(
                    Path('/opt/baci-savings-funding/app'),
                    stat.S_IFREG,
                    'Funding artifact tree',
                )


    def test_regression_rejects_env_files_in_fixed_artifact(self):
        environment_file = validation.ARTIFACT_ROOT / '.env.production'
        with (
            patch.object(validation, '_verify_root_owned_ancestors'),
            patch.object(validation, '_require_safe_path'),
            patch.object(validation, '_verify_service_artifact_access'),
            patch.object(validation.os, 'walk', return_value=[]),
            patch.object(Path, 'resolve', return_value=validation.ARTIFACT_ROOT),
            patch.object(Path, 'is_file', return_value=True),
            patch.object(Path, 'is_dir', return_value=True),
            patch.object(Path, 'rglob', return_value=[environment_file]),
        ):
            with self.assertRaisesRegex(validation.Refused, 'environment'):
                validation.verify_artifact()


    def test_allows_root_owned_relative_internal_symlink_in_artifact_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'standalone'
            root.mkdir()
            self.artifact(root)
            (root / 'node_modules/server.js').symlink_to('../apps/web/server.js')

            validation._verify_artifact_tree(root, os.getuid())


    def test_regression_rejects_unsafe_synthetic_artifact_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'standalone'
            root.mkdir()
            self.artifact(root)
            linked = root / 'node_modules/linked-server.js'
            linked.symlink_to('/etc/passwd')
            with self.assertRaisesRegex(validation.Refused, 'relative'):
                validation._verify_artifact_tree(root, os.getuid())
            linked.unlink()
            outside = root.parent / 'outside.js'
            outside.write_text('outside', encoding='utf-8')
            linked.symlink_to('../../outside.js')
            with self.assertRaisesRegex(validation.Refused, 'escapes'):
                validation._verify_artifact_tree(root, os.getuid())
            linked.unlink()
            outside_directory = root.parent / 'outside'
            outside_directory.mkdir()
            (outside_directory / 'back').symlink_to(root)
            linked.symlink_to('../../outside/back/apps/web/server.js')
            with self.assertRaisesRegex(validation.Refused, 'escapes'):
                validation._verify_artifact_tree(root, os.getuid())
            linked.unlink()
            linked.symlink_to('missing.js')
            with self.assertRaisesRegex(validation.Refused, 'dangling'):
                validation._verify_artifact_tree(root, os.getuid())
            linked.unlink()
            linked.symlink_to('linked-server.js')
            with self.assertRaisesRegex(validation.Refused, 'dangling'):
                validation._verify_artifact_tree(root, os.getuid())


    def test_regression_rejects_environment_or_writable_symlink_targets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'standalone'
            root.mkdir()
            self.artifact(root)
            linked = root / 'node_modules/linked-server.js'
            environment = root / '.env.production'
            environment.write_text('not-a-secret', encoding='utf-8')
            linked.symlink_to('../.env.production')
            with self.assertRaisesRegex(validation.Refused, 'environment'):
                validation._verify_artifact_tree(root, os.getuid())
            linked.unlink()
            environment.unlink()
            target = root / 'apps/web/server.js'
            target.chmod(0o664)
            linked.symlink_to('../apps/web/server.js')
            with self.assertRaisesRegex(validation.Refused, 'unsafe'):
                validation._verify_artifact_tree(root, os.getuid())


    def test_service_account_must_exist(self):
        with patch.object(validation.pwd, 'getpwnam', side_effect=KeyError):
            with self.assertRaisesRegex(validation.Refused, 'account and group'):
                validation._service_identity()


    def test_service_identity_can_read_and_traverse_synthetic_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'standalone'
            root.mkdir()
            self.artifact(root)
            with patch.object(
                validation,
                '_service_identity',
                return_value=(os.getuid(), os.getgid()),
            ):
                validation._verify_service_artifact_access(root)


    def test_regression_refuses_artifact_unreadable_to_service_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'standalone'
            root.mkdir()
            self.artifact(root)
            (root / 'apps/web/server.js').chmod(0o000)
            with patch.object(
                validation,
                '_service_identity',
                return_value=(os.getuid(), os.getgid()),
            ):
                with self.assertRaisesRegex(validation.Refused, 'cannot read'):
                    validation._verify_service_artifact_access(root)


    def test_regression_checks_fixed_config_path_only(self):
        with (
            patch.object(validation, '_verify_root_owned_ancestors') as ancestors,
            patch.object(validation, '_verify_secret_config') as config,
            patch.object(validation, '_verify_ca_config') as ca_config,
        ):
            validation.verify_config_metadata()
        self.assertEqual(
            [call.args for call in ancestors.call_args_list],
            [
                (validation.CONFIG_PATH.parent, 'Funding configuration path'),
                (validation.DB_CA_PATH.parent, 'Funding CA path'),
            ],
        )
        config.assert_called_once_with(
            validation.CONFIG_PATH
        )
        ca_config.assert_called_once_with(
            validation.DB_CA_PATH
        )


    def test_regression_refuses_group_or_world_readable_secret_config(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'funding-service.env'
            config.write_text('synthetic=true', encoding='utf-8')
            config.chmod(0o600)
            validation._verify_secret_config(config, os.getuid())
            config.chmod(0o400)
            validation._verify_secret_config(config, os.getuid())
            for mode in (0o640, 0o644):
                config.chmod(mode)
                with self.assertRaisesRegex(validation.Refused, 'permissions'):
                    validation._verify_secret_config(config, os.getuid())
            config.chmod(0o600)
            os.link(config, Path(directory) / 'second-link')
            with self.assertRaisesRegex(validation.Refused, 'permissions'):
                validation._verify_secret_config(config, os.getuid())


    def test_regression_accepts_only_world_readable_ca_certificate(self):
        with tempfile.TemporaryDirectory() as directory:
            ca_file = Path(directory) / 'postgres-ca.pem'
            ca_file.write_text('synthetic-ca', encoding='utf-8')
            ca_file.chmod(0o444)
            validation._verify_ca_config(ca_file, os.getuid())
            for mode in (0o400, 0o600, 0o640, 0o644):
                ca_file.chmod(mode)
                with self.assertRaisesRegex(validation.Refused, 'permissions'):
                    validation._verify_ca_config(ca_file, os.getuid())


if __name__ == '__main__':
    unittest.main()
