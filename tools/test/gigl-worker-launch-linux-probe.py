"""Synthetic installed-worker launch test; no provider or production access.

By default the fixture uses Node's native type stripper. Set
GIGL_REAL_TSX_MODULES to a Linux-native node_modules directory to exercise tsx.
"""
import os
from pathlib import Path
import select
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path('/src')


class WorkerLaunchProbe(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.home = self.root / 'home'
        self.home.mkdir(mode=0o700)
        workers = self.home / 'baci-workers'
        workers.mkdir(mode=0o700)
        bin_dir = workers / 'bin'
        bin_dir.mkdir(mode=0o700)
        for name in ('process-gigl-tracking.sh', 'gigl-tracking-scoped-env.sh', 'gigl-cache-lock-exec.py', 'run-web-script.sh'):
            shutil.copy2(SOURCE / 'vps-workers/bin' / name, bin_dir / name)
        shutil.copy2(SOURCE / '.github/scripts/gigl-dotenv.sh', bin_dir / 'gigl-dotenv.sh')
        repo = self.root / 'checkout'
        web = repo / 'apps/web'
        scripts = web / 'src/scripts'
        scripts.mkdir(parents=True)
        real_modules = os.environ.get('GIGL_REAL_TSX_MODULES')
        if real_modules:
            (web / 'node_modules').symlink_to(real_modules, target_is_directory=True)
        else:
            binary = web / 'node_modules/.bin'
            binary.mkdir(parents=True)
            tsx = binary / 'tsx'
            tsx.write_text('#!/bin/sh\necho 4.22.4\n')
            tsx.chmod(0o755)
        (scripts / 'process-gigl-tracking.ts').write_text("""import { hasVerifiedGiglCacheLock } from '/src/apps/web/src/lib/shipping/providers/gigl-cache-lock-verification.ts';
import { join } from 'node:path';
if (process.env.SUPABASE_SERVICE_ROLE_KEY) process.exit(9);
const dir = join(process.env.HOME!, 'baci-workers', 'gigl-tracking-token-cache');
console.log(hasVerifiedGiglCacheLock(dir, 9) ? 'locked' : 'uncached');
if (process.env.GIGL_TEST_HOLD === '1') setTimeout(() => {}, 60000);
""")
        fake_bin = self.root / 'fake-bin'
        fake_bin.mkdir()
        if not real_modules:
            node = fake_bin / 'node'
            node.write_text('#!/bin/sh\n[ "$1" = "--import" ] || exit 10\nshift 2\nexec /usr/local/bin/node "$@"\n')
            node.chmod(0o755)
        (workers / '.env').write_text(f'BACI_REPO_DIR={repo}\nGIGL_TEST_HOLD=1\nSUPABASE_SERVICE_ROLE_KEY=must-not-leak\n')
        self.wrapper = bin_dir / 'process-gigl-tracking.sh'
        self.env = {**os.environ, 'HOME': str(self.home), 'PATH': f'{fake_bin}:{os.environ["PATH"]}', 'NODE_ENV': 'test', 'BACI_WORKER_PROFILE': 'gigl-tracking'}

    def tearDown(self):
        self.tmp.cleanup()

    def test_installed_wrapper_retains_lock_and_contender_bypasses_cache(self):
        first = subprocess.Popen(['bash', str(self.wrapper)], env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        second = None
        try:
            self.assertTrue(select.select([first.stdout], [], [], 60)[0], 'first worker did not produce a result')
            self.assertEqual(first.stdout.readline().strip(), 'locked')
            second = subprocess.Popen(['bash', str(self.wrapper)], env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.assertTrue(select.select([second.stdout], [], [], 60)[0], 'second worker did not produce a result')
            self.assertEqual(second.stdout.readline().strip(), 'uncached')
        finally:
            for process in (first, second):
                if process and process.poll() is None:
                    process.kill()
                if process:
                    process.communicate(timeout=10)

    def test_missing_helper_keeps_worker_available_without_cache(self):
        (self.wrapper.parent / 'gigl-cache-lock-exec.py').unlink()
        result = subprocess.run(['bash', str(self.wrapper)], env={**self.env, 'GIGL_TEST_HOLD': '0'}, capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'uncached')


if __name__ == '__main__':
    unittest.main()
