import os
from pathlib import Path
import stat
import subprocess
import sys
import time

from worker_release_descriptor_cgroup import CgroupProofRejected, require_empty_cgroup
import worker_release_descriptor_cgroup as cgroup_module


def _dedicated_child(uid, gid, marker, *, sleep_seconds=1, spawn_descendant=False):
    def drop_identity():
        if os.geteuid() == 0:
            os.setgroups([])
            os.setgid(gid)
            os.setuid(uid)
        elif (os.getuid(), os.getgid()) != (uid, gid):
            raise RuntimeError("non-root test runner cannot switch child identity")

    child_env = os.environ.copy()
    child_env["FREEZE_TEST_MARKER"] = str(marker) if marker else ""
    child_env["FREEZE_TEST_SLEEP"] = str(sleep_seconds)
    child_env["FREEZE_TEST_DESCENDANT"] = "1" if spawn_descendant else "0"
    return subprocess.Popen(
        [sys.executable, "-c",
         "import os,pathlib,subprocess,sys,time; sys.stdin.readline(); "
         "pathlib.Path(os.environ['FREEZE_TEST_MARKER']).write_text('archive entry') "
         "if os.environ['FREEZE_TEST_MARKER'] else None; "
         "subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']) "
         "if os.environ['FREEZE_TEST_DESCENDANT']=='1' else None; "
         "print('READY',flush=True); "
         "time.sleep(float(os.environ['FREEZE_TEST_SLEEP']))"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        preexec_fn=drop_identity, env=child_env,
    )


def _open_test_cgroup(test):
    raw = os.environ.get("WORKER_RELEASE_TEST_CGROUP_PATH", "")
    requested = Path(raw)
    if (requested.parent != Path("/sys/fs/cgroup")
            or not requested.name.startswith("worker-release-test-")
            or not requested.name.replace("-", "").isalnum()):
        test.skipTest("cgroup path is not a designated disposable test cgroup")
    root_fd = _open_directory_path_nofollow(Path("/sys/fs/cgroup"))
    try:
        fd = _open_child_directory_nofollow(root_fd, requested.name)
        try:
            cgroup_module._require_cgroup2_fd(fd, os.fstat(fd).st_dev, os.fstat(fd).st_ino)
        except Exception:
            os.close(fd)
            raise
        return fd, os.fstat(fd)
    finally:
        os.close(root_fd)



def _open_directory_path_nofollow(path):
    if not path.is_absolute():
        raise OSError("directory path must be absolute")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for component in path.parts[1:]:
            child = _open_child_directory_nofollow(fd, component)
            os.close(fd)
            fd = child
        result, fd = fd, -1
        return result
    finally:
        if fd >= 0:
            os.close(fd)


def _open_child_directory_nofollow(parent_fd, name):
    if name in ("", ".", "..") or "/" in name or "\\" in name:
        raise OSError("unsafe directory component")
    before = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    if not stat.S_ISDIR(before.st_mode):
        raise OSError("path component is not a real directory")
    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
    opened = os.fstat(fd)
    if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
        os.close(fd)
        raise OSError("directory path component changed during open")
    return fd


def _move_to_test_cgroup(test, cgroup_fd, process):
    try:
        fd = os.open("cgroup.procs", os.O_WRONLY | os.O_NOFOLLOW, dir_fd=cgroup_fd)
        try:
            os.write(fd, f"{process.pid}\n".encode("ascii"))
        finally:
            os.close(fd)
        assert process.stdin is not None
        process.stdin.write(b"go\n")
        process.stdin.flush()
        assert process.stdout is not None
        if process.stdout.readline() != b"READY\n":
            test.fail("dedicated child did not reach its ready state")
    except OSError as exc:
        if process.poll() is None:
            process.kill()
            process.wait()
        test.skipTest(f"designated cgroup fixture is not writable: {type(exc).__name__}")


def _kill_cgroup_and_wait_empty(test, cgroup_fd, cgroup_info):
    try:
        kill_fd = os.open("cgroup.kill", os.O_WRONLY | os.O_NOFOLLOW, dir_fd=cgroup_fd)
        try:
            os.write(kill_fd, b"1")
        finally:
            os.close(kill_fd)
        deadline = __import__("time").monotonic() + 5
        while __import__("time").monotonic() < deadline:
            try:
                require_empty_cgroup(cgroup_fd, cgroup_info.st_dev, cgroup_info.st_ino)
                return
            except CgroupProofRejected:
                __import__("time").sleep(0.05)
        test.fail("test cgroup did not drain after cgroup.kill")
    except OSError as exc:
        test.fail(f"test cgroup cleanup failed: {type(exc).__name__}")

