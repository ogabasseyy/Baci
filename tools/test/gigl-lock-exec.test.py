"""Synthetic process-level tests for the GIGL cache lock launcher."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HELPER = Path(__file__).resolve().parents[2] / "vps-workers/bin/gigl-cache-lock-exec.py"
CHECK = """import os,time
try:
 data=os.pread(9,32,0).decode()
 locked=data == str(os.getpid())+'\\n'
except OSError: locked=False
print('locked' if locked else 'uncached',flush=True)
if len(__import__('sys').argv)>1: time.sleep(60)
"""


class LockExecTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        (self.home / "baci-workers").mkdir(mode=0o700)
        self.env = {**os.environ, "HOME": str(self.home)}

    def tearDown(self):
        self.tmp.cleanup()

    def start(self, hold=False):
        args = [sys.executable, str(HELPER), sys.executable, "-c", CHECK]
        if hold:
            args.append("hold")
        return subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=self.env)

    def test_unrelated_inherited_fd_nine_remains_open_and_locked(self):
        script = r'''import fcntl, os, sys
fd = os.open(sys.argv[2], os.O_CREAT | os.O_RDWR, 0o600)
fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
os.dup2(fd, 9, inheritable=True)
if fd != 9: os.close(fd)
os.execv(sys.executable, [sys.executable, sys.argv[1], sys.executable, '-c',
    "import fcntl, os, subprocess, sys; os.fstat(9); "
    "p=subprocess.run([sys.executable,'-c',\"import fcntl,os,sys; f=os.open(sys.argv[1],os.O_RDWR); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\",sys.argv[1]],capture_output=True); "
    "sys.exit(0 if p.returncode != 0 else 1)", sys.argv[2]])
'''
        result = subprocess.run(
            [sys.executable, '-c', script, str(HELPER), str(self.home / 'unrelated.lock')],
            env=self.env, capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_contender_runs_uncached_and_killed_holder_releases(self):
        holder = self.start(hold=True)
        try:
            self.assertEqual(holder.stdout.readline().strip(), "locked")
            contender = self.start()
            stdout, stderr = contender.communicate(timeout=10)
            self.assertEqual(contender.returncode, 0, stderr)
            self.assertEqual(stdout.strip(), "uncached")
            holder.kill()
            holder.communicate(timeout=10)
            after = self.start()
            stdout, stderr = after.communicate(timeout=10)
            self.assertEqual(after.returncode, 0, stderr)
            self.assertEqual(stdout.strip(), "locked")
        finally:
            if holder.poll() is None:
                holder.kill()
            holder.communicate(timeout=10)

    def test_symlink_lock_is_never_followed(self):
        directory = self.home / "baci-workers/gigl-tracking-token-cache"
        directory.mkdir(mode=0o700)
        target = self.home / "untouched"
        target.write_text("sentinel")
        (directory / "cache.lock").symlink_to(target)
        run = self.start()
        stdout, stderr = run.communicate(timeout=10)
        self.assertEqual(run.returncode, 0, stderr)
        self.assertEqual(stdout.strip(), "uncached")
        self.assertEqual(target.read_text(), "sentinel")

    def test_unsafe_parent_runs_uncached_without_creating_a_lock(self):
        parent = self.home / "baci-workers"
        parent.chmod(0o777)
        try:
            run = self.start()
            stdout, stderr = run.communicate(timeout=10)
            self.assertEqual(run.returncode, 0, stderr)
            self.assertEqual(stdout.strip(), "uncached")
            self.assertFalse((parent / "gigl-tracking-token-cache").exists())
        finally:
            parent.chmod(0o700)


if __name__ == "__main__":
    unittest.main()
