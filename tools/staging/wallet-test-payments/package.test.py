import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import bootstrap
import install_io


spec = importlib.util.spec_from_file_location('payment_package', Path(__file__).with_name('package.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PackageTests(unittest.TestCase):
    def test_archive_has_only_regular_files_and_hashes_current_installer_bytes(self):
        content = module.archive({'install.py': b'updated pins', 'server.cjs': b'current build'})
        with tarfile.open(fileobj=io.BytesIO(content), mode='r:gz') as handle:
            self.assertTrue(all(entry.isfile() for entry in handle.getmembers()))
            manifest = handle.extractfile('SHA256SUMS').read()
        self.assertIn(module.digest(b'updated pins').encode() + b'  install.py', manifest)

    def test_wrapper_verifies_bootstrap_and_archive_before_owner_execution(self):
        wrapper = module.wrapper('a' * 64, 'b' * 64, 'c' * 64)
        self.assertIn('python3 -I -c', wrapper)
        self.assertIn('a' * 64, wrapper)
        self.assertIn('b' * 64, wrapper)
        self.assertIn('c' * 64, wrapper)
        self.assertIn('os.O_NOFOLLOW', wrapper)
        self.assertNotIn('sk_test_', wrapper)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'reviewed.sh'
            path.write_text(wrapper)
            import subprocess
            subprocess.run(['/bin/sh', '-n', str(path)], check=True)

    def test_recovery_wrapper_is_separate_and_explicit(self):
        wrapper = module.wrapper('a' * 64, 'b' * 64, 'c' * 64, recover_nginx=True)
        self.assertIn('/home/bassey/baci-test-payments-nginx-recovery-20260925/bootstrap.py', wrapper)
        self.assertIn('--recover-nginx', wrapper)
        self.assertNotIn('/home/bassey/baci-test-payments-20260925/', wrapper)
        self.assertNotIn('sk_test_', wrapper)

    def test_recovery_archive_loads_under_the_original_strict_manifest_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            profile = root / 'profile.json'
            profile.write_text(json.dumps({'supabaseOrigin': 'https://staging-auth.ogabassey.com', 'apiOrigin': 'https://staging.ogabassey.com', 'publicKey': 'public-test-key', 'merchantId': '10000000-0000-4000-8000-000000000001'}))
            server = root / 'server.cjs'
            server.write_bytes(b'test-server')
            dependencies = root / 'apps/web/tools/piggyvest-staging'
            for name in ('funding-gateway-transition/funding-gateway-transition-activator.py', 'funding-gateway-transition/funding-gateway-transition-candidate.py', 'wallet-route-repair/wallet-gateway-transition-installer.py'):
                target = dependencies / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b'test-helper')
            output = root / 'output'
            with patch.object(module, 'HOSTED_PROFILE_SHA256', module.digest(profile.read_bytes())):
                result = module.prepare(profile, server, root, output, recover_nginx=True)
            entries = bootstrap.verify_archive((output / 'owner-bundle.tar.gz').read_bytes())
            self.assertIn('nginx_recover.py', entries)
            with patch.object(install_io, 'read_root_file', side_effect=lambda path, *_: entries[path.name]):
                hashes, _, payload, _ = install_io.load_bundle(Path('/root/recovery'), result['manifestSha256'])
            self.assertNotIn('nginx_recover.py', hashes)
            self.assertEqual(payload, b'test-server')


if __name__ == '__main__':
    unittest.main()
