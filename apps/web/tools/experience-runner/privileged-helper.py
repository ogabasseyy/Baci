#!/usr/bin/python3 -I
"""Fixed runner policy. No caller-provided OCI specification is accepted."""

import json
import os
import re
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


def prepare_job(jobs_fd, kind, name):
    if kind not in JOBS or not re.fullmatch(
        r"baci-experience-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
        name,
    ):
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


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "policy" or sys.argv[2] not in JOBS:
        sys.exit(2)
    print(json.dumps(policy(sys.argv[2])))
