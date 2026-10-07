import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('public_artifact', Path(__file__).with_name('public-artifact.py'))
artifact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifact)


class ArtifactTests(unittest.TestCase):
    def fixture(self, root):
        web = root / 'web'
        standalone = web / '.next/standalone'
        for relative, content in {
            'apps/web/server.js': b'server',
            'apps/web/.next/server/app-paths-manifest.json': json.dumps(dict.fromkeys(artifact.ROUTES, 'route.js')).encode(),
            'node_modules/next/package.json': b'{}',
        }.items():
            destination = standalone / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
        (web / '.next/static').mkdir()
        (web / '.next/static/test.js').write_text('asset')
        launcher = root / 'launcher.cjs'
        launcher.write_text('launch')
        return web, launcher

    def test_packs_regular_files_and_launcher_with_exact_digests(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            web, launcher = self.fixture(root)
            report = artifact.package(web, launcher, root / 'output')
            self.assertEqual(report['count'], 5)
            self.assertEqual(len(report['tarballSha256']), 64)
            self.assertTrue(all('sha256' in entry for entry in report['files']))

    def test_refuses_extra_routes_and_symlink_escape(self):
        for unsafe in ('route', 'symlink', 'environment'):
            with self.subTest(unsafe=unsafe), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                web, launcher = self.fixture(root)
                tree = web / '.next/standalone'
                if unsafe == 'route':
                    manifest = tree / 'apps/web/.next/server/app-paths-manifest.json'
                    routes = json.loads(manifest.read_text())
                    routes['/api/production/route'] = 'extra.js'
                    manifest.write_text(json.dumps(routes))
                elif unsafe == 'symlink':
                    (tree / 'escape').symlink_to(launcher)
                else:
                    (tree / '.env').write_text('not-for-shipping')
                with self.assertRaises(ValueError):
                    artifact.package(web, launcher, root / 'output')


if __name__ == '__main__':
    unittest.main()
