"""Secretless systemd execution boundary for dependency candidate builds."""
from __future__ import annotations

import os
import shutil
import subprocess
import time
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected, copy_source_tree, validate_payload, verify_runtime_candidates
from worker_release_dependency_fs import directory_usage, write_smoke_evidence

SYSTEMD_RUN = "/usr/bin/systemd-run"
SYSTEMCTL = "/usr/bin/systemctl"
PYTHON = "/usr/bin/python3"
PNPM = "/usr/bin/pnpm"
EXPECTED_PNPM = "11.7.0"
WORKER_RUNTIME = Path("/srv/baci-workers/runtime")
WORKER_RELEASES = Path("/srv/baci-workers/releases")
WORKER_LOCKS = Path("/srv/baci-workers/locks")
MAX_BUILD_SECONDS = 300
MAX_BUILD_SCRATCH_BYTES = 1536 * 1024 * 1024
MAX_ENTRIES = 200_000


def systemd_command(source: Path, scratch: Path, expected_sha: str, uid: int, gid: int, unit: str) -> tuple[str, ...]:
    properties = (
        "ProtectSystem=strict", "ProtectHome=true", "PrivateTmp=true", "PrivateDevices=true",
        "NoNewPrivileges=true", "PrivateUsers=true", "RestrictSUIDSGID=true", "LockPersonality=true",
        "UMask=0077", "KillMode=control-group", f"RuntimeMaxSec={MAX_BUILD_SECONDS}s",
        "MemoryMax=2G", "CPUQuota=200%", "TasksMax=128", "LimitFSIZE=1073741824", "LimitNOFILE=4096",
        f"ReadOnlyPaths={source}", f"ReadWritePaths={scratch}",
        f"InaccessiblePaths={WORKER_RUNTIME} {WORKER_RELEASES} {WORKER_LOCKS}",
        "PrivateNetwork=true", "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
    )
    args = [SYSTEMD_RUN, "--system", "--wait", "--pipe", "--collect", f"--unit={unit}", f"--uid={uid}", f"--gid={gid}"]
    for prop in properties:
        args.extend(("--property", prop))
    for key, value in (
        ("HOME", str(scratch / "home")), ("PATH", "/usr/bin:/bin"), ("CI", "true"),
        ("NODE_ENV", "production"), ("PNPM_CONFIG_IGNORE_SCRIPTS", "true"),
        ("PNPM_CONFIG_FROZEN_LOCKFILE", "true"), ("PNPM_CONFIG_STORE_DIR", str(scratch / "pnpm-store")),
        ("PNPM_CONFIG_OFFLINE", "true"), ("npm_config_userconfig", "/dev/null"),
        ("npm_config_globalconfig", "/dev/null"),
    ):
        args.append(f"--setenv={key}={value}")
    entrypoint = Path(__file__).with_name("worker_release_dependency_builder.py")
    args.extend((PYTHON, str(entrypoint), "--sandbox-worker", str(source), str(scratch), expected_sha))
    return tuple(args)


def run_sandbox_worker(source: Path, scratch: Path, expected_sha: str) -> int:
    if os.geteuid() == 0 or os.environ.get("HOME") != str(scratch / "home"):
        raise BuilderRejected("sandbox worker identity or environment is invalid")
    if source.is_symlink() or not source.is_dir():
        raise BuilderRejected("sandbox source is not a real directory")
    private_store = scratch / "pnpm-store"
    try:
        store_info = private_store.lstat()
    except OSError as exc:
        raise BuilderRejected("per-build offline pnpm store is unavailable") from exc
    if (not private_store.is_dir() or private_store.is_symlink()
            or store_info.st_uid != os.geteuid() or store_info.st_gid != os.getgid()
            or store_info.st_mode & 0o077):
        raise BuilderRejected("per-build offline pnpm store ownership or mode is unsafe")
    working = scratch / "source"
    copy_source_tree(source, working)
    (scratch / "home").mkdir(mode=0o700, exist_ok=True)
    web_output = scratch / "payload" / "web"
    web_output.parent.mkdir(mode=0o700, exist_ok=True)
    version = subprocess.run((PNPM, "--version"), cwd=working, check=True, capture_output=True, text=True, timeout=15).stdout.strip()
    if version != EXPECTED_PNPM:
        raise BuilderRejected("installed pnpm version does not match repository pin")
    subprocess.run((PNPM, "--filter", "@baci/web", "--prod", "deploy", "--legacy", "--ignore-scripts", "--offline", "--store-dir", str(private_store), str(web_output)), cwd=working, check=True, timeout=240)
    workers_root = working / "vps-workers"
    subprocess.run((PNPM, "install", "--prod", "--frozen-lockfile", "--ignore-scripts", "--offline", "--store-dir", str(private_store)), cwd=workers_root, check=True, timeout=240)
    installed = workers_root / "node_modules"
    if not installed.is_dir() or installed.is_symlink():
        raise BuilderRejected("worker dependency install did not produce a real node_modules directory")
    root_node_modules = scratch / "payload" / "root" / "node_modules"
    root_node_modules.parent.mkdir(mode=0o700, parents=True)
    shutil.copytree(installed, root_node_modules, symlinks=True)
    validate_payload(scratch / "payload")
    evidence = verify_runtime_candidates(scratch / "payload")
    write_smoke_evidence(scratch, evidence)
    return 0


def stop_unit(unit: str) -> None:
    subprocess.run((SYSTEMCTL, "kill", "--kill-whom=all", "--signal=SIGKILL", unit), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
    subprocess.run((SYSTEMCTL, "stop", unit), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)


def run_sandbox(command: tuple[str, ...], scratch: Path, unit: str) -> None:
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env={"PATH": "/usr/bin:/bin"})
    deadline = time.monotonic() + MAX_BUILD_SECONDS + 15
    try:
        while process.poll() is None:
            directory_usage(scratch, max_entries=MAX_ENTRIES, max_bytes=MAX_BUILD_SCRATCH_BYTES)
            if time.monotonic() >= deadline:
                stop_unit(unit)
                raise BuilderRejected("dependency build exceeded its wall-clock limit")
            time.sleep(0.25)
        if process.returncode != 0:
            raise subprocess.CalledProcessError(process.returncode, command)
    except BuilderRejected:
        stop_unit(unit)
        raise
    finally:
        if process.poll() is None:
            stop_unit(unit)
            process.wait(timeout=15)
