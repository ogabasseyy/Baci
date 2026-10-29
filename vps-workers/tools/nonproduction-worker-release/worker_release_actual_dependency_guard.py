"""Polling resource checks and process-group cleanup for disposable CI builds."""
from __future__ import annotations

import os
import json
import re
import signal
import stat
import subprocess
import time
from pathlib import Path

MAX_TREE_BYTES = 12 * 1024 * 1024 * 1024
MAX_TREE_ENTRIES = 500_000
MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024
MIN_FREE_INODES = 20_000
SCAN_RETRIES = 3
SCAN_RETRY_SECONDS = 0.1
POLL_SECONDS = 1.0
STAGES = frozenset({
    "checkout-identity", "runtime-pin", "pnpm-pin", "resource-preflight", "source-archive",
    "source-extraction", "source-tree-validation", "policy-preverify", "offline-store-validation",
    "source-lock-validation", "web-deploy", "deploy-graph-validation", "workspace-self-link-cleanup",
    "worker-install", "receipt-validation", "payload-validation", "payload-materialization",
    "independent-smoke", "materialized-tree-validation", "resource-scan", "experiment",
})


class _TransientEntryRace(Exception):
    pass


class MonitorFailure(RuntimeError):
    def __init__(self, stage: str, category: str, exit_code: int | None = None):
        self.stage = stage if stage in STAGES else "experiment"
        self.category = category
        self.exit_code = exit_code
        super().__init__(self.stage)


def failure_diagnostic(stage: str, error: BaseException) -> str:
    """Render fixed diagnostics only; never include exception or command text."""
    if isinstance(error, MonitorFailure):
        stage, category, exit_code = error.stage, error.category, error.exit_code
    else:
        stage = stage if stage in STAGES else "experiment"
        exit_code = None
        if isinstance(error, subprocess.CalledProcessError):
            category, exit_code = "subprocess-exit", error.returncode
        elif isinstance(error, subprocess.TimeoutExpired):
            category = "subprocess-timeout"
        elif isinstance(error, OSError):
            category = "filesystem-error"
        elif isinstance(error, (ValueError, TypeError)):
            category = "invalid-result"
        elif isinstance(error, RuntimeError):
            message = str(error)
            categories = (
                ("launcher is unavailable", "runtime-unavailable"),
                ("could not identify exactly one", "runtime-pin-invalid"),
                ("installation exceeds entry bound", "runtime-entry-bound"),
                ("expected checkout SHA is invalid", "input-invalid"),
                ("does not match dispatched SHA", "checkout-mismatch"),
                ("Node 24 runtime is unavailable", "runtime-unavailable"),
                ("exceeds configured", "configured-bound"),
                ("unsafe entry", "filesystem-entry-invalid"),
                ("shared file inode", "filesystem-entry-invalid"),
                ("unavailable", "expected-output-missing"),
                ("disk cap", "disk-cap"),
                ("free-space reserve", "free-space-reserve"),
                ("free-inode reserve", "free-inode-reserve"),
                ("entry cap", "entry-cap"),
                ("tree changed repeatedly", "transient-tree-churn"),
                ("differs from exact source lock", "lock-graph-drift"),
                ("source lock does not pin", "lock-graph-invalid"),
                ("measured tree exceeds", "tree-size-bound"),
                ("did not produce", "expected-output-missing"),
                ("receipt", "policy-receipt"),
                ("timed out", "deadline"),
            )
            category = next((label for marker, label in categories if marker in message), "runtime-error")
        else:
            category = "operation-error"
    suffix = f" exit={exit_code}" if isinstance(exit_code, int) else ""
    return f"experiment failure stage={stage} category={category}{suffix}"


def assert_deployed_package_matches_lock(deploy_root: Path, lockfile: Path, package_name: str) -> str:
    """Check the known semver-drift package in deployed output against source lock."""
    lock_info = lockfile.lstat()
    if not stat.S_ISREG(lock_info.st_mode) or lock_info.st_nlink != 1 or lock_info.st_size > 64 * 1024 * 1024:
        raise RuntimeError("source lock for deploy-graph check is unsafe")
    text = lockfile.read_text(encoding="utf-8")
    version_pattern = re.compile(
        rf"(?m)^  ['\"]?{re.escape(package_name)}@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)(?:\([^)]*\))?['\"]?:\s*$"
    )
    locked_versions = set(version_pattern.findall(text))
    if len(locked_versions) != 1:
        raise RuntimeError("source lock does not pin one version of the deploy-graph check package")
    package_path = deploy_root / "node_modules" / package_name / "package.json"
    try:
        manifest_path = package_path.resolve(strict=True)
        manifest_path.relative_to(deploy_root.resolve(strict=True))
        info = manifest_path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 1024 * 1024:
            raise RuntimeError("deployed package manifest is unsafe")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError("deployed lock-graph package manifest is unavailable") from exc
    if not isinstance(manifest, dict) or manifest.get("name") != package_name:
        raise RuntimeError("deployed lock-graph package identity is unexpected")
    version = manifest.get("version")
    if not isinstance(version, str) or version not in locked_versions:
        raise RuntimeError("deployed package version differs from exact source lock")
    return version


def web_deploy_command(node: str, pnpm: str, store: Path, target: Path, registry: str) -> tuple[str, ...]:
    return (node, pnpm, "--registry", registry, "--package-import-method=copy",
            "--filter", "@baci/web", "--prod", "deploy", "--frozen-lockfile",
            "--ignore-scripts", "--ignore-pnpmfile", "--offline", "--store-dir", str(store), str(target))


def enforce_resource_limits(root: Path, *, max_bytes: int = MAX_TREE_BYTES,
                             max_entries: int = MAX_TREE_ENTRIES,
                             min_free_bytes: int = MIN_FREE_BYTES,
                             min_free_inodes: int = MIN_FREE_INODES) -> tuple[int, int]:
    root_info = root.lstat()
    if not stat.S_ISDIR(root_info.st_mode) or root.is_symlink():
        raise RuntimeError("experiment resource root is unsafe")

    def on_walk_error(error: OSError) -> None:
        if isinstance(error, FileNotFoundError):
            raise _TransientEntryRace() from error
        raise error

    for attempt in range(SCAN_RETRIES):
        count = total = 0
        try:
            for current, directories, files in os.walk(root, topdown=True, followlinks=False,
                                                       onerror=on_walk_error):
                current_path = Path(current)
                for name in directories + files:
                    path = current_path / name
                    try:
                        info = path.lstat()
                    except FileNotFoundError as exc:
                        raise _TransientEntryRace() from exc
                    count += 1
                    if count > max_entries:
                        raise RuntimeError("experiment resource entry cap exceeded")
                    if stat.S_ISREG(info.st_mode):
                        total += info.st_size
                        if total > max_bytes:
                            raise RuntimeError("experiment disk cap exceeded")
                    elif not (stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode)):
                        raise RuntimeError("experiment contains an unsupported filesystem entry")
                directories[:] = [name for name in directories if not (current_path / name).is_symlink()]
            break
        except _TransientEntryRace as exc:
            if attempt + 1 == SCAN_RETRIES:
                raise RuntimeError("experiment tree changed repeatedly during resource scan") from exc
            time.sleep(SCAN_RETRY_SECONDS * (attempt + 1))
    space = os.statvfs(root)
    free_bytes = space.f_bavail * space.f_frsize
    free_inodes = space.f_favail
    if free_bytes < min_free_bytes:
        raise RuntimeError("experiment free-space reserve reached")
    if free_inodes < min_free_inodes:
        raise RuntimeError("experiment free-inode reserve reached")
    return count, total


def _signal_group(pgid: int, signum: int) -> None:
    try:
        os.killpg(pgid, signum)
    except ProcessLookupError:
        pass


def _terminate_group(process: subprocess.Popen) -> None:
    # The group is disposable CI work; a single SIGKILL avoids a grace-period
    # race where a vanished process-group id could be reused before escalation.
    _signal_group(process.pid, signal.SIGKILL)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass


def _resource_category(error: BaseException) -> str:
    message = str(error)
    categories = (
        ("disk cap", "disk-cap"),
        ("free-space reserve", "free-space-reserve"),
        ("free-inode reserve", "free-inode-reserve"),
        ("entry cap", "entry-cap"),
        ("tree changed repeatedly", "transient-tree-churn"),
        ("resource root", "resource-root-invalid"),
        ("unsupported filesystem", "filesystem-entry-invalid"),
    )
    return next((label for marker, label in categories if marker in message), "resource-scan-error")


def run_monitored(command: tuple[str, ...], *, cwd: Path, env: dict[str, str], timeout: int,
                  stage: str, resource_root: Path, poll_seconds: float = POLL_SECONDS) -> int:
    def check_resources() -> None:
        try:
            enforce_resource_limits(resource_root)
        except Exception as exc:
            raise MonitorFailure(stage, _resource_category(exc)) from exc

    check_resources()
    try:
        process = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   start_new_session=True)
    except OSError as exc:
        raise MonitorFailure(stage, "process-start") from exc
    deadline = time.monotonic() + timeout
    try:
        while True:
            returncode = process.poll()
            if returncode is not None:
                if returncode != 0:
                    raise MonitorFailure(stage, "process-exit", returncode)
                check_resources()
                return returncode
            if time.monotonic() >= deadline:
                raise MonitorFailure(stage, "deadline")
            check_resources()
            time.sleep(poll_seconds)
    except BaseException:
        _terminate_group(process)
        raise
    finally:
        if process.poll() is None:
            _terminate_group(process)
