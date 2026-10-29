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
from worker_release_dependency_diagnostics import format_policy_line_shapes
from worker_release_dependency_evidence_shape import (
    OFFLINE_STORE_SUBTYPES,
    safe_errno_category,
    validate_os_error,
)
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
    "worker-install", "receipt-validation", "payload-validation", "payload-materialization",
    "independent-smoke", "materialized-tree-validation", "resource-scan", "experiment",
    "preverify-web-install", "preverify-worker-install", "web-install",
})
RESOURCE_CHECKS = frozenset({"unsupported-filesystem-entry"})
TREE_CHECKS = frozenset({"unsafe-entry-or-entry-limit", "shared-file-inode"})


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
    """Render fixed diagnostics only; never include exception or command text."""
    entry_metadata = None
    store_subtype = getattr(error, "safe_subtype", None)
    if store_subtype not in OFFLINE_STORE_SUBTYPES:
        store_subtype = None
    resource_check = None
    tree_check = None
    if isinstance(error, MonitorFailure):
        stage, category, exit_code = error.stage, error.category, error.exit_code
        os_error = error.os_error
        entry_metadata = error.entries_seen, error.entry_limit
        resource_check = error.resource_check
    else:
        stage = stage if stage in STAGES else "experiment"
        exit_code = None
        os_error = None
        if isinstance(error, ResourceEntryLimitExceeded):
            entry_metadata = error.entries_seen, error.limit
        if isinstance(error, subprocess.CalledProcessError):
            category, exit_code = "subprocess-exit", error.returncode
        elif isinstance(error, subprocess.TimeoutExpired):
            category = "subprocess-timeout"
        elif isinstance(error, OSError):
            category = safe_errno_category(error.errno)
        elif isinstance(error, (ValueError, TypeError)):
            category = "invalid-result"
        elif isinstance(error, RuntimeError):
            message = str(error)
            tree_checks = {
                "measured tree contains an unsafe entry or exceeds entry bound": "unsafe-entry-or-entry-limit",
                "measured tree contains a shared file inode": "shared-file-inode",
            }
            tree_check = tree_checks.get(message)
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
                ("receipt metadata cache changed", "policy-receipt-cache-changed"),
                ("receipt", "policy-receipt"),
                ("timed out", "deadline"),
            )
            category = next((label for marker, label in categories if marker in message), "runtime-error")
            if store_subtype is not None:
                category = "filesystem-entry-invalid"
        else:
            category = "operation-error"
    suffix = f" exit={exit_code}" if isinstance(exit_code, int) else ""
    if isinstance(error, MonitorFailure) and error.evidence is not None:
        evidence = error.evidence
        suffix += (f" evidence={evidence['classification']} phrase_lines={evidence['phrase_lines']}"
                   f" recognized_lines={evidence['recognized_lines']}")
        suffix += format_policy_line_shapes(evidence)
    if os_error is not None:
        try:
            os_error = validate_os_error(os_error)
            number = os_error["errno"]
            suffix += f" errno={number if number is not None else 'unknown'}"
            suffix += f" substage={os_error['substage']}"
        except (TypeError, ValueError):
            pass
    if entry_metadata is not None:
        entries_seen, entry_limit = entry_metadata
        if (type(entries_seen) is int and 1 <= entries_seen <= MAX_TREE_ENTRIES + 1
                and type(entry_limit) is int and 1 <= entry_limit <= MAX_TREE_ENTRIES):
            suffix += f" entries_seen={entries_seen} entry_limit={entry_limit}"
    if store_subtype is not None:
        suffix += f" store_check={store_subtype}"
    if resource_check is not None:
        suffix += f" resource_check={resource_check}"
    if tree_check in TREE_CHECKS:
        suffix += f" tree_check={tree_check}"
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
                  stage: str, resource_root: Path, poll_seconds: float = POLL_SECONDS) -> int:
    def check_resources() -> None:
        try:
            enforce_resource_limits(resource_root)
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
                enforce_resource_limits(resource_root, live_sample=True)
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
