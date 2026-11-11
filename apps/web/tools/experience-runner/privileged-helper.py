#!/usr/bin/python3 -I
"""Fixed runner policy. No caller-provided OCI specification is accepted."""

import json
import os
import re
import stat
import subprocess
import sys

ROOT = "/var/tmp/baci-experience-checkpoint-a"
JOBS = {
    "compile": ("node24", "compile-runtime.mjs", True),
    "prerender": ("node24", "prerender-worker.mjs", True),
    "prerender-build": ("node24", "prerender-build-worker.mjs", True),
    "capture": ("browser", "capture-worker.mjs", False),
    "performance": ("browser", "performance-worker.mjs", False),
    "checks": ("browser", "browser-checks.mjs", False),
    "prerender-checks": ("browser", "prerender-browser-worker.mjs", False),
    "prerender-private-checks": ("browser", "private-preview-browser-worker.mjs", False),
    "durable-public-checks": ("browser", "public-browser-worker.mjs", False),
}


def policy(kind):
    image, worker, build = JOBS[kind]
    memory = (2 if build else 3) * 1024 * 1024 * 1024
    env = ["PATH=/usr/local/bin:/usr/bin:/bin", "LANG=C.UTF-8", "TZ=UTC"]
    if not build:
        env.extend(["HOME=/tmp", "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright"])
    return {
        "ociVersion": "1.2.0",
        "root": {"path": f"{ROOT}/{image}/rootfs", "readonly": True},
        "hostname": "baci-experience-qualification",
        "process": {
            "terminal": False,
            "user": {"uid": 65532, "gid": 65532},
            "args": ["/usr/local/bin/node", f"/opt/experience/{worker}"],
            "env": env,
            "cwd": "/",
            "noNewPrivileges": True,
            "capabilities": {k: [] for k in ("bounding", "effective", "inheritable", "permitted", "ambient")},
            "rlimits": [{"type": "RLIMIT_NOFILE", "hard": 1024, "soft": 1024}],
        },
        "mounts": [
            {"destination": "/proc", "type": "proc", "source": "proc", "options": ["nosuid", "noexec", "nodev"]},
            {"destination": "/dev", "type": "tmpfs", "source": "tmpfs", "options": ["nosuid", "strictatime", "mode=755", "size=65536k"]},
            {"destination": "/dev/shm", "type": "tmpfs", "source": "shm", "options": ["nosuid", "noexec", "nodev", "mode=1777", "size=65536k"]},
            {"destination": "/tmp", "type": "tmpfs", "source": "tmpfs", "options": ["nosuid", "nodev", "mode=1777", "size=65536k"]},
        ],
        "linux": {
            "namespaces": [{"type": k} for k in ("pid", "network", "ipc", "uts", "mount")],
            "resources": {
                "memory": {"limit": memory, "swap": memory},
                "cpu": {"period": 100000, "quota": 100000 if build else 200000},
                "pids": {"limit": 128 if build else 256},
            },
            "maskedPaths": ["/proc/kcore", "/proc/keys", "/proc/timer_list"],
            "readonlyPaths": ["/proc/sys", "/proc/sysrq-trigger"],
        },
    }


def open_trusted_child(parent_fd, name, owner, allow_sticky=False):
    if not name or name in (".", "..") or "/" in name:
        raise ValueError("invalid path component")
    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
    try:
        metadata = os.fstat(fd)
        sticky = allow_sticky and bool(metadata.st_mode & stat.S_ISVTX)
        if metadata.st_uid != owner or (metadata.st_mode & 0o022 and not sticky):
            raise ValueError("untrusted directory")
        return fd
    except BaseException:
        os.close(fd)
        raise


def open_jobs():
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        root = os.fstat(fd)
        if root.st_uid != 0 or root.st_mode & 0o022:
            raise ValueError("untrusted root")
        for name in ("var", "tmp", "baci-experience-checkpoint-a", "jobs"):
            child = open_trusted_child(fd, name, 0, allow_sticky=(name == "tmp"))
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def verify_trusted_file(parent_fd, name, owner):
    if not name or name in (".", "..") or "/" in name:
        raise ValueError("invalid file")
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
    try:
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != owner or metadata.st_mode & 0o022 or metadata.st_nlink != 1:
            raise ValueError("untrusted file")
    finally:
        os.close(fd)


def verify_preflight_files():
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        root = os.fstat(fd)
        if root.st_uid != 0 or root.st_mode & 0o022:
            raise ValueError("untrusted root")
        for name in ("usr", "local", "libexec"):
            child = open_trusted_child(fd, name, 0)
            os.close(fd)
            fd = child
        verify_trusted_file(fd, "baci-experience-node", 0)
        verify_trusted_file(fd, "baci-experience-preflight.mjs", 0)
    finally:
        os.close(fd)


def run_preflight():
    verify_preflight_files()
    node = "/usr/local/libexec/baci-experience-node"
    os.execve(node, [node, "/usr/local/libexec/baci-experience-preflight.mjs"],
              {"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"})


def valid_name(name):
    return bool(re.fullmatch(
        r"baci-experience-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
        name,
    ))


def prepare_job(jobs_fd, kind, name):
    if kind not in JOBS or not valid_name(name):
        raise ValueError("invalid job")
    spec = policy(kind)
    spec["linux"]["cgroupsPath"] = "/baci-experience-checkpoint-a/" + name
    os.mkdir(name, 0o700, dir_fd=jobs_fd)
    job_fd = None
    try:
        job_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=jobs_fd)
        config_fd = os.open("config.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=job_fd)
        with os.fdopen(config_fd, "w", encoding="utf-8") as config:
            json.dump(spec, config, separators=(",", ":"))
    except BaseException:
        if job_fd is not None:
            try:
                os.unlink("config.json", dir_fd=job_fd)
            except FileNotFoundError:
                pass
        os.rmdir(name, dir_fd=jobs_fd)
        raise
    finally:
        if job_fd is not None:
            os.close(job_fd)


def verify_job(jobs_fd, name, owner):
    if not valid_name(name):
        raise ValueError("invalid job")
    job_fd = open_trusted_child(jobs_fd, name, owner)
    try:
        config_fd = os.open("config.json", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=job_fd)
        try:
            metadata = os.fstat(config_fd)
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != owner or metadata.st_mode & 0o077 or metadata.st_nlink != 1 or metadata.st_size > 65536:
                raise ValueError("untrusted job configuration")
            with os.fdopen(config_fd, "rb", closefd=False) as config:
                raw = config.read(65537)
            if len(raw) > 65536:
                raise ValueError("oversized job configuration")
            def unique(pairs):
                out = {}
                for key, value in pairs:
                    if key in out:
                        raise ValueError("duplicate key")
                    out[key] = value
                return out
            actual = json.loads(raw, object_pairs_hook=unique)
            normalized = json.dumps(actual, sort_keys=True, separators=(",", ":"))
            for kind in JOBS:
                expected = policy(kind)
                expected["linux"]["cgroupsPath"] = "/baci-experience-checkpoint-a/" + name
                if normalized == json.dumps(expected, sort_keys=True, separators=(",", ":")):
                    return
            raise ValueError("invalid job policy")
        finally:
            os.close(config_fd)
    finally:
        os.close(job_fd)


def execute_job(jobs_fd, name, owner):
    verify_job(jobs_fd, name, owner)
    program = "/usr/local/bin/runsc"
    os.execve(program, [
        program,
        "--root=" + ROOT + "/state",
        "--network=none",
        "run",
        "--bundle=" + ROOT + "/jobs/" + name,
        name,
    ], {"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"})


def delete_job(jobs_fd, name, owner):
    verify_job(jobs_fd, name, owner)
    subprocess.run([
        "/usr/local/bin/runsc", "--root=" + ROOT + "/state",
        "delete", "--force", name,
    ], check=True, timeout=10, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
       stderr=subprocess.DEVNULL, env={"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"})
    job_fd = open_trusted_child(jobs_fd, name, owner)
    try:
        os.unlink("config.json", dir_fd=job_fd)
    finally:
        os.close(job_fd)
    os.rmdir(name, dir_fd=jobs_fd)


def main(args):
    if os.geteuid() != 0:
        raise ValueError("invalid service identity")
    if args == ["preflight"]:
        run_preflight()
        return
    prepare = len(args) == 3 and args[0] == "prepare" and args[1] in JOBS and valid_name(args[2])
    run = len(args) == 2 and args[0] == "run" and valid_name(args[1])
    delete = len(args) == 2 and args[0] == "delete" and valid_name(args[1])
    if not (prepare or run or delete):
        raise ValueError("invalid operation")
    jobs_fd = open_jobs()
    try:
        if prepare:
            prepare_job(jobs_fd, args[1], args[2])
        elif run:
            execute_job(jobs_fd, args[1], 0)
        else:
            delete_job(jobs_fd, args[1], 0)
    finally:
        os.close(jobs_fd)


if __name__ == "__main__":
    try:
        if len(sys.argv) == 3 and sys.argv[1] == "policy" and sys.argv[2] in JOBS:
            print(json.dumps(policy(sys.argv[2])))
        else:
            main(sys.argv[1:])
    except (OSError, ValueError, subprocess.SubprocessError):
        sys.stderr.write("Runner helper failed.\n")
        sys.exit(1)
