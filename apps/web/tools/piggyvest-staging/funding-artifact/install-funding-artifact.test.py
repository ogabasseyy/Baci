import hashlib
import importlib.util
import json
import os
import shutil
import tarfile
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


BASE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location(
    'install_funding_artifact', BASE / 'install-funding-artifact.py'
)
install = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(install)
CANDIDATE_SOURCE = BASE.parent / 'funding-service' / 'funding-service-candidate.py'
VALIDATION_SOURCE = (
    BASE.parent / 'funding-service' / 'funding-service-validation.py'
)


def real_validation_module():
    spec = importlib.util.spec_from_file_location(
        'real_validation', VALIDATION_SOURCE
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(65536), b''):
            digest.update(block)
    return digest.hexdigest()


def real_candidate_module(staging):
    spec = importlib.util.spec_from_file_location(
        'real_candidate', staging / install.CANDIDATE_NAME
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class InstallTests(unittest.TestCase):
    def deploy_tree(self, root):
        app = root / 'apps' / 'web'
        (app / 'public').mkdir(parents=True)
        (app / '.next' / 'static').mkdir(parents=True)
        (root / 'node_modules').mkdir()
        (app / 'server.js').write_text('server', encoding='utf-8')
        (app / 'public' / 'icon.svg').write_text('icon', encoding='utf-8')
        (app / '.next' / 'static' / 'chunk.js').write_text('chunk', encoding='utf-8')
        (root / 'node_modules' / 'dep.js').write_text('dep', encoding='utf-8')
        (root / 'node_modules' / 'alias.js').symlink_to('dep.js')
        return root

    def stage(self, directory):
        staging = Path(directory) / 'staging'
        staging.mkdir()
        tree = self.deploy_tree(Path(directory) / 'tree')
        entries = []
        for path in sorted(tree.rglob('*')):
            relative = path.relative_to(tree).as_posix()
            if path.is_symlink():
                entries.append(
                    {'path': relative, 'link': True, 'target': str(path.readlink())}
                )
            elif path.is_file():
                entries.append(
                    {'path': relative, 'sha256': sha256(path), 'size': path.stat().st_size}
                )
        def as_root(info):
            info.uid = 0
            info.gid = 0
            info.uname = 'root'
            info.gname = 'root'
            return info

        tarball = staging / install.TARBALL_NAME
        with tarfile.open(tarball, 'w:gz') as archive:
            for entry in entries:
                archive.add(
                    str(tree / entry['path']),
                    arcname=entry['path'],
                    filter=as_root,
                )
        manifest = {
            'version': 1,
            'count': len(entries),
            'bytes': 1,
            'files': entries,
            'tarballSha256': sha256(tarball),
            'tarballSize': 1,
        }
        (staging / install.MANIFEST_NAME).write_text(
            json.dumps(manifest), encoding='utf-8'
        )
        shutil.copy(CANDIDATE_SOURCE, staging / install.CANDIDATE_NAME)
        return staging

    def pinned(self, staging):
        install.TARBALL_SHA256 = sha256(staging / install.TARBALL_NAME)
        install.MANIFEST_SHA256 = sha256(staging / install.MANIFEST_NAME)
        install.CANDIDATE_SHA256 = sha256(staging / install.CANDIDATE_NAME)

    def candidate_double(self, staging, target, verify):
        module = real_candidate_module(staging)
        module.ARTIFACT_ROOT = target
        module._verify_root_owned_ancestors = lambda *a, **k: None
        module.verify_artifact = verify
        return module

    def test_install_places_verified_tree_and_proves_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            staging = self.stage(directory)
            self.pinned(staging)
            target = Path(directory) / 'opt' / 'baci-savings-funding'
            target.parent.mkdir(parents=True)
            calls = []
            verified = []
            double = self.candidate_double(
                staging, target, lambda: verified.append(True)
            )
            with (
                patch.object(install, 'ARTIFACT_ROOT', target),
                patch.object(
                    install, 'STAGING_ROOT', Path(directory) / 'opt' / '.staging'
                ),
                patch.object(install, 'TEMP_PARENT', Path(directory)),
                patch.object(install, '_load_candidate', return_value=double),
                patch.object(install.os, 'geteuid', return_value=0),
                patch.object(
                    install.os, 'chown', side_effect=lambda *a, **k: calls.append(a)
                ),
                patch.object(
                    install.os, 'lchown', side_effect=lambda *a, **k: calls.append(a)
                ),
                patch.object(install.os, 'chmod', return_value=None),
            ):
                result = install.install(staging)
            self.assertEqual(result['checked'], 5)
            self.assertEqual(verified, [True])
            self.assertTrue((target / 'apps' / 'web' / 'server.js').is_file())
            self.assertTrue((target / 'node_modules' / 'alias.js').is_symlink())
            staging_root = Path(directory) / 'opt' / '.staging'
            normalized = {
                str(Path(call[0]).relative_to(staging_root))
                for call in calls
                if call[1] == 0 and call[2] == 0
            }
            expected = {'.'} | {
                str(path.relative_to(target)) for path in target.rglob('*')
            }
            self.assertEqual(normalized, expected)

    def test_placed_tree_satisfies_real_candidate_rules(self):
        with tempfile.TemporaryDirectory() as directory:
            staging = self.stage(directory)
            self.pinned(staging)
            target = Path(directory) / 'opt' / 'baci-savings-funding'
            target.parent.mkdir(parents=True)
            module = real_candidate_module(staging)
            double = self.candidate_double(staging, target, lambda: None)
            with (
                patch.object(install, 'ARTIFACT_ROOT', target),
                patch.object(
                    install, 'STAGING_ROOT', Path(directory) / 'opt' / '.staging'
                ),
                patch.object(install, 'TEMP_PARENT', Path(directory)),
                patch.object(install, '_load_candidate', return_value=double),
                patch.object(install.os, 'geteuid', return_value=0),
                patch.object(install.os, 'chown', return_value=None),
                patch.object(install.os, 'lchown', return_value=None),
                patch.object(install.os, 'chmod', return_value=None),
            ):
                install.install(staging)
            rules = real_validation_module()
            rules._verify_artifact_tree(target, os.getuid())
            with patch.object(
                rules, '_service_identity', return_value=(os.getuid(), os.getgid())
            ):
                rules._verify_service_artifact_access(target)
            required = (
                target / 'apps/web/server.js',
                target / 'apps/web/public',
                target / 'apps/web/.next/static',
                target / 'node_modules',
            )
            self.assertTrue(required[0].is_file())
            self.assertTrue(all(path.is_dir() for path in required[1:]))
            self.assertFalse(
                any(rules._is_environment_file(path) for path in target.rglob('*'))
            )

    def test_install_removes_target_when_candidate_verification_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            staging = self.stage(directory)
            self.pinned(staging)
            target = Path(directory) / 'opt' / 'baci-savings-funding'
            target.parent.mkdir(parents=True)
            module = real_candidate_module(staging)

            def failing_verify():
                raise module.Refused('synthetic candidate refusal')

            double = self.candidate_double(staging, target, failing_verify)
            with (
                patch.object(install, 'ARTIFACT_ROOT', target),
                patch.object(
                    install, 'STAGING_ROOT', Path(directory) / 'opt' / '.staging'
                ),
                patch.object(install, 'TEMP_PARENT', Path(directory)),
                patch.object(install, '_load_candidate', return_value=double),
                patch.object(install.os, 'geteuid', return_value=0),
                patch.object(install.os, 'chown', return_value=None),
                patch.object(install.os, 'lchown', return_value=None),
                patch.object(install.os, 'chmod', return_value=None),
            ):
                with self.assertRaisesRegex(install.Refused, 'candidate verification'):
                    install.install(staging)
            self.assertFalse(target.exists())
            self.assertFalse((Path(directory) / 'opt' / '.staging').exists())

    def test_install_extracts_pinned_bytes_despite_midflight_swap(self):
        with tempfile.TemporaryDirectory() as directory:
            staging = self.stage(directory)
            self.pinned(staging)
            target = Path(directory) / 'target'
            genuine_open = tarfile.open

            def swapping_open(*arguments, **keywords):
                (staging / install.TARBALL_NAME).write_bytes(b'swapped-garbage')
                return genuine_open(*arguments, **keywords)

            with (
                patch.object(install, 'ARTIFACT_ROOT', target),
                patch.object(install, 'STAGING_ROOT', Path(directory) / 's'),
                patch.object(install, 'TEMP_PARENT', Path(directory)),
                patch.object(
                    install,
                    '_load_candidate',
                    return_value=self.candidate_double(staging, target, lambda: None),
                ),
                patch.object(install.os, 'geteuid', return_value=0),
                patch.object(install.os, 'chown', return_value=None),
                patch.object(install.os, 'lchown', return_value=None),
                patch.object(install.os, 'chmod', return_value=None),
                patch.object(install.tarfile, 'open', side_effect=swapping_open),
            ):
                result = install.install(staging)
            self.assertEqual(result['checked'], 5)
            self.assertTrue((target / 'apps' / 'web' / 'server.js').is_file())

    def test_load_candidate_executes_verified_module(self):
        with tempfile.TemporaryDirectory() as directory:
            staging = self.stage(directory)
            self.pinned(staging)
            module = install._load_candidate(staging / install.CANDIDATE_NAME)
            self.assertEqual(module.ARTIFACT_ROOT, Path('/opt/baci-savings-funding'))
            self.assertTrue(callable(module.verify_artifact))

    def test_install_refuses_tampered_staging_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            for name in (install.TARBALL_NAME, install.CANDIDATE_NAME):
                case = Path(directory) / name.replace('.', '_')
                case.mkdir()
                staging = self.stage(case)
                self.pinned(staging)
                with patch.object(install.os, 'geteuid', return_value=0):
                    with open(staging / name, 'r+b') as handle:
                        handle.seek(100)
                        handle.write(b'\x00')
                    with self.assertRaisesRegex(install.Refused, 'hash differs'):
                        install.install(staging)

    def test_install_refuses_manifest_content_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            staging = self.stage(root)
            manifest_path = staging / install.MANIFEST_NAME
            manifest = json.loads(manifest_path.read_text())
            manifest['files'][0]['sha256'] = '0' * 64
            manifest_path.write_text(json.dumps(manifest))
            self.pinned(staging)
            target = root / 'target'
            with (
                patch.object(install, 'ARTIFACT_ROOT', target),
                patch.object(install, 'STAGING_ROOT', root / 'staging-tmp'),
                patch.object(install, 'TEMP_PARENT', root),
                patch.object(
                    install,
                    '_load_candidate',
                    return_value=self.candidate_double(staging, target, lambda: None),
                ),
                patch.object(install.os, 'geteuid', return_value=0),
            ):
                with self.assertRaisesRegex(install.Refused, 'differs'):
                    install.install(staging)
            self.assertFalse(target.exists())

    def test_install_refuses_absolute_manifest_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            staging = self.stage(root)
            manifest_path = staging / install.MANIFEST_NAME
            manifest = json.loads(manifest_path.read_text())
            manifest['files'][0]['path'] = '/etc/absolute-escape'
            manifest_path.write_text(json.dumps(manifest))
            self.pinned(staging)
            target = root / 'target'
            with (
                patch.object(install, 'ARTIFACT_ROOT', target),
                patch.object(install, 'STAGING_ROOT', root / 'staging-tmp'),
                patch.object(install, 'TEMP_PARENT', root),
                patch.object(
                    install,
                    '_load_candidate',
                    return_value=self.candidate_double(staging, target, lambda: None),
                ),
                patch.object(install.os, 'geteuid', return_value=0),
            ):
                with self.assertRaisesRegex(install.Refused, 'invalid'):
                    install.install(staging)
            self.assertFalse(target.exists())

    def test_install_cleans_staging_when_normalize_refuses(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            staging = self.stage(root)
            self.pinned(staging)
            target = root / 'target'
            staging_tmp = root / 'staging-tmp'
            with (
                patch.object(install, 'ARTIFACT_ROOT', target),
                patch.object(install, 'STAGING_ROOT', staging_tmp),
                patch.object(install, 'TEMP_PARENT', root),
                patch.object(
                    install,
                    '_load_candidate',
                    return_value=self.candidate_double(staging, target, lambda: None),
                ),
                patch.object(install.os, 'geteuid', return_value=0),
                patch.object(
                    install,
                    '_normalize_entry',
                    side_effect=install.Refused('synthetic normalize refusal'),
                ),
            ):
                with self.assertRaisesRegex(install.Refused, 'normalize refusal'):
                    install.install(staging)
            self.assertFalse(target.exists())
            self.assertFalse(staging_tmp.exists())
            self.assertEqual(list(root.glob('funding-deploy-*')), [])

    def test_install_refuses_without_root_or_with_existing_target(self):
        with tempfile.TemporaryDirectory() as directory:
            staging = self.stage(directory)
            self.pinned(staging)
            with patch.object(install.os, 'geteuid', return_value=501):
                with self.assertRaisesRegex(install.Refused, 'root execution'):
                    install.install(staging)
            target = Path(directory) / 'target'
            target.mkdir()
            with (
                patch.object(install, 'ARTIFACT_ROOT', target),
                patch.object(
                    install,
                    '_load_candidate',
                    return_value=self.candidate_double(staging, target, lambda: None),
                ),
                patch.object(install.os, 'geteuid', return_value=0),
            ):
                with self.assertRaisesRegex(install.Refused, 'already exists'):
                    install.install(staging)


if __name__ == '__main__':
    unittest.main()
