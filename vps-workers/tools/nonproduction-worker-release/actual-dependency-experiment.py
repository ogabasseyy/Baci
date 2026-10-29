#!/usr/bin/env python3
"""Manual, secretless CI experiment over the exact committed repository tree.

This intentionally does not touch the production broker, host paths, or services.
It performs online policy preverification against the fixed public npm registry,
then builds both real lockfiles offline with scripts disabled and reports sizes.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BIN = ROOT / "vps-workers" / "bin"
EXPERIMENT_CACHE_BYTES = 4 * 1024 * 1024 * 1024
EXPERIMENT_STORE_BYTES = 4 * 1024 * 1024 * 1024
sys.path.insert(0, str(BIN))

import worker_release_dependency_artifacts as artifacts
import worker_release_dependency_install as installer
import worker_release_dependency_input_cache as input_cache
import worker_release_dependency_policy_cache as policy
import worker_release_dependency_policy_cli as policy_cli
import worker_release_dependency_sandbox as sandbox
from worker_release_actual_dependency_guard import (
    MonitorFailure,
    assert_deployed_package_matches_lock,
    enforce_resource_limits,
    failure_diagnostic,
    run_monitored,
    web_deploy_command,
)
from worker_release_actual_dependency_resources import (
    MAX_TREE_ENTRIES,
    MIN_FREE_BYTES,
    MIN_FREE_INODES,
)
from worker_release_dependency_diagnostics import read_diagnostic
from worker_release_actual_dependency_runtime import (
    independent_smoke,
    load_smoke_module,
    pinned_pnpm,
    tree_size,
)


def run(command: tuple[str, ...], *, cwd: Path, env: dict[str, str], timeout: int,
        stage: str, resource_root: Path) -> None:
    run_monitored(command, cwd=cwd, env=env, timeout=timeout, stage=stage,
                  resource_root=resource_root)


def run_policy_preverify(command: tuple[str, ...], *, cwd: Path, env: dict[str, str],
                         timeout: int, resource_root: Path, diagnostic_path: Path) -> None:
    try:
        run(command, cwd=cwd, env=env, timeout=timeout, stage="policy-preverify",
            resource_root=resource_root)
    except MonitorFailure as exc:
        record = read_diagnostic(diagnostic_path, owner_uid=os.geteuid())
        if record is not None and exc.category == "process-exit":
            raise MonitorFailure(str(record["stage"]), str(record["category"]),
                                 record["exit_code"] if isinstance(record["exit_code"], int)
                                 else exc.exit_code, record.get("evidence"),
                                 record.get("os_error")) from exc
        raise


def _main() -> int:
    started = time.monotonic()
    stage = "checkout-identity"
    expected_sha = os.environ.get("EXPECTED_CHECKOUT_SHA", "")
    if len(expected_sha) != 40 or any(char not in "0123456789abcdef" for char in expected_sha):
        raise RuntimeError("expected checkout SHA is invalid")
    head = subprocess.run(("git", "rev-parse", "HEAD"), cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    if head != expected_sha:
        raise RuntimeError("checkout does not match dispatched SHA")
    stage = "runtime-pin"
    node = shutil.which("node")
    if not node or subprocess.run((node, "--version"), capture_output=True, text=True, check=True).stdout.strip().split(".")[0] != "v24":
        raise RuntimeError("Node 24 runtime is unavailable")
    stage = "pnpm-pin"
    pnpm = pinned_pnpm(node, policy.EXPECTED_PNPM)
    try:
        with tempfile.TemporaryDirectory(prefix="baci-actual-dependency-experiment-") as temporary:
            base = Path(temporary)
            stage = "resource-preflight"
            enforce_resource_limits(base)
            archive = base / "checkout.tar"
            git = shutil.which("git")
            if not git:
                raise RuntimeError("git executable is unavailable")
            stage = "source-archive"
            run((git, "archive", "--format=tar", "--output", str(archive), "HEAD"), cwd=ROOT,
                env={"PATH": f"{Path(git).parent}:/usr/bin:/bin"}, timeout=120,
                stage="source-archive", resource_root=base)
            if archive.stat().st_size > 512 * 1024 * 1024:
                raise RuntimeError("source archive exceeds configured size bound")
            source = base / "source"
            source.mkdir(mode=0o700)
            stage = "source-extraction"
            with tarfile.open(archive, "r:") as tar:
                members = tar.getmembers()
                if len(members) > 500_000 or sum(member.size for member in members if member.isfile()) > 512 * 1024 * 1024:
                    raise RuntimeError("source archive exceeds configured expansion bound")
                tar.extractall(source, members=members, filter="data")
            stage = "source-tree-validation"
            enforce_resource_limits(base)
            source_size = tree_size(source, max_entries=500_000, max_bytes=512 * 1024 * 1024)[1]
            (source / ".baci-source-sha").write_text(expected_sha + "\n", encoding="ascii")
            store = base / "pnpm-store"
            store.mkdir(mode=0o700)
            cache = base / "pnpm-cache"
            cache.mkdir(mode=0o700)
            home = base / "home"
            home.mkdir(mode=0o700)
            stage = "policy-preverify"
            preverify_started = time.monotonic()
            preverify_command = (
                sys.executable, str(BIN / "worker_release_dependency_policy_cache.py"), "--preverify",
                "--source", str(source), "--store", str(store), "--cache", str(cache),
                "--pnpm", pnpm, "--node", node,
                "--experiment-cache-max-bytes", str(EXPERIMENT_CACHE_BYTES),
            )
            preverify_diagnostic = base / "policy-preverify-diagnostic.json"
            preverify_command += ("--diagnostic-file", str(preverify_diagnostic))
            run_policy_preverify(
                preverify_command, cwd=ROOT,
                env={"PATH": f"{Path(node).parent}:/usr/bin:/bin", "HOME": str(home), "CI": "true"},
                timeout=600, resource_root=base, diagnostic_path=preverify_diagnostic,
            )
            stage = "offline-store-validation"
            input_cache.validate_offline_store(store, owner_uid=os.geteuid(),
                                               max_entries=200_000,
                                               max_bytes=EXPERIMENT_STORE_BYTES)
            stage = "source-lock-validation"
            lock_hashes, _ = policy._input_hashes(source)
            output = base / "payload"
            (output / "web").mkdir(parents=True)
            offline_env = {
                "PATH": f"{Path(node).parent}:/usr/bin:/bin",
                "HOME": str(base / "home"),
                "CI": "true",
                "NODE_ENV": "production",
                "PNPM_CONFIG_CACHE_DIR": str(cache),
                "PNPM_CONFIG_STORE_DIR": str(store),
                "PNPM_CONFIG_FROZEN_LOCKFILE": "true",
                "PNPM_CONFIG_IGNORE_SCRIPTS": "true",
                "PNPM_CONFIG_IGNORE_PNPMFILE": "true",
                "PNPM_CONFIG_TRUST_LOCKFILE": "false",
                "PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES": "false",
                "PNPM_CONFIG_PACKAGE_IMPORT_METHOD": "copy",
                "PNPM_CONFIG_OFFLINE": "true",
                "PNPM_CONFIG_REGISTRY": policy.TRUSTED_REGISTRY,
                "npm_config_registry": policy.TRUSTED_REGISTRY,
                "npm_config_userconfig": "/dev/null",
                "npm_config_globalconfig": "/dev/null",
            }
            preverify_receipt = store / policy.RECEIPT_NAME
            stage = "receipt-validation"
            policy.validate_receipt(source, cache, preverify_receipt, expected_sha=expected_sha,
                                    cache_max_bytes=EXPERIMENT_CACHE_BYTES)
            injection_settings = policy.lock_injection_settings(source)
            web_cmd = web_deploy_command(node, pnpm, store, output / "web", policy.TRUSTED_REGISTRY)
            run(web_cmd, cwd=source,
                env={**offline_env, "PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES": "true"}, timeout=900,
                stage="web-deploy", resource_root=base)
            stage = "deploy-graph-validation"
            deployed_vercel_functions = assert_deployed_package_matches_lock(
                output / "web", source / "pnpm-lock.yaml", "@vercel/functions"
            )
            stage = "workspace-self-link-cleanup"
            sandbox.remove_workspace_self_link(output / "web", source)
            worker_cmd = (node, pnpm, "--registry", policy.TRUSTED_REGISTRY, "--package-import-method=copy", "install",
                          "--prod", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile", "--offline", "--store-dir", str(store))
            run(worker_cmd, cwd=source / "vps-workers",
                env={**offline_env, "PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES": str(injection_settings["vps-workers/pnpm-lock.yaml"]).lower()}, timeout=900,
                stage="worker-install", resource_root=base)
            stage = "receipt-validation"
            policy.validate_receipt(source, cache, preverify_receipt, expected_sha=expected_sha,
                                    cache_max_bytes=EXPERIMENT_CACHE_BYTES)
            input_cache.validate_offline_store(store, owner_uid=os.geteuid(),
                                               max_entries=200_000,
                                               max_bytes=EXPERIMENT_STORE_BYTES)
            stage = "offline-store-validation"
            store_count, store_bytes = tree_size(store, max_entries=200_000,
                                                 max_bytes=EXPERIMENT_STORE_BYTES)
            worker_modules = source / "vps-workers" / "node_modules"
            if not worker_modules.is_dir() or worker_modules.is_symlink():
                raise RuntimeError("offline standalone worker install produced no real node_modules directory")
            (output / "root").mkdir()
            shutil.copytree(worker_modules, output / "root" / "node_modules", symlinks=True)
            enforce_resource_limits(base)
            stage = "payload-validation"
            entries, payload_bytes = artifacts.validate_payload(output)
            release = base / "release"
            (release / "apps" / "web").mkdir(parents=True, mode=0o700)
            stage = "payload-materialization"
            installer.install_payload(output, release, owner_uid=os.geteuid())
            enforce_resource_limits(base)
            stage = "independent-smoke"
            smoke_hash = independent_smoke(release, node, load_smoke_module(ROOT), base)
            stage = "materialized-tree-validation"
            materialized_count, materialized_bytes = tree_size(release, max_entries=200_000,
                                                                max_bytes=1024 * 1024 * 1024)
            report = {
                "experiment": "actual-checkout-offline-dependencies",
                "checkout_sha": expected_sha,
                "lockfile_sha256": lock_hashes,
                "deployed_lock_graph_check": {"@vercel/functions": deployed_vercel_functions},
                "source_bytes": source_size,
                "pnpm_store_entries": store_count,
                "pnpm_store_bytes": store_bytes,
                "payload_entries": len(entries),
                "payload_expanded_bytes": payload_bytes,
                "materialized_entries": materialized_count,
                "materialized_bytes": materialized_bytes,
                "smoke_sha256": smoke_hash,
                "preverify_seconds": round(time.monotonic() - preverify_started, 2),
                "total_seconds": round(time.monotonic() - started, 2),
                "network_policy": "preverify-only-fixed-registry; all builds offline",
                "measurement_caps_bytes": {
                    "metadata_cache": EXPERIMENT_CACHE_BYTES,
                    "store": EXPERIMENT_STORE_BYTES,
                    "monitored_scratch": 12 * 1024 * 1024 * 1024,
                },
                "resource_guards": {
                    "monitored_entry_limit": MAX_TREE_ENTRIES,
                    "minimum_free_bytes": MIN_FREE_BYTES,
                    "minimum_free_inodes": MIN_FREE_INODES,
                },
                "lifecycle_scripts": "disabled",
            }
            print(json.dumps(report, sort_keys=True))
        return 0
    except Exception as exc:
        print(failure_diagnostic(stage, exc), file=sys.stderr)
        return 1


def main() -> int:
    try:
        return _main()
    except Exception as exc:
        print(failure_diagnostic("experiment", exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
