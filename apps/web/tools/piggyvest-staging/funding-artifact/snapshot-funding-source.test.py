import importlib.util
import json
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path


BASE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location(
    'snapshot_funding_source', BASE / 'snapshot-funding-source.py'
)
snapshot = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(snapshot)


def git(arguments, workdir):
    completed = subprocess.run(
        ['git', *arguments],
        cwd=workdir,
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return completed.stdout


class SnapshotTests(unittest.TestCase):
    def fixture(self, root):
        git(['init', '-q'], root)
        git(['config', 'user.email', 'test@example.invalid'], root)
        git(['config', 'user.name', 'test'], root)
        (root / '.gitignore').write_text('.env.local\n', encoding='utf-8')
        (root / 'tracked.txt').write_text('tracked', encoding='utf-8')
        (root / 'untracked.txt').write_text('untracked', encoding='utf-8')
        (root / '.env.local').write_text('secret', encoding='utf-8')
        cache = root / 'pkg' / '__pycache__'
        cache.mkdir(parents=True)
        (cache / 'junk.pyc').write_text('junk', encoding='utf-8')
        logs = root / '.playwright-cli'
        logs.mkdir()
        (logs / 'session.log').write_text('junk', encoding='utf-8')
        git(['add', '.gitignore', 'tracked.txt'], root)
        git(['commit', '-qm', 'fixture'], root)

    def test_snapshot_captures_tracked_and_untracked_but_never_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'repo'
            root.mkdir()
            self.fixture(root)
            out = Path(directory) / 'out'
            result = snapshot.snapshot(root, out)
            self.assertEqual(result['count'], 3)
            paths = [entry['path'] for entry in result['files']]
            self.assertEqual(paths, ['.gitignore', 'tracked.txt', 'untracked.txt'])
            tree = Path(directory) / 'tree'
            tree.mkdir()
            with tarfile.open(result['tarball']) as archive:
                archive.extractall(tree, filter='data')
            verified = snapshot.verify(
                Path(result['tarball']), Path(result['manifest']), tree
            )
            self.assertEqual(verified['checked'], 3)

    def test_verify_refuses_tampered_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'repo'
            root.mkdir()
            self.fixture(root)
            out = Path(directory) / 'out'
            result = snapshot.snapshot(root, out)
            tree = Path(directory) / 'tree'
            tree.mkdir()
            with tarfile.open(result['tarball']) as archive:
                archive.extractall(tree, filter='data')
            (tree / 'tracked.txt').write_text('tampered', encoding='utf-8')
            with self.assertRaises(snapshot.Refused):
                snapshot.verify(
                    Path(result['tarball']), Path(result['manifest']), tree
                )

    def test_snapshot_refuses_environment_files_even_when_tracked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'repo'
            root.mkdir()
            self.fixture(root)
            git(['add', '-f', '.env.local'], root)
            git(['commit', '-qm', 'track secret'], root)
            with self.assertRaisesRegex(snapshot.Refused, 'Environment'):
                snapshot.snapshot(root, Path(directory) / 'out')


if __name__ == '__main__':
    unittest.main()
