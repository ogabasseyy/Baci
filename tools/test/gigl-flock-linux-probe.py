"""Isolated Linux flock capability probe; no production access or secrets."""
import fcntl
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

LOCK_MODULE = (Path(__file__).resolve().parents[2] / 'apps/web/src/lib/shipping/providers/gigl-cache-lock-verification.ts').as_uri()


class LinuxFlockProbe(unittest.TestCase):
    def setUp(self):
        if not sys.platform.startswith("linux"):
            self.skipTest("Linux /proc is required")
        self.directory = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.directory.name, "worker.lock")

    def tearDown(self):
        if hasattr(self, "directory"):
            self.directory.cleanup()

    def test_inherited_node_descriptor_exposes_lock_and_survives_other_close(self):
        with open(self.path, "w+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with open(self.path, "r"):
                pass
            script = """const fs=require('node:fs');
const fd=Number(process.argv[1]);
if (!fs.fstatSync(fd).isFile() || !/FLOCK\\s+ADVISORY\\s+WRITE/.test(fs.readFileSync('/proc/self/fdinfo/'+fd,'utf8'))) process.exit(1);"""
            subprocess.run(["node", "-e", script, str(lock.fileno())], pass_fds=(lock.fileno(),), check=True)
            with open(self.path, "r") as other:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_crash_releases_lock(self):
        script = """import fcntl,sys,time
f=open(sys.argv[1],'w+')
fcntl.flock(f,fcntl.LOCK_EX | fcntl.LOCK_NB)
print('ready',flush=True)
time.sleep(60)
"""
        holder = subprocess.Popen([sys.executable, "-c", script, self.path], stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(holder.stdout.readline().strip(), "ready")
            with open(self.path, "r") as other:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
                holder.kill()
                holder.wait(timeout=10)
                fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            if holder.poll() is None:
                holder.kill()
                holder.wait(timeout=10)
            if holder.stdout:
                holder.stdout.close()

    def test_node_typescript_loader_retains_locked_descriptor(self):
        with open(self.path, "w+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            script = """const fs=require('node:fs');
const fd=Number(process.argv[1]);
if (!fs.fstatSync(fd).isFile() || !/FLOCK\\s+ADVISORY\\s+WRITE/.test(fs.readFileSync('/proc/self/fdinfo/'+fd,'utf8'))) process.exit(1);"""
            subprocess.run(["node", "--import", "tsx", "-e", script, str(lock.fileno())], pass_fds=(lock.fileno(),), check=True)

    def test_shell_environment_filter_and_loader_retain_descriptor(self):
        with open(self.path, "w+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            node_script = """const fs=require('node:fs');const fd=Number(process.argv[1]);
if (!fs.fstatSync(fd).isFile() || !/FLOCK\\s+ADVISORY\\s+WRITE/.test(fs.readFileSync('/proc/self/fdinfo/'+fd,'utf8'))) process.exit(1);"""
            inner = 'node --import tsx -e "$1" "$2"'
            subprocess.run(["env", "-i", "PATH=" + os.environ["PATH"], "bash", "-c", inner, "probe", node_script, str(lock.fileno())], pass_fds=(lock.fileno(),), check=True)

    def test_two_workers_cannot_claim_same_inherited_lock(self):
        self.path = os.path.join(self.directory.name, "cache.lock")
        child_script = '''import fcntl,os,sys
path,directory=sys.argv[1:]
fd=os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
os.write(fd, (str(os.getpid()) + '\\n').encode())
os.set_inheritable(fd, True)
script="""import { hasVerifiedGiglCacheLock } from '/work/lock-check.ts';
import { spawnSync } from 'node:child_process';
const [dir,fdString] = process.argv.slice(1); const fd=Number(fdString);
if (!hasVerifiedGiglCacheLock(dir,fd)) throw new Error('owner rejected');
const childCode = \"import { hasVerifiedGiglCacheLock } from '/work/lock-check.ts'; if (hasVerifiedGiglCacheLock(process.argv[1], 3)) process.exit(1);\";
const child=spawnSync(process.execPath,['--input-type=module','-e',childCode,dir],{stdio:['ignore','pipe','inherit',fd]});
if (child.status !== 0) throw new Error('competing worker accepted or failed');"""
os.execvp('node',['node','--input-type=module','-e',script,directory,str(fd)])
'''
        subprocess.run([sys.executable, "-c", child_script.replace('/work/lock-check.ts', LOCK_MODULE), self.path, self.directory.name], check=True)

    def test_guard_accepts_owner_after_exec(self):
        self.path = os.path.join(self.directory.name, "cache.lock")
        child_script = """import fcntl,os,sys
path, directory, scenario=sys.argv[1:]
fd=os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
os.write(fd, (str(os.getpid()) + '\\n').encode())
os.set_inheritable(fd, True)
if scenario == 'unsafe': os.chmod(path, 0o644)
if scenario == 'replaced':
 os.rename(path, path + '.old')
 newfd=os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
 os.close(newfd)
if scenario == 'unlocked': fcntl.flock(fd, fcntl.LOCK_UN)
script=\"import { hasVerifiedGiglCacheLock } from '/work/lock-check.ts'; const [dir,fd,want]=process.argv.slice(1); if (hasVerifiedGiglCacheLock(dir,Number(fd)) !== (want === 'true')) process.exit(1);\"
os.execvp('node',['node','--input-type=module','-e',script,directory,str(fd),str(scenario == 'valid').lower()])
"""
        for scenario in ("valid", "unsafe", "replaced", "unlocked"):
            for path in (self.path, self.path + ".old"):
                if os.path.exists(path):
                    os.unlink(path)
            subprocess.run([sys.executable, "-c", child_script.replace('/work/lock-check.ts', LOCK_MODULE), self.path, self.directory.name, scenario], check=True)

    def test_worker_thread_cannot_claim_main_threads_lock(self):
        self.path = os.path.join(self.directory.name, "cache.lock")
        child_script = """import fcntl,os,sys
path, directory=sys.argv[1:]
fd=os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
os.write(fd, (str(os.getpid()) + '\\n').encode())
os.set_inheritable(fd, True)
script=\"const {Worker}=require('node:worker_threads');const [dir,fd]=process.argv.slice(1);const code=\\\"const {parentPort,workerData}=require('node:worker_threads');import('/work/lock-check.ts').then(m=>parentPort.postMessage(m.hasVerifiedGiglCacheLock(workerData.dir,workerData.fd)))\\\";const w=new Worker(code,{eval:true,workerData:{dir,fd:Number(fd)}});w.on('message',accepted=>{if(accepted)process.exitCode=1});w.on('error',()=>process.exitCode=1);\"
os.execvp('node',['node','-e',script,directory,str(fd)])
"""
        subprocess.run([sys.executable, "-c", child_script.replace('/work/lock-check.ts', LOCK_MODULE), self.path, self.directory.name], check=True)


if __name__ == "__main__":
    unittest.main()
