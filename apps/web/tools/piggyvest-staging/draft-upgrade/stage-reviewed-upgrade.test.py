import hashlib
import os
import pathlib
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name('stage-reviewed-upgrade.sh')
FILES = ('README.md', 'artifact_validation.py', 'descriptor_copy.py',
         'systemd_identity.py', 'upgrade-savings-drafts.py',
         'full-artifact-manifest.json', 'full-artifact-manifest.sha256')


class StageReviewedUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.package = self.root / 'package'
        self.package.mkdir()
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.marker = self.root / 'ssh-calls'
        stub = self.bin / 'ssh'
        stub.write_text('#!/bin/sh\nprintf "called\\n" >> "$MARKER"\n'
                        'case "$*" in *mktemp*) printf "%s\\n" '
                        '"${STAGE:-/home/bassey/reviewed-draft-upgrade-AbCd1234}";; '
                        '*) cat >/dev/null;; esac\n')
        stub.chmod(0o755)
        for name in FILES:
            (self.package / name).write_text('{}')
        self.manifest_hash = hashlib.sha256(b'{}').hexdigest()
        seal = ''.join(f'{self.manifest_hash}  {name}\n' for name in FILES)
        (self.package / 'reviewed-package.sha256').write_text(seal)
        self.seal_hash = hashlib.sha256(seal.encode()).hexdigest()
        self.environment = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}',
                                MARKER=str(self.marker))

    def run_wrapper(self, manifest=None, seal=None):
        return subprocess.run(['sh', str(SCRIPT), str(self.package),
                               manifest or self.manifest_hash, seal or self.seal_hash],
                              env=self.environment, text=True, capture_output=True)

    def test_rejects_modified_manifest_before_ssh(self):
        (self.package / 'full-artifact-manifest.json').write_text('changed')
        self.assertNotEqual(self.run_wrapper().returncode, 0)
        self.assertFalse(self.marker.exists())

    def test_rejects_modified_module_before_ssh(self):
        (self.package / 'descriptor_copy.py').write_text('changed')
        self.assertNotEqual(self.run_wrapper().returncode, 0)
        self.assertFalse(self.marker.exists())

    def test_rejects_replaced_seal_before_ssh(self):
        (self.package / 'reviewed-package.sha256').write_text('changed')
        self.assertNotEqual(self.run_wrapper().returncode, 0)
        self.assertFalse(self.marker.exists())

    def test_rejects_symlink_before_ssh(self):
        target = self.package / 'descriptor_copy.py'
        target.unlink()
        target.symlink_to(self.package / 'README.md')
        self.assertNotEqual(self.run_wrapper().returncode, 0)
        self.assertFalse(self.marker.exists())

    def test_rejects_wrong_hash_lengths_before_ssh(self):
        for length in (1, 63, 65):
            self.assertNotEqual(self.run_wrapper(manifest='a' * length).returncode, 0)
        self.assertFalse(self.marker.exists())

    def test_rejects_shell_characters_in_remote_path(self):
        self.environment['STAGE'] = "/home/bassey/reviewed-draft-upgrade-ab'cd123"
        self.assertNotEqual(self.run_wrapper().returncode, 0)
        self.assertEqual(self.marker.read_text().splitlines(), ['called'])

    def test_stages_pinned_package_and_renders_one_valid_shell_argument(self):
        import shlex
        result = self.run_wrapper()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.marker.read_text().splitlines()), 2)
        command = result.stdout.split('Owner executes after review: ', 1)[1].strip()
        arguments = shlex.split(command)
        self.assertEqual(arguments[:3], ['sudo', 'sh', '-c'])
        self.assertEqual(len(arguments), 4)
        syntax = subprocess.run(['sh', '-n', '-c', arguments[3]], capture_output=True)
        self.assertEqual(syntax.returncode, 0, syntax.stderr)
        self.assertIn(self.seal_hash, arguments[3])
        self.assertIn('python3 upgrade-savings-drafts.py', arguments[3])


if __name__ == '__main__':
    unittest.main()
