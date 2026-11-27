#!/usr/bin/env python3
"""Security contracts for the base-owned inert PR audit snapshot."""
import importlib.util
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
import unittest

SOURCE = Path(__file__).with_name('base-owned-audit-snapshot.py')
spec = importlib.util.spec_from_file_location('snapshot', SOURCE)
snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(snapshot)

class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.email', 'fixture@example.test')
        self.git('config', 'user.name', 'Fixture')
        self.write('.github/scripts/muse-review/run.sh', 'safe\n')
        self.write('.github/workflows/security.yml', 'safe\n')
        self.write('README.md', 'ordinary\n')
        self.base = self.commit('base')

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), '-c', 'core.hooksPath=/dev/null', *args], text=True).strip()

    def write(self, path, value):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(value)

    def commit(self, name):
        self.git('add', '-A')
        self.git('commit', '-qm', name)
        return self.git('rev-parse', 'HEAD')

    def stage(self, head):
        return snapshot.stage_snapshot(self.repo, self.base, head, self.root / 'stage')

    def test_benign_snapshot_uses_head_objects_not_worktree(self):
        self.write('README.md', 'changed\n')
        head = self.commit('ordinary')
        self.write('.github/scripts/muse-review/run.sh', 'uncommitted poison\n')
        self.assertFalse(self.stage(head))
        self.assertEqual((self.root / 'stage/.github/scripts/muse-review/run.sh').read_text(), 'safe\n')

    def test_detects_deleted_or_renamed_trusted_files(self):
        self.git('mv', '.github/scripts/muse-review/run.sh', '.github/scripts/renamed.sh')
        self.assertTrue(self.stage(self.commit('rename')))

    def test_rejects_symlink_in_untrusted_github_tree(self):
        (self.repo / '.github/workflows/security.yml').unlink()
        os.symlink('/etc/passwd', self.repo / '.github/workflows/security.yml')
        with self.assertRaises(snapshot.SnapshotError):
            self.stage(self.commit('symlink'))

    def test_rejects_submodule_in_untrusted_github_tree(self):
        self.git('update-index', '--add', '--cacheinfo', f'160000,{self.base},.github/foreign')
        self.git('commit', '-qm', 'submodule')
        head = self.git('rev-parse', 'HEAD')
        with self.assertRaises(snapshot.SnapshotError):
            self.stage(head)

    def test_untrusted_root_output_symlink_is_not_materialized(self):
        os.symlink('/etc/passwd', self.repo / 'semgrep.sarif')
        self.assertFalse(self.stage(self.commit('root-output')))
        self.assertFalse((self.root / 'stage/semgrep.sarif').exists())

    def test_rejects_invalid_or_missing_revision(self):
        with self.assertRaises(snapshot.SnapshotError):
            self.stage('0' * 40)
        with self.assertRaises(snapshot.SnapshotError):
            self.stage('HEAD')

    def test_real_base_auditor_rejects_hostile_head_and_accepts_control(self):
        trusted_github = SOURCE.parent.parent
        shutil.copytree(trusted_github / 'scripts/muse-review', self.repo / '.github/scripts/muse-review', dirs_exist_ok=True)
        shutil.copyfile(trusted_github / 'workflows/muse-code-review.yml', self.repo / '.github/workflows/muse-code-review.yml')
        good = self.commit('auditor-control')
        good_stage = self.root / 'good-stage'
        snapshot.stage_snapshot(self.repo, self.base, good, good_stage)
        def audit(stage):
            env = {'PATH': '/usr/bin:/bin', 'GITHUB_WORKSPACE': str(stage),
                   'TRUSTED_CHANGED': 'true', 'TRUSTED_CHANGE_ADVISORY': 'true'}
            command = 'import runpy,sys;sys.path.insert(0,sys.argv[1]);runpy.run_path(sys.argv[1]+"/semgrep-sarif-filter.py",run_name="__main__")'
            return subprocess.run(['python3', '-I', '-c', command, str(SOURCE.parent)], env=env, cwd=stage, capture_output=True, text=True)
        control = audit(good_stage)
        self.assertEqual(control.returncode, 0, control.stdout + control.stderr)
        workflow = self.repo / '.github/workflows/muse-code-review.yml'
        source = workflow.read_text()
        self.assertIn('persist-credentials: false', source)
        workflow.write_text(source.replace('persist-credentials: false', 'persist-credentials: true', 1))
        hostile = self.commit('weaken-checkout')
        hostile_stage = self.root / 'hostile-stage'
        snapshot.stage_snapshot(self.repo, self.base, hostile, hostile_stage)
        self.assertNotEqual(audit(hostile_stage).returncode, 0)

    def test_rejects_stale_or_unrelated_base(self):
        self.write('README.md', 'base advanced\n')
        advanced = self.commit('advanced')
        with self.assertRaises(snapshot.SnapshotError):
            snapshot.stage_snapshot(self.repo, advanced, self.base, self.root / 'stale-stage')
        tree = self.git('rev-parse', f'{self.base}^{{tree}}')
        unrelated = self.git('commit-tree', tree, '-m', 'unrelated')
        with self.assertRaises(snapshot.SnapshotError):
            self.stage(unrelated)

    def test_rejects_oversized_git_output(self):
        previous = snapshot.MAX_GIT_OUTPUT
        try:
            snapshot.MAX_GIT_OUTPUT = 80
            with self.assertRaises(snapshot.SnapshotError):
                self.stage(self.base)
        finally:
            snapshot.MAX_GIT_OUTPUT = previous

    def test_rejects_oversized_blob(self):
        self.write('.github/workflows/huge.yml', 'x' * (snapshot.MAX_BLOB_BYTES + 1))
        with self.assertRaises(snapshot.SnapshotError):
            self.stage(self.commit('large'))

if __name__ == '__main__':
    unittest.main()
