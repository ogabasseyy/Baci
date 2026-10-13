import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import owner_public_artifacts as artifacts
from public_service_contract import container_contract


class PublicArtifactTests(unittest.TestCase):
    def exercise(self, change=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / 'app'
            app.mkdir()
            (app / 'launch-public.cjs').write_bytes(b'launcher')
            expected = [{'path': 'launch-public.cjs', 'size': 8,
                         'sha256': artifacts.digest(b'launcher')}]
            manifest = {'tarballSha256': artifacts.ARCHIVE, 'files': expected}
            receipt = {'archiveSha256': artifacts.ARCHIVE, 'manifestSha256': artifacts.MANIFEST,
                'deadline': artifacts.DEADLINE, 'mutationsEnabled': False,
                'approvedBudgetKobo': 10000, 'preservedPrincipalKobo': 10000,
                'checkoutSha256': artifacts.digest(b'checkout'), 'anonSha256': artifacts.digest(b'anon')}
            container = container_contract(artifacts.MANIFEST)
            container['Config']['Env'] = ['NODE_VERSION=pinned']
            container['State'] = {'Running': True}
            if change:
                change(root, receipt, container)

            def read(path, owner, mode, limit):
                if path.name == 'receipt.json':
                    return json.dumps(receipt).encode()
                if path.name in ('checkout.json', 'anon.json'):
                    return path.stem.encode()
                return path.read_bytes()

            def run(arguments):
                return json.dumps([{'Config': {'Env': ['NODE_VERSION=pinned']}}]
                    if 'image' in arguments else [container])

            real_lstat = Path.lstat

            def metadata(path):
                original = real_lstat(path)
                values = list(original)
                values[4], values[5] = 0, 0
                import os
                return os.stat_result(values)

            with patch.object(artifacts, 'ROOT', str(root)), \
                    patch.object(artifacts, 'root_ancestors'), \
                    patch.object(artifacts, 'LAUNCHER', expected[0]['sha256']), \
                    patch.object(artifacts, 'pin_read', return_value=json.dumps(manifest).encode()), \
                    patch.object(artifacts, 'read_file', side_effect=read), \
                    patch.object(Path, 'lstat', metadata):
                return artifacts.verify(Path('/sealed'), run)

    def test_installed_readonly_files_configs_and_isolation_are_proved(self):
        self.assertTrue(self.exercise())

    def test_mutation_flag_config_drift_and_foreign_file_refuse(self):
        for change in (
            lambda root, receipt, container: receipt.update(mutationsEnabled=True),
            lambda root, receipt, container: receipt.update(checkoutSha256='a' * 64),
            lambda root, receipt, container: (root / 'app/foreign').write_text('foreign'),
            lambda root, receipt, container: container['Config']['Env'].append('MUTATIONS_ENABLED=true'),
        ):
            with self.subTest(change=change), self.assertRaises(Exception):
                self.exercise(change)

    def test_empty_bundle_file_still_requires_root_readonly_single_link_metadata(self):
        from types import SimpleNamespace
        metadata = SimpleNamespace(st_mode=0o100444, st_uid=0, st_gid=0, st_nlink=1, st_size=0)
        with patch.object(artifacts.os, 'open', return_value=23), \
                patch.object(artifacts.os, 'fstat', return_value=metadata), \
                patch.object(artifacts.os, 'read', return_value=b''), patch.object(artifacts.os, 'close'):
            self.assertEqual(artifacts.empty_entry(Path('/empty')), b'')
            metadata.st_nlink = 2
            with self.assertRaisesRegex(ValueError, 'empty_file_metadata_refused'):
                artifacts.empty_entry(Path('/empty'))


if __name__ == '__main__':
    unittest.main()
