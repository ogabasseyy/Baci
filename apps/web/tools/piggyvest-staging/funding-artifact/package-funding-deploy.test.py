import importlib.util
import json
import tarfile
import tempfile
import unittest
from pathlib import Path


BASE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location(
    'package_funding_deploy', BASE / 'package-funding-deploy.py'
)
package = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(package)


class PackageTests(unittest.TestCase):
    def fixture(self, root):
        web = root / 'apps' / 'web'
        standalone = web / '.next' / 'standalone'
        (standalone / 'apps' / 'web').mkdir(parents=True)
        (standalone / 'apps' / 'web' / 'server.js').write_text('server')
        (standalone / 'node_modules').mkdir()
        (standalone / 'node_modules' / 'left-pad.js').write_text('pad')
        (standalone / 'node_modules' / 'alias.js').symlink_to('left-pad.js')
        (web / '.next' / 'static').mkdir(parents=True)
        (web / '.next' / 'static' / 'chunk.js').write_text('chunk')
        (web / 'public').mkdir()
        (web / 'public' / 'icon.svg').write_text('icon')
        return web

    def test_package_arranges_deploy_tree_with_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            web = self.fixture(root)
            result = package.package(web, root / 'out')
            self.assertEqual(result['count'], 5)
            self.assertGreater(result['bytes'], 0)
            tree = root / 'out' / 'funding-deploy-20200101.tree'
            trees = sorted((root / 'out').glob('*.tree'))
            self.assertEqual(len(trees), 1)
            self.assertTrue((trees[0] / 'apps' / 'web' / 'server.js').is_file())
            self.assertTrue((trees[0] / 'apps' / 'web' / '.next' / 'static' / 'chunk.js').is_file())
            self.assertTrue((trees[0] / 'apps' / 'web' / 'public' / 'icon.svg').is_file())
            self.assertTrue((trees[0] / 'node_modules' / 'alias.js').is_symlink())
            manifest = json.loads(Path(result['manifest']).read_text())
            self.assertEqual(manifest['tarballSha256'], result['tarballSha256'])
            kinds = sorted(entry.get('link', False) for entry in manifest['files'])
            self.assertEqual(kinds, [False, False, False, False, True])

    def test_package_round_trip_preserves_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            web = self.fixture(root)
            result = package.package(web, root / 'out')
            restored = root / 'restored'
            restored.mkdir()
            with tarfile.open(result['tarball']) as archive:
                archive.extractall(restored, filter='data')
            self.assertTrue((restored / 'node_modules' / 'alias.js').is_symlink())
            self.assertEqual((restored / 'node_modules' / 'alias.js').read_text(), 'pad')

    def test_package_refuses_missing_server_or_environment_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            missing = root / 'missing'
            missing.mkdir()
            web = self.fixture(missing)
            (web / '.next' / 'standalone' / 'apps' / 'web' / 'server.js').unlink()
            with self.assertRaisesRegex(package.Refused, 'entrypoint'):
                package.package(web, root / 'out')
            leaked = root / 'leaked'
            leaked.mkdir()
            web = self.fixture(leaked)
            (web / 'public' / '.env.production').write_text('secret')
            with self.assertRaisesRegex(package.Refused, 'environment'):
                package.package(web, root / 'out2')


if __name__ == '__main__':
    unittest.main()
