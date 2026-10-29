"""Secretless systemd execution boundary for dependency candidate builds."""
from __future__ import annotations

import os
import json
import shutil
import stat
import subprocess
import time
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected, copy_source_tree, validate_payload, verify_runtime_candidates
from worker_release_dependency_fs import directory_usage, write_smoke_evidence
from worker_release_dependency_policy_cache import RECEIPT_NAME, TRUSTED_REGISTRY, validate_receipt
from worker_release_dependency_diagnostics import has_policy_pass_marker

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


def remove_workspace_self_link(web_output: Path, working: Path) -> None:
    """Remove pnpm's synthetic package self-link after proving its exact target."""
    try:
        output_info = web_output.lstat()
    except FileNotFoundError:
        return
    if web_output.is_symlink() or not stat.S_ISDIR(output_info.st_mode):
        raise BuilderRejected("web deploy output is not a real directory")
    parent_fd = os.open(web_output, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
    opened = [parent_fd]
    relative_parent = web_output.resolve(strict=True)
    try:
        for component in ("node_modules", ".pnpm", "node_modules", "@baci"):
            try:
                child_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
                                   dir_fd=opened[-1])
            except FileNotFoundError:
                return
            except OSError as exc:
                raise BuilderRejected("web deploy workspace self-link parent is unsafe") from exc
            opened.append(child_fd)
            relative_parent /= component
        try:
            info = os.stat("web", dir_fd=opened[-1], follow_symlinks=False)
        except FileNotFoundError:
            return
        if not stat.S_ISLNK(info.st_mode):
            raise BuilderRejected("web deploy workspace self-link has an unexpected inode type")
        target = os.readlink("web", dir_fd=opened[-1])
        if not target or os.path.isabs(target) or "\\" in target or len(target.encode("utf-8")) > 1024:
            raise BuilderRejected("web deploy workspace self-link target is non-portable")
        try:
            resolved = (relative_parent / target).resolve(strict=True)
            expected = (working / "apps" / "web").resolve(strict=True)
        except (OSError, RuntimeError) as exc:
            raise BuilderRejected("web deploy workspace self-link is broken or cyclic") from exc
        if resolved != expected or not resolved.is_dir():
            raise BuilderRejected("web deploy workspace self-link has an unexpected target")
        workspace_fds: list[int] = []
        manifest_fd = -1
        try:
            workspace_fd = os.open(working, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
            workspace_fds.append(workspace_fd)
            apps_fd = os.open("apps", os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
                              dir_fd=workspace_fds[-1])
            workspace_fds.append(apps_fd)
            package_dir_fd = os.open("web", os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
                                     dir_fd=workspace_fds[-1])
            workspace_fds.append(package_dir_fd)
            manifest_fd = os.open("package.json", os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
                                  dir_fd=package_dir_fd)
            manifest_before = os.fstat(manifest_fd)
            if (not stat.S_ISREG(manifest_before.st_mode) or manifest_before.st_nlink != 1
                    or manifest_before.st_size > 1024 * 1024):
                raise BuilderRejected("web deploy workspace self-link package metadata is unsafe")
            chunks = []
            total = 0
            while chunk := os.read(manifest_fd, min(16_384, 1024 * 1024 + 1 - total)):
                total += len(chunk)
                if total > 1024 * 1024:
                    raise BuilderRejected("web deploy workspace self-link package metadata exceeds size limit")
                chunks.append(chunk)
            manifest_after = os.fstat(manifest_fd)
            stable_before = (manifest_before.st_dev, manifest_before.st_ino, manifest_before.st_size,
                             manifest_before.st_mtime_ns, manifest_before.st_ctime_ns)
            stable_after = (manifest_after.st_dev, manifest_after.st_ino, manifest_after.st_size,
                            manifest_after.st_mtime_ns, manifest_after.st_ctime_ns)
            if stable_before != stable_after or total != manifest_before.st_size:
                raise BuilderRejected("web deploy workspace self-link package metadata changed while reading")
            package = json.loads(b"".join(chunks).decode("utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise BuilderRejected("web deploy workspace self-link package metadata is unavailable") from exc
        finally:
            if manifest_fd >= 0:
                os.close(manifest_fd)
            for fd in reversed(workspace_fds):
                os.close(fd)
        if not isinstance(package, dict) or package.get("name") != "@baci/web":
            raise BuilderRejected("web deploy workspace self-link package identity is unexpected")
        os.unlink("web", dir_fd=opened[-1])
    finally:
        for fd in reversed(opened):
            os.close(fd)


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
        ("PNPM_CONFIG_PACKAGE_IMPORT_METHOD", "copy"),
        ("PNPM_CONFIG_FROZEN_LOCKFILE", "true"), ("PNPM_CONFIG_STORE_DIR", str(scratch / "pnpm-store")),
        ("PNPM_CONFIG_CACHE_DIR", str(scratch / "pnpm-cache")),
        ("PNPM_CONFIG_TRUST_LOCKFILE", "false"), ("PNPM_CONFIG_OFFLINE", "true"),
        ("PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES", "true"),
        ("PNPM_CONFIG_REGISTRY", TRUSTED_REGISTRY), ("npm_config_registry", TRUSTED_REGISTRY),
        ("npm_config_userconfig", "/dev/null"),
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
    private_cache = scratch / "pnpm-cache"
    try:
        cache_info = private_cache.lstat()
    except OSError as exc:
        raise BuilderRejected("per-build offline pnpm policy cache is unavailable") from exc
    if (not stat.S_ISDIR(cache_info.st_mode) or cache_info.st_uid != os.geteuid()
            or cache_info.st_gid != os.getgid() or cache_info.st_mode & 0o077):
        raise BuilderRejected("per-build offline pnpm policy cache ownership or mode is unsafe")
    working = scratch / "source"
    copy_source_tree(source, working)
    (scratch / "home").mkdir(mode=0o700, exist_ok=True)
    web_output = scratch / "payload" / "web"
    web_output.parent.mkdir(mode=0o700, exist_ok=True)
    version = subprocess.run((PNPM, "--version"), cwd=working, check=True, capture_output=True, text=True, timeout=15).stdout.strip()
    if version != EXPECTED_PNPM:
        raise BuilderRejected("installed pnpm version does not match repository pin")
    validate_receipt(working, private_cache, private_store / RECEIPT_NAME, version, expected_sha=expected_sha)
    web_install = subprocess.run((PNPM, "--registry", TRUSTED_REGISTRY, "--package-import-method=copy",
                                  "--filter", "@baci/web...", "install", "--prod", "--frozen-lockfile",
                                  "--ignore-scripts", "--ignore-pnpmfile", "--offline",
                                  "--store-dir", str(private_store)), cwd=working, check=True,
                                 capture_output=True, text=True, timeout=240)
    if not has_policy_pass_marker(web_install.stdout, web_install.stderr):
        raise BuilderRejected("web offline install did not verify lockfile supply-chain policy")
    subprocess.run((PNPM, "--registry", TRUSTED_REGISTRY, "--package-import-method=copy", "--filter", "@baci/web", "--prod", "deploy", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile", "--offline", "--store-dir", str(private_store), str(web_output)), cwd=working, check=True, capture_output=True, text=True, timeout=240)
    remove_workspace_self_link(web_output, working)
    workers_root = working / "vps-workers"
    worker_policy = subprocess.run((PNPM, "--registry", TRUSTED_REGISTRY, "--package-import-method=copy", "install", "--prod", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile", "--offline", "--store-dir", str(private_store)), cwd=workers_root, check=True, capture_output=True, text=True, timeout=240)
    if not has_policy_pass_marker(worker_policy.stdout, worker_policy.stderr):
        raise BuilderRejected("worker offline install did not verify lockfile supply-chain policy")
    validate_receipt(working, private_cache, private_store / RECEIPT_NAME, version,
                     expected_sha=expected_sha)
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


def run_sandbox(command: tuple[str, ...], scratch: Path, unit: str, *, usage_root: Path | None = None) -> None:
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env={"PATH": "/usr/bin:/bin"})
    deadline = time.monotonic() + MAX_BUILD_SECONDS + 15
    try:
        while process.poll() is None:
            directory_usage(usage_root or scratch, max_entries=MAX_ENTRIES, max_bytes=MAX_BUILD_SCRATCH_BYTES)
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
