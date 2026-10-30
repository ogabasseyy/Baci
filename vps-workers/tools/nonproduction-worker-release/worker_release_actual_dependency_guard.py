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
from typing import Callable
from worker_release_actual_dependency_resources import (
    MAX_TREE_ENTRIES,
    ResourceEntryLimitExceeded,
    enforce_resource_limits,
)
POLL_SECONDS = 1.0
STAGES = frozenset({
    "checkout-identity", "runtime-pin", "pnpm-pin", "resource-preflight", "source-archive",
    "source-extraction", "source-tree-validation", "policy-preverify", "offline-store-validation",
    "build-cache-snapshot",
    "source-lock-validation", "web-deploy", "deploy-graph-validation", "workspace-self-link-cleanup",
    "seed-move-measurement",
    "worker-install", "receipt-validation", "payload-hardlink-normalization", "payload-export",
    "payload-validation", "payload-materialization",
    "independent-smoke", "independent-smoke-tsx", "independent-smoke-dotenv",
    "independent-smoke-worker-sdk", "materialized-tree-validation", "resource-scan", "experiment",
    "preverify-web-install", "preverify-worker-install", "web-install",
})
RESOURCE_CHECKS = frozenset({"unsupported-filesystem-entry"})
TREE_CHECKS = frozenset({"unsafe-entry-or-entry-limit", "shared-file-inode"})
PAYLOAD_CHECKS = frozenset({
    "root-invalid", "path-invalid", "symlink-invalid", "symlink-escape",
    "entry-mode-invalid", "shared-file-inode", "external-hardlink", "special-file", "size-bound",
    "entry-bound", "entry-read-failed", "entry-changed",
})
PAYLOAD_REJECTIONS = {
    "payload root must be a real directory": ("root-invalid", "payload-invalid"),
    "dependency payload contains a non-portable path": ("path-invalid", "payload-invalid"),
    "dependency payload contains an unsafe path": ("path-invalid", "payload-invalid"),
    "dependency payload contains a non-portable symlink": ("symlink-invalid", "payload-invalid"),
    "dependency symlink escapes payload root": ("symlink-escape", "payload-invalid"),
    "dependency symlink is broken, cyclic, or escapes payload": ("symlink-invalid", "payload-invalid"),
    "dependency symlink target is not a regular file or directory": ("symlink-invalid", "payload-invalid"),
    "dependency payload directory has unsafe write or set-id bits": ("entry-mode-invalid", "payload-invalid"),
    "dependency payload file has unsafe write or set-id bits": ("entry-mode-invalid", "payload-invalid"),
    "dependency payload contains a shared hardlinked file": ("shared-file-inode", "payload-invalid"),
    "candidate contains hardlinks outside its payload": ("external-hardlink", "payload-invalid"),
    "dependency payload contains a special file": ("special-file", "payload-invalid"),
    "dependency payload exceeds size limit": ("size-bound", "payload-invalid"),
    "dependency payload has too many entries": ("entry-bound", "payload-invalid"),
}


class MonitorFailure(RuntimeError):
    def __init__(self, stage: str, category: str, exit_code: int | None = None,
                 evidence: dict[str, object] | None = None,
                 os_error: dict[str, object] | None = None,
                 entries_seen: int | None = None, entry_limit: int | None = None,
                 resource_check: str | None = None):
        self.stage = stage if stage in STAGES else "experiment"
        self.category = category
        self.exit_code = exit_code
        self.evidence = evidence
        self.os_error = os_error
        self.entries_seen = entries_seen
        self.entry_limit = entry_limit
        self.resource_check = resource_check if resource_check in RESOURCE_CHECKS else None
        super().__init__(self.stage)


def failure_diagnostic(stage: str, error: BaseException) -> str:
    """Lazy bridge keeps diagnostic policy separate from process/resource controls."""
    from worker_release_actual_dependency_failure import failure_diagnostic_impl

    return failure_diagnostic_impl(stage, error)


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


def _resource_category(error: BaseException) -> tuple[str, str | None]:
    message = str(error)
    categories = (
        ("disk cap", "disk-cap"),
        ("free-space reserve", "free-space-reserve"),
        ("free-inode reserve", "free-inode-reserve"),
        ("entry cap", "entry-cap"),
        ("tree changed repeatedly", "transient-tree-churn"),
        ("resource root", "resource-root-invalid"),
        ("resource root changed", "resource-root-changed"),
        ("resource root disappeared", "resource-root-disappeared"),
        ("unsupported filesystem", "filesystem-entry-invalid"),
    )
    category = next((label for marker, label in categories if marker in message), "resource-scan-error")
    resource_check = (
        "unsupported-filesystem-entry"
        if message == "experiment contains an unsupported filesystem entry" else None
    )
    return category, resource_check


def run_monitored(command: tuple[str, ...], *, cwd: Path, env: dict[str, str], timeout: int,
                  stage: str, resource_root: Path, poll_seconds: float = POLL_SECONDS,
                  observe_resource: Callable[..., None] | None = None) -> int:
    def observe_usage(entries: int, byte_count: int, allocated_blocks: int | None,
                      inode_count: int) -> None:
        if observe_resource is not None:
            observe_resource(stage, entries, byte_count,
                             allocated_block_bytes=allocated_blocks,
                             inode_count=inode_count)

    def check_resources(*, live_sample: bool = False) -> None:
        try:
            enforce_resource_limits(resource_root, live_sample=live_sample,
                                    observe_usage=observe_usage)
        except Exception as exc:
            kwargs = {}
            if isinstance(exc, ResourceEntryLimitExceeded):
                kwargs = {"entries_seen": exc.entries_seen, "entry_limit": exc.limit}
            category, resource_check = _resource_category(exc)
            raise MonitorFailure(stage, category, resource_check=resource_check, **kwargs) from exc

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
            try:
                enforce_resource_limits(resource_root, live_sample=True,
                                        observe_usage=observe_usage)
            except Exception as exc:
                kwargs = {}
                if isinstance(exc, ResourceEntryLimitExceeded):
                    kwargs = {"entries_seen": exc.entries_seen, "entry_limit": exc.limit}
                category, resource_check = _resource_category(exc)
                raise MonitorFailure(stage, category, resource_check=resource_check, **kwargs) from exc
            time.sleep(poll_seconds)
    except BaseException:
        _terminate_group(process)
        raise
    finally:
        if process.poll() is None:
            _terminate_group(process)
