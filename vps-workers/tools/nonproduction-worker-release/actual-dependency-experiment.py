#!/usr/bin/env python3
"""Manual, secretless CI experiment over the exact committed repository tree.

This intentionally does not touch the production broker, host paths, or services.
It performs online policy preverification against the fixed public npm registry,
then builds both real lockfiles offline with scripts disabled and reports sizes.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BIN = ROOT / "vps-workers" / "bin"
sys.path.insert(0, str(BIN))

import worker_release_dependency_artifacts as artifacts
import worker_release_dependency_install as installer
import worker_release_dependency_input_cache as input_cache
import worker_release_dependency_policy_cache as policy
import worker_release_dependency_sandbox as sandbox
from worker_release_actual_dependency_guard import (
    assert_deployed_package_matches_lock,
    enforce_resource_limits,
    failure_diagnostic,
    run_monitored,
    web_deploy_command,
)


def run(command: tuple[str, ...], *, cwd: Path, env: dict[str, str], timeout: int,
        stage: str, resource_root: Path) -> None:
    run_monitored(command, cwd=cwd, env=env, timeout=timeout, stage=stage,
                  resource_root=resource_root)


def pinned_pnpm(node: str) -> str:
    launcher = shutil.which("pnpm")
    if not launcher:
        raise RuntimeError("pinned pnpm launcher is unavailable")
    # pnpm/action-setup installs a shell shim in PNPM_HOME and keeps the actual
    # package below node_modules/.pnpm.  pathlib's recursive glob skips hidden
    # directories by default, so walk explicitly without following symlinks.
    search_root = (Path(launcher).parent.parent).resolve(strict=True)
    candidates = []
    seen = 0
    for current, directories, files in os.walk(search_root, topdown=True, followlinks=False):
        directories[:] = [name for name in directories
                          if not (Path(current) / name).is_symlink()]
        seen += len(directories) + len(files)
        if seen > 100_000:
            raise RuntimeError("pnpm installation exceeds entry bound")
        if not current.endswith("/pnpm/bin") or "pnpm.cjs" not in files:
            continue
        candidate = Path(current) / "pnpm.cjs"
        info = candidate.lstat()
        if not stat.S_ISREG(info.st_mode) or candidate.is_symlink():
            continue
        try:
            candidate.resolve(strict=True).relative_to(search_root)
        except (OSError, ValueError):
            continue
        result = subprocess.run((node, str(candidate), "--version"), stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                text=True, timeout=15, check=False)
        if result.returncode == 0 and result.stdout.strip() == policy.EXPECTED_PNPM:
            candidates.append(candidate.resolve(strict=True))
    if len(candidates) != 1:
        raise RuntimeError("could not identify exactly one pnpm 11.7.0 package entrypoint")
    return str(candidates[0])


def tree_size(root: Path, *, max_entries: int, max_bytes: int) -> tuple[int, int]:
    count = 0
    total = 0
    for current, directories, files in os.walk(root, topdown=True, followlinks=False):
        for name in directories + files:
            path = Path(current) / name
            info = path.lstat()
            count += 1
            entry_type = stat.S_IFMT(info.st_mode)
            if count > max_entries or entry_type not in (stat.S_IFDIR, stat.S_IFREG):
                raise RuntimeError("measured tree contains an unsafe entry or exceeds entry bound")
            if entry_type == stat.S_IFREG:
                if info.st_nlink != 1:
                    raise RuntimeError("measured tree contains a shared file inode")
                total += info.st_size
                if total > max_bytes:
                    raise RuntimeError("measured tree exceeds configured size bound")
    return count, total


def load_smoke_module():
    path = ROOT / "vps-workers" / "tools" / "nonproduction-worker-release" / "dependency-snapshot-smoke.py"
    spec = importlib.util.spec_from_file_location("actual_dependency_smoke", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("independent smoke module is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def independent_smoke(release: Path, node: str, smoke, resource_root: Path) -> str:
    before = hashlib.sha256()
    before.update(bytes.fromhex(smoke.snapshot_digest(release / "apps/web/node_modules", "web")))
    before.update(bytes.fromhex(smoke.snapshot_digest(release / "node_modules", "worker")))
    environment = {"PATH": f"{Path(node).parent}:/usr/bin:/bin", "HOME": "/nonexistent", "NODE_ENV": "production"}
    tsx = release / "apps/web/node_modules/.bin/tsx"
    if not tsx.is_file() or not os.access(tsx, os.X_OK):
        raise RuntimeError("materialized web tsx entrypoint is unavailable")
    run((str(tsx), "--version"), cwd=release / "apps/web", env=environment, timeout=30,
        stage="independent-smoke", resource_root=resource_root)
    dotenv = release / "node_modules/dotenv"
    if not dotenv.is_dir():
        raise RuntimeError("materialized worker dotenv package is unavailable")
    run((node, "--input-type=module", "-e", "import('dotenv').then(m => { if (typeof m.config !== 'function') process.exit(2) })"),
        cwd=release, env=environment, timeout=30, stage="independent-smoke",
        resource_root=resource_root)
    after = hashlib.sha256()
    after.update(bytes.fromhex(smoke.snapshot_digest(release / "apps/web/node_modules", "web-after")))
    after.update(bytes.fromhex(smoke.snapshot_digest(release / "node_modules", "worker-after")))
    if before.digest() != after.digest():
        raise RuntimeError("independent smoke modified the materialized dependency snapshot")
    return before.hexdigest()


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
    pnpm = pinned_pnpm(node)
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
            )
            run(preverify_command, cwd=ROOT,
                env={"PATH": f"{Path(node).parent}:/usr/bin:/bin", "HOME": str(home), "CI": "true"},
                timeout=600, stage="policy-preverify", resource_root=base)
            stage = "offline-store-validation"
            input_cache.validate_offline_store(store, owner_uid=os.geteuid(),
                                               max_entries=200_000,
                                               max_bytes=1536 * 1024 * 1024)
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
                "PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES": "true",
                "PNPM_CONFIG_PACKAGE_IMPORT_METHOD": "copy",
                "PNPM_CONFIG_OFFLINE": "true",
                "PNPM_CONFIG_REGISTRY": policy.TRUSTED_REGISTRY,
                "npm_config_registry": policy.TRUSTED_REGISTRY,
                "npm_config_userconfig": "/dev/null",
                "npm_config_globalconfig": "/dev/null",
            }
            preverify_receipt = store / policy.RECEIPT_NAME
            stage = "receipt-validation"
            policy.validate_receipt(source, cache, preverify_receipt, expected_sha=expected_sha)
            web_cmd = web_deploy_command(node, pnpm, store, output / "web", policy.TRUSTED_REGISTRY)
            run(web_cmd, cwd=source, env=offline_env, timeout=900,
                stage="web-deploy", resource_root=base)
            stage = "deploy-graph-validation"
            deployed_vercel_functions = assert_deployed_package_matches_lock(
                output / "web", source / "pnpm-lock.yaml", "@vercel/functions"
            )
            stage = "workspace-self-link-cleanup"
            sandbox.remove_workspace_self_link(output / "web", source)
            worker_cmd = (node, pnpm, "--registry", policy.TRUSTED_REGISTRY, "--package-import-method=copy", "install",
                          "--prod", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile", "--offline", "--store-dir", str(store))
            run(worker_cmd, cwd=source / "vps-workers", env=offline_env, timeout=900,
                stage="worker-install", resource_root=base)
            stage = "receipt-validation"
            policy.validate_receipt(source, cache, preverify_receipt, expected_sha=expected_sha)
            input_cache.validate_offline_store(store, owner_uid=os.geteuid(),
                                               max_entries=200_000,
                                               max_bytes=1536 * 1024 * 1024)
            stage = "offline-store-validation"
            store_count, store_bytes = tree_size(store, max_entries=200_000, max_bytes=1536 * 1024 * 1024)
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
            smoke_hash = independent_smoke(release, node, load_smoke_module(), base)
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
