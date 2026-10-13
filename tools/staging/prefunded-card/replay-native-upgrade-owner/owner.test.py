from pathlib import Path
import os
import sys
import tempfile
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).parent))
import owner
from owner_io import Refused, serialized


class EntryTest(unittest.TestCase):
    def fixture(self):
        files = {**owner.RUNTIME_PINS, **{'owner/' + name: 'a' * 64 for name in owner.OWNER},
                 **{'kit/' + name: 'b' * 64 for name in owner.KIT},
                 **{'artifact/' + name: 'c' * 64 for name in
                    ('manifest.json', 'metafile.json', 'inventory.json', 'virtual-entry.ts', 'prefunded-replay-bundle.mjs')}}
        files['artifact/manifest.json'] = owner.MANIFEST
        files['artifact/prefunded-replay-bundle.mjs'] = owner.BUNDLE
        release = {'schemaVersion': 1, 'artifactManifestSha256': owner.MANIFEST, 'files': files}
        manifest = {'observed': {'/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/prefunded-card/replay-native-upgrade/' + name:
                                {'beforeSha256': 'b' * 64, 'afterSha256': 'b' * 64} for name in owner.KIT}}
        def reader(filename, expected=None, **options):
            if filename.name == 'release.json':
                return serialized(release)
            if filename == Path('/root/reviewed/artifact/manifest.json'):
                return serialized(manifest)
            return b'synthetic-pinned-source'
        return release, manifest, reader

    def test_exact_helper_runtime_and_kit_artifact_closure(self):
        release, manifest, reader = self.fixture()
        self.assertEqual(owner.verify_release(Path('/root/reviewed'), 'a' * 64, reader), release)

    def test_refuses_changed_artifact_validator_source_and_extra_path(self):
        for change in ('manifest', 'runtime', 'kit', 'path'):
            release, manifest, reader = self.fixture()
            if change == 'manifest':
                release['artifactManifestSha256'] = 'f' * 64
            if change == 'runtime':
                release['files']['runtime/replay_cutover_runtime.py'] = 'f' * 64
            if change == 'kit':
                next(iter(manifest['observed'].values()))['afterSha256'] = 'f' * 64
            if change == 'path':
                release['files']['../escaped'] = 'f' * 64
            with self.assertRaises(Refused, msg=change):
                owner.verify_release(Path('/root/reviewed'), 'a' * 64, reader)

    def test_subprocess_failure_does_not_surface_secret_stdout_or_stderr(self):
        failure = type('Result', (), {'returncode': 1, 'stdout': b'secret-value', 'stderr': b'secret-value'})()
        with patch.object(owner.subprocess, 'run', return_value=failure):
            with self.assertRaisesRegex(Refused, '^bounded_command_refused$'):
                owner.command(['/usr/bin/node', 'synthetic'])

    def test_stage_preserves_reviewed_directory_modes_under_private_umask(self):
        def bridge(arguments, timeout):
            generation = Path(arguments[-1])
            for relative in owner.PINS:
                (generation / relative).write_bytes(b'synthetic-generation')
            files = {**owner.PINS, 'code/prefunded-replay-bundle.mjs': owner.BUNDLE}
            return serialized({'artifactManifestSha256': owner.MANIFEST,
                               'bundleSha256': owner.BUNDLE, 'files': files}).decode()
        def verify_modes(generation, pins):
            for section in ('code', 'config'):
                self.assertEqual((generation / section).stat().st_mode & 0o777, 0o750)
        with tempfile.TemporaryDirectory() as directory:
            previous = os.umask(0o077)
            try:
                with patch.object(owner, 'GENERATIONS', Path(directory)), \
                     patch.object(owner.os, 'chown'), patch.object(owner.os, 'fchown'), \
                     patch.object(owner, 'verify_tree', verify_modes):
                    owner.stage(Path(directory), 'a' * 64,
                                {'Id': owner.OLD_ID, 'State': {'Running': False}}, bridge)
            finally:
                os.umask(previous)


if __name__ == '__main__':
    unittest.main()
