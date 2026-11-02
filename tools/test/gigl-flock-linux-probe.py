"""Isolated Linux flock capability probe; no production access or secrets."""
import fcntl
import os
import subprocess
import sys
import tempfile
import unittest


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

    def test_worker_guard_accepts_only_the_expected_held_lock(self):
        self.path = os.path.join(self.directory.name, "cache.lock")
        with open(self.path, "w+") as lock:
            os.chmod(self.path, 0o600)
            script = """import { hasVerifiedGiglCacheLock } from '/work/lock-check.ts';
const [dir, fd, expected] = process.argv.slice(1);
if (hasVerifiedGiglCacheLock(dir, Number(fd)) !== (expected === 'true')) process.exit(1);"""
            command = ["node", "--conditions", "react-server", "--input-type=module", "-e", script, self.directory.name, str(lock.fileno())]
            subprocess.run(command + ["false"], pass_fds=(lock.fileno(),), check=True)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            lock.write(f"{os.getpid()}\n")
            lock.flush()
            subprocess.run(command + ["false"], pass_fds=(lock.fileno(),), check=True)
            os.chmod(self.path, 0o644)
            subprocess.run(command + ["false"], pass_fds=(lock.fileno(),), check=True)
            os.chmod(self.path, 0o600)
            os.rename(self.path, self.path + ".old")
            with open(self.path, "w"):
                pass
            os.chmod(self.path, 0o600)
            subprocess.run(command + ["false"], pass_fds=(lock.fileno(),), check=True)

    def test_two_workers_cannot_claim_same_inherited_lock(self):
        self.path = os.path.join(self.directory.name, "cache.lock")
        with open(self.path, "w+") as lock:
            os.chmod(self.path, 0o600)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            lock.write(f"{os.getpid()}\n")
            lock.flush()
            script = """import { hasVerifiedGiglCacheLock } from '/work/lock-check.ts';
const [dir, fd] = process.argv.slice(1);
console.log(hasVerifiedGiglCacheLock(dir, Number(fd)) ? 'accepted' : 'rejected');"""
            command = ["node", "--input-type=module", "-e", script, self.directory.name, str(lock.fileno())]
            workers = [subprocess.Popen(command, stdout=subprocess.PIPE, text=True, pass_fds=(lock.fileno(),)) for _ in range(2)]
            results = [worker.communicate(timeout=30)[0].strip() for worker in workers]
            self.assertLessEqual(results.count("accepted"), 1, results)

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
            subprocess.run([sys.executable, "-c", child_script, self.path, self.directory.name, scenario], check=True)

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
        subprocess.run([sys.executable, "-c", child_script, self.path, self.directory.name], check=True)


if __name__ == "__main__":
    unittest.main()
