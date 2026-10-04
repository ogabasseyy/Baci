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
    'funding_service_candidate', BASE / 'funding-service-candidate.py'
)
candidate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(candidate)


class FundingServiceCandidateTests(unittest.TestCase):
    def artifact(self, root: Path) -> None:
        app = root / 'apps/web'
        (app / 'public').mkdir(parents=True)
        (app / '.next/static').mkdir(parents=True)
        (root / 'node_modules').mkdir()
        (app / 'server.js').write_text('server', encoding='utf-8')

    def test_unit_is_loopback_staging_only_and_preserves_fixed_week_lease(self):
        unit = candidate.render_unit()
        timer = candidate.render_deadline_timer()
        self.assertIn('BACI_WORKER_PROFILE=hosted-savings-funding', unit)
        self.assertIn('PORT=4795 HOSTNAME=127.0.0.1', unit)
        self.assertIn(f'WorkingDirectory={candidate.ARTIFACT_ROOT}/apps/web', unit)
        self.assertIn(f'BindReadOnlyPaths={candidate.ARTIFACT_ROOT}', unit)
        self.assertIn(f'EnvironmentFile={candidate.CONFIG_PATH}', unit)
        self.assertIn(
            f'LoadCredential={candidate.DB_CA_CREDENTIAL}:{candidate.DB_CA_PATH}',
            unit,
        )
        self.assertIn(
            'ExecStart=/bin/sh -c \'export '
            f'{candidate.DB_CA_CREDENTIAL}="$(cat '
            f'$CREDENTIALS_DIRECTORY/{candidate.DB_CA_CREDENTIAL})"; '
            'unset CREDENTIALS_DIRECTORY; '
            'exec /usr/bin/env NODE_ENV=production '
            'BACI_WORKER_PROFILE=hosted-savings-funding PORT=4795 '
            'HOSTNAME=127.0.0.1 /usr/bin/node server.js\'',
            unit,
        )
        self.assertNotIn('ImportCredential=', unit)
        self.assertNotIn('-----BEGIN CERTIFICATE-----', unit)
        self.assertLess(unit.index('EnvironmentFile='), unit.index('ExecStart='))
        self.assertLess(unit.index('LoadCredential='), unit.index('ExecStart='))
        self.assertNotIn('\nEnvironment=NODE_ENV=', unit)
        self.assertIn(
            f'BACI_SAVINGS_LEASE_EXPIRES_AT" = "{candidate.LEASE_DEADLINE_EPOCH}', unit
        )
        self.assertIn('RuntimeMaxSec=7d', unit)
        self.assertNotIn('0.0.0.0', unit)
        self.assertNotIn('Restart=always', unit)
        self.assertIn('OnCalendar=2026-09-29 15:59:10 UTC', timer)

    def test_regression_unsets_credentials_directory_before_exec(self):
        unit = candidate.render_unit()
        start = next(
            line
            for line in unit.splitlines()
            if line.startswith('ExecStart=/bin/sh -c')
        )
        export_at = start.index('$CREDENTIALS_DIRECTORY/')
        unset_at = start.index('unset CREDENTIALS_DIRECTORY;')
        exec_at = start.index('exec /usr/bin/env')
        self.assertLess(export_at, unset_at)
        self.assertLess(unset_at, exec_at)

    def test_prior_unit_pin_matches_template_without_credentials_unset(self):
        old = candidate.render_unit().replace(
            'unset CREDENTIALS_DIRECTORY; ', '', 1
        )
        self.assertNotEqual(old, candidate.render_unit())
        self.assertEqual(
            hashlib.sha256(old.encode('utf-8')).hexdigest(),
            candidate.PRIOR_UNIT_SHA256,
        )

    def test_update_unit_rewrites_only_pinned_prior_rendering(self):
        old = candidate.render_unit().replace(
            'unset CREDENTIALS_DIRECTORY; ', '', 1
        )
        with tempfile.TemporaryDirectory() as tmp:
            unit_dir = Path(tmp)
            target = unit_dir / candidate.UNIT_NAME
            staging = unit_dir / (candidate.UNIT_NAME + '.candidate-update')
            target.write_text(old, encoding='utf-8')
            real_lstat = Path.lstat

            def fake_lstat(path_self):
                if path_self in (target, staging) and os.path.lexists(path_self):
                    return SimpleNamespace(
                        st_mode=stat.S_IFREG | 0o644, st_uid=0, st_nlink=1
                    )
                return real_lstat(path_self)

            with (
                patch.object(candidate, 'UNIT_DIRECTORY', unit_dir),
                patch.object(candidate.os, 'geteuid', return_value=0),
                patch.object(candidate, 'verify_artifact'),
                patch.object(candidate, 'verify_config_metadata'),
                patch.object(candidate, 'verify_unit_directory'),
                patch.object(Path, 'lstat', fake_lstat),
                patch.object(candidate.os, 'chown'),
            ):
                self.assertEqual(candidate.update_unit(), 'updated')
                self.assertEqual(
                    target.read_text(encoding='utf-8'), candidate.render_unit()
                )
                self.assertFalse(staging.exists())
                self.assertEqual(candidate.update_unit(), 'already current')

    def test_update_unit_clears_stale_regular_staging(self):
        old = candidate.render_unit().replace(
            'unset CREDENTIALS_DIRECTORY; ', '', 1
        )
        with tempfile.TemporaryDirectory() as tmp:
            unit_dir = Path(tmp)
            target = unit_dir / candidate.UNIT_NAME
            staging = unit_dir / (candidate.UNIT_NAME + '.candidate-update')
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
                patch.object(candidate, 'UNIT_DIRECTORY', unit_dir),
                patch.object(candidate.os, 'geteuid', return_value=0),
                patch.object(candidate, 'verify_artifact'),
                patch.object(candidate, 'verify_config_metadata'),
                patch.object(candidate, 'verify_unit_directory'),
                patch.object(Path, 'lstat', fake_lstat),
                patch.object(candidate.os, 'chown'),
            ):
                self.assertEqual(candidate.update_unit(), 'updated')
                self.assertEqual(
                    target.read_text(encoding='utf-8'), candidate.render_unit()
                )

    def test_update_unit_refuses_foreign_missing_or_unsafe_unit(self):
        with tempfile.TemporaryDirectory() as tmp:
            unit_dir = Path(tmp)
            target = unit_dir / candidate.UNIT_NAME
            real_lstat = Path.lstat

            def fake_lstat(path_self):
                if path_self == target and os.path.lexists(path_self):
                    return SimpleNamespace(
                        st_mode=stat.S_IFREG | 0o644, st_uid=0, st_nlink=1
                    )
                return real_lstat(path_self)

            with (
                patch.object(candidate, 'UNIT_DIRECTORY', unit_dir),
                patch.object(candidate.os, 'geteuid', return_value=0),
                patch.object(candidate, 'verify_artifact'),
                patch.object(candidate, 'verify_config_metadata'),
                patch.object(candidate, 'verify_unit_directory'),
                patch.object(Path, 'lstat', fake_lstat),
                patch.object(candidate.os, 'chown'),
            ):
                target.write_text('[foreign]\n', encoding='utf-8')
                with self.assertRaisesRegex(candidate.Refused, 'outside the candidate'):
                    candidate.update_unit()
                target.unlink()
                with self.assertRaisesRegex(candidate.Refused, 'required for update'):
                    candidate.update_unit()
            with (
                patch.object(candidate, 'UNIT_DIRECTORY', unit_dir),
                patch.object(candidate.os, 'geteuid', return_value=0),
                patch.object(candidate, 'verify_artifact'),
                patch.object(candidate, 'verify_config_metadata'),
                patch.object(candidate, 'verify_unit_directory'),
            ):
                target.write_text('[foreign]\n', encoding='utf-8')
                with self.assertRaisesRegex(candidate.Refused, 'unsafe for update'):
                    candidate.update_unit()
            with patch.object(candidate.os, 'geteuid', return_value=501):
                with self.assertRaisesRegex(candidate.Refused, 'root execution'):
                    candidate.update_unit()

    def test_cli_update_unit_reports_outcome_without_starting_service(self):
        with (
            patch.object(candidate, 'verify_artifact'),
            patch.object(candidate, 'verify_config_metadata'),
            patch.object(candidate, 'verify_unit_directory'),
            patch.object(candidate, 'update_unit', return_value='updated'),
        ):
            self.assertEqual(candidate.main(['--update-unit']), 0)

    def test_regression_cli_accepts_normal_check_flag_without_path_overrides(self):
        with (
            patch.object(candidate, 'verify_artifact'),
            patch.object(candidate, 'verify_config_metadata'),
            patch.object(candidate, 'verify_unit_directory'),
        ):
            self.assertEqual(candidate.main(['--check']), 0)
        with self.assertRaises(SystemExit):
            candidate.main(['--check', '/tmp/standalone'])

    def test_regression_refuses_non_fixed_artifact_root(self):
        with self.assertRaisesRegex(candidate.Refused, 'fixed funding service path'):
            candidate.verify_artifact(Path('/tmp/standalone'))

    def test_regression_rejects_writable_or_symlinked_artifact_entries(self):
        writable = SimpleNamespace(st_mode=stat.S_IFREG | 0o664, st_uid=0)
        symlink = SimpleNamespace(st_mode=stat.S_IFLNK | 0o644, st_uid=0)
        with patch.object(Path, 'lstat', return_value=writable):
            with self.assertRaisesRegex(candidate.Refused, 'unsafe'):
                candidate._require_safe_path(
                    Path('/opt/baci-savings-funding/app'),
                    stat.S_IFREG,
                    'Funding artifact tree',
                )
        with patch.object(Path, 'lstat', return_value=symlink):
            with self.assertRaisesRegex(candidate.Refused, 'unsafe'):
                candidate._require_safe_path(
                    Path('/opt/baci-savings-funding/app'),
                    stat.S_IFREG,
                    'Funding artifact tree',
                )

    def test_regression_checks_every_artifact_ancestor(self):
        with patch.object(candidate, '_require_safe_path') as safe_path:
            candidate._verify_root_owned_ancestors(
                candidate.ARTIFACT_ROOT, 'Funding artifact path'
            )
        self.assertEqual(
            [call.args[0] for call in safe_path.call_args_list],
            [
                Path('/'),
                Path('/opt'),
                candidate.ARTIFACT_ROOT,
            ],
        )

    def test_regression_rejects_env_files_in_fixed_artifact(self):
        environment_file = candidate.ARTIFACT_ROOT / '.env.production'
        with (
            patch.object(candidate, '_verify_root_owned_ancestors'),
            patch.object(candidate, '_require_safe_path'),
            patch.object(candidate, '_verify_service_artifact_access'),
            patch.object(candidate.os, 'walk', return_value=[]),
            patch.object(Path, 'resolve', return_value=candidate.ARTIFACT_ROOT),
            patch.object(Path, 'is_file', return_value=True),
            patch.object(Path, 'is_dir', return_value=True),
            patch.object(Path, 'rglob', return_value=[environment_file]),
        ):
            with self.assertRaisesRegex(candidate.Refused, 'environment'):
                candidate.verify_artifact()

    def test_allows_root_owned_relative_internal_symlink_in_artifact_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'standalone'
            root.mkdir()
            self.artifact(root)
            (root / 'node_modules/server.js').symlink_to('../apps/web/server.js')

            candidate._verify_artifact_tree(root, os.getuid())

    def test_regression_rejects_unsafe_synthetic_artifact_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'standalone'
            root.mkdir()
            self.artifact(root)
            linked = root / 'node_modules/linked-server.js'
            linked.symlink_to('/etc/passwd')
            with self.assertRaisesRegex(candidate.Refused, 'relative'):
                candidate._verify_artifact_tree(root, os.getuid())
            linked.unlink()
            outside = root.parent / 'outside.js'
            outside.write_text('outside', encoding='utf-8')
            linked.symlink_to('../../outside.js')
            with self.assertRaisesRegex(candidate.Refused, 'escapes'):
                candidate._verify_artifact_tree(root, os.getuid())
            linked.unlink()
            outside_directory = root.parent / 'outside'
            outside_directory.mkdir()
            (outside_directory / 'back').symlink_to(root)
            linked.symlink_to('../../outside/back/apps/web/server.js')
            with self.assertRaisesRegex(candidate.Refused, 'escapes'):
                candidate._verify_artifact_tree(root, os.getuid())
            linked.unlink()
            linked.symlink_to('missing.js')
            with self.assertRaisesRegex(candidate.Refused, 'dangling'):
                candidate._verify_artifact_tree(root, os.getuid())
            linked.unlink()
            linked.symlink_to('linked-server.js')
            with self.assertRaisesRegex(candidate.Refused, 'dangling'):
                candidate._verify_artifact_tree(root, os.getuid())

    def test_regression_rejects_environment_or_writable_symlink_targets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'standalone'
            root.mkdir()
            self.artifact(root)
            linked = root / 'node_modules/linked-server.js'
            environment = root / '.env.production'
            environment.write_text('not-a-secret', encoding='utf-8')
            linked.symlink_to('../.env.production')
            with self.assertRaisesRegex(candidate.Refused, 'environment'):
                candidate._verify_artifact_tree(root, os.getuid())
            linked.unlink()
            environment.unlink()
            target = root / 'apps/web/server.js'
            target.chmod(0o664)
            linked.symlink_to('../apps/web/server.js')
            with self.assertRaisesRegex(candidate.Refused, 'unsafe'):
                candidate._verify_artifact_tree(root, os.getuid())

    def test_service_account_must_exist(self):
        with patch.object(candidate.pwd, 'getpwnam', side_effect=KeyError):
            with self.assertRaisesRegex(candidate.Refused, 'account and group'):
                candidate._service_identity()

    def test_service_identity_can_read_and_traverse_synthetic_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'standalone'
            root.mkdir()
            self.artifact(root)
            with patch.object(
                candidate,
                '_service_identity',
                return_value=(os.getuid(), os.getgid()),
            ):
                candidate._verify_service_artifact_access(root)

    def test_regression_refuses_artifact_unreadable_to_service_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'standalone'
            root.mkdir()
            self.artifact(root)
            (root / 'apps/web/server.js').chmod(0o000)
            with patch.object(
                candidate,
                '_service_identity',
                return_value=(os.getuid(), os.getgid()),
            ):
                with self.assertRaisesRegex(candidate.Refused, 'cannot read'):
                    candidate._verify_service_artifact_access(root)

    def test_regression_checks_fixed_config_path_only(self):
        with (
            patch.object(candidate, '_verify_root_owned_ancestors') as ancestors,
            patch.object(candidate, '_verify_secret_config') as config,
            patch.object(candidate, '_verify_ca_config') as ca_config,
        ):
            candidate.verify_config_metadata()
        self.assertEqual(
            [call.args for call in ancestors.call_args_list],
            [
                (candidate.CONFIG_PATH.parent, 'Funding configuration path'),
                (candidate.DB_CA_PATH.parent, 'Funding CA path'),
            ],
        )
        config.assert_called_once_with(
            candidate.CONFIG_PATH
        )
        ca_config.assert_called_once_with(
            candidate.DB_CA_PATH
        )

    def test_regression_refuses_group_or_world_readable_secret_config(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'funding-service.env'
            config.write_text('synthetic=true', encoding='utf-8')
            config.chmod(0o600)
            candidate._verify_secret_config(config, os.getuid())
            config.chmod(0o400)
            candidate._verify_secret_config(config, os.getuid())
            for mode in (0o640, 0o644):
                config.chmod(mode)
                with self.assertRaisesRegex(candidate.Refused, 'permissions'):
                    candidate._verify_secret_config(config, os.getuid())
            config.chmod(0o600)
            os.link(config, Path(directory) / 'second-link')
            with self.assertRaisesRegex(candidate.Refused, 'permissions'):
                candidate._verify_secret_config(config, os.getuid())

    def test_regression_accepts_only_world_readable_ca_certificate(self):
        with tempfile.TemporaryDirectory() as directory:
            ca_file = Path(directory) / 'postgres-ca.pem'
            ca_file.write_text('synthetic-ca', encoding='utf-8')
            ca_file.chmod(0o444)
            candidate._verify_ca_config(ca_file, os.getuid())
            for mode in (0o400, 0o600, 0o640, 0o644):
                ca_file.chmod(mode)
                with self.assertRaisesRegex(candidate.Refused, 'permissions'):
                    candidate._verify_ca_config(ca_file, os.getuid())

    def test_install_stays_root_only_and_uses_fixed_unit_directory(self):
        with patch.object(candidate.os, 'geteuid', return_value=501):
            with self.assertRaisesRegex(candidate.Refused, 'root execution'):
                candidate.install_unit()
        self.assertEqual(candidate.UNIT_DIRECTORY, Path('/etc/systemd/system'))


if __name__ == '__main__':
    unittest.main()
