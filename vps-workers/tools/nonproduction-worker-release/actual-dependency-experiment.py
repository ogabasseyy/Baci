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

import worker_release_dependency_install as installer
import worker_release_dependency_artifacts as artifacts
import worker_release_dependency_builder as production_builder
import worker_release_dependency_input_cache as input_cache
import worker_release_dependency_policy_cache as policy
import worker_release_dependency_policy_cli as policy_cli
import worker_release_dependency_fs as dependency_fs
import worker_release_dependency_sandbox as sandbox

PRODUCTION_RESOURCE_LIMITS = {
    "payload_bytes": artifacts.MAX_PAYLOAD_BYTES,
    "materialized_bytes": installer.MAX_MATERIALIZED_BYTES,
    "aggregate_build_bytes": production_builder.MAX_BUILD_SCRATCH_BYTES,
    "aggregate_build_entries": production_builder.MAX_BUILD_SCRATCH_ENTRIES,
    "build_filesystem_min_bytes": production_builder.MIN_BUILD_FILESYSTEM_BYTES,
    "build_filesystem_max_bytes": production_builder.MAX_BUILD_FILESYSTEM_BYTES,
    "metadata_cache_bytes": policy.MAX_CACHE_BYTES,
}
from worker_release_actual_dependency_guard import (
    MonitorFailure,
    assert_deployed_package_matches_lock,
    enforce_resource_limits,
    failure_diagnostic,
    run_monitored,
    web_deploy_command,
)
from worker_release_actual_dependency_limits import (
    EXPERIMENT_PAYLOAD_BYTES, configure_experiment_payload_limits,
    inspect_materialization_budget, reclaim_experiment_tree,
)
from worker_release_actual_dependency_runner import run, run_policy_preverify as _run_policy_preverify
from worker_release_actual_dependency_resources import (MAX_TREE_BYTES, MAX_TREE_ENTRIES, MIN_FREE_BYTES,
                                                        MIN_FREE_INODES, copy_verified_policy_cache,
                                                        make_policy_cache_seed_read_only,
                                                        ResourceHighWater)
from worker_release_actual_dependency_runtime import (
    independent_smoke,
    load_smoke_module,
    pinned_pnpm,
    tree_size,
)
from worker_release_actual_seed_move_measure import move_inputs_and_measure


def run_policy_preverify(command: tuple[str, ...], *, cwd: Path, env: dict[str, str],
                         timeout: int, resource_root: Path, diagnostic_path: Path,
                         observe_resource=None) -> None:
    _run_policy_preverify(command, cwd=cwd, env=env, timeout=timeout,
                          resource_root=resource_root, diagnostic_path=diagnostic_path,
                          run_fn=run, observe_resource=observe_resource)


def _main() -> int:
    started = time.monotonic()
    stage = "checkout-identity"
    try:
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
    except Exception as exc:
        # Preserve the bounded stage and closed diagnostic category for setup
        # failures; never print the exception text or subprocess output.
        print(failure_diagnostic(stage, exc), file=sys.stderr)
        return 1

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
            reclaim_experiment_tree(archive, scratch_root=base)
            production_high_water = ResourceHighWater()

            def observe_production(stage_name: str, entries: int | None = None,
                                   byte_count: int | None = None) -> tuple[int, int]:
                measured_usage: dict[str, int | None] = {}

                def record_usage(measured_entries: int, measured_bytes: int,
                                 allocated_blocks: int | None, inode_count: int) -> None:
                    measured_usage.update(entries=measured_entries, logical_bytes=measured_bytes,
                                          allocated_blocks=allocated_blocks, inode_count=inode_count)

                if entries is None or byte_count is None:
                    enforce_resource_limits(base, observe_usage=record_usage)
                    entries = measured_usage["entries"]
                    byte_count = measured_usage["logical_bytes"]
                production_high_water.observe(
                    stage_name, entries, byte_count,
                    allocated_block_bytes=measured_usage.get("allocated_blocks"),
                    inode_count=measured_usage.get("inode_count"),
                )
                return entries, byte_count

            observe_production("source-copy")
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
                observe_resource=production_high_water.observe,
            )
            stage = "offline-store-validation"
            observe_production("offline-store-validation")
            _, validated_store_exclusions = input_cache.validate_offline_store(
                store, owner_uid=os.geteuid(), max_entries=200_000,
                max_bytes=EXPERIMENT_STORE_BYTES,
            )
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
            stage = "build-cache-snapshot"
            make_policy_cache_seed_read_only(cache)
            observe_production("build-cache-snapshot")
            build_cache = base / "pnpm-build-cache"
            copy_verified_policy_cache(cache, build_cache,
                                      max_entries=policy.MAX_CACHE_ENTRIES,
                                      max_bytes=EXPERIMENT_CACHE_BYTES)
            observe_production("build-cache-snapshot")
            offline_env["PNPM_CONFIG_CACHE_DIR"] = str(build_cache)
            injection_settings = policy.lock_injection_settings(source)
            web_cmd = web_deploy_command(node, pnpm, store, output / "web", policy.TRUSTED_REGISTRY)
            run(web_cmd, cwd=source,
                env={**offline_env, "PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES": "true"}, timeout=900,
                stage="web-deploy", resource_root=base,
                observe_resource=production_high_water.observe)
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
                stage="worker-install", resource_root=base,
                observe_resource=production_high_water.observe)
            stage = "receipt-validation"
            policy.validate_receipt(source, cache, preverify_receipt, expected_sha=expected_sha,
                                    cache_max_bytes=EXPERIMENT_CACHE_BYTES)
            _, checked_store_exclusions = input_cache.validate_offline_store(
                store, owner_uid=os.geteuid(), max_entries=200_000,
                max_bytes=EXPERIMENT_STORE_BYTES,
            )
            if checked_store_exclusions != validated_store_exclusions:
                raise RuntimeError("offline pnpm store index layout changed during experiment")
            stage = "offline-store-validation"
            observe_production("offline-store-validation")
            store_count, store_bytes = tree_size(store, max_entries=200_000,
                                                 max_bytes=EXPERIMENT_STORE_BYTES,
                                                 excluded_relative_directories=checked_store_exclusions)
            stage = "seed-move-measurement"
            seed_measurement_root = base / "seed-move-measurement"
            seed_measurement_root.mkdir(mode=0o700)
            seed_move_measurement = move_inputs_and_measure(
                cache, store, seed_measurement_root / expected_sha,
                measure=lambda path: tree_size(
                    path, max_entries=200_000,
                    max_bytes=EXPERIMENT_STORE_BYTES if path.name == "store" else EXPERIMENT_CACHE_BYTES,
                    excluded_relative_directories=(checked_store_exclusions if path.name == "store"
                                                   else frozenset()),
                ),
            )
            observe_production("seed-move-publication")
            worker_modules = source / "vps-workers" / "node_modules"
            if not worker_modules.is_dir() or worker_modules.is_symlink():
                raise RuntimeError("offline standalone worker install produced no real node_modules directory")
            (output / "root").mkdir()
            worker_payload = output / "root" / "node_modules"
            if (os.path.lexists(worker_payload)
                    or worker_modules.stat().st_dev != worker_payload.parent.stat().st_dev):
                raise RuntimeError("offline worker dependencies cannot be moved into the payload")
            os.rename(worker_modules, worker_payload)
            # Match the production builder's retained-resource lifecycle: it
            # snapshots the quiesced payload before cleaning the source, store,
            # and policy caches. This reports the real copy peak rather than
            # an artificially reclaimed export peak.
            stage = "payload-export"
            export_root = base / "payload-export"
            export_root.mkdir(mode=0o700)
            current_entries, current_bytes = observe_production("payload-snapshot")
            export_entries = 0
            export_bytes = 0

            def check_export_budget(_relative: str, _kind: str, entry_bytes: int) -> None:
                nonlocal export_entries, export_bytes
                if current_entries + export_entries + 1 > MAX_TREE_ENTRIES:
                    raise RuntimeError("experiment entry cap reached during isolated payload export")
                if current_bytes + export_bytes + entry_bytes > MAX_TREE_BYTES:
                    raise RuntimeError("experiment disk cap reached during isolated payload export")
                production_high_water.observe("payload-snapshot",
                                              current_entries + export_entries + 1,
                                              current_bytes + export_bytes + entry_bytes)
                capacity = os.statvfs(base)
                available_bytes = capacity.f_bavail * capacity.f_frsize
                if available_bytes < MIN_FREE_BYTES + entry_bytes:
                    raise RuntimeError("experiment free-space reserve reached")
                if capacity.f_favail < MIN_FREE_INODES + 1:
                    raise RuntimeError("experiment free-inode reserve reached")
                export_entries += 1
                export_bytes += entry_bytes

            configure_experiment_payload_limits()
            exported_output = dependency_fs.snapshot_payload(
                base, export_root, os.geteuid(), before_entry=check_export_budget,
            )
            observe_production("payload-snapshot")
            # Export is a regular, independently validated snapshot. Now that
            # the production-equivalent peak was measured, remove only these
            # experiment-owned phase trees before follow-on analysis.
            for completed_phase_tree in (seed_measurement_root, build_cache, source, home, output):
                reclaim_experiment_tree(completed_phase_tree, scratch_root=base)
            enforce_resource_limits(base)
            stage = "payload-validation"
            configure_experiment_payload_limits()
            entries, payload_bytes = artifacts.validate_payload(exported_output)
            release = base / "release"
            (release / "apps" / "web").mkdir(parents=True, mode=0o700)
            stage = "payload-materialization"
            _, current_scratch_bytes = enforce_resource_limits(base)
            materialization_headroom = MAX_TREE_BYTES - current_scratch_bytes
            if materialization_headroom <= 0:
                raise RuntimeError("experiment disk cap leaves no materialization headroom")
            configure_experiment_payload_limits(materialization_limit=materialization_headroom)
            try:
                installer.install_payload(exported_output, release, owner_uid=os.geteuid())
            except Exception as install_error:
                if str(install_error) in {
                        "materialized dependency candidate exceeds configured bounds",
                        "materialized dependency candidate has too many entries"}:
                    check, measured_entries, measured_bytes = inspect_materialization_budget(
                        exported_output, byte_limit=materialization_headroom,
                    )
                    install_error.safe_materialization_check = check
                    install_error.safe_materialization_entries = measured_entries
                    install_error.safe_materialization_bytes = measured_bytes
                    install_error.safe_materialization_entry_limit = 200_000
                    install_error.safe_materialization_byte_limit = materialization_headroom
                raise
            enforce_resource_limits(base)
            stage = "independent-smoke"
            smoke = load_smoke_module(ROOT)
            configure_experiment_payload_limits(smoke)
            smoke_hash = independent_smoke(release, node, smoke, base)
            stage = "materialized-tree-validation"
            materialized_count, materialized_bytes = tree_size(release, max_entries=200_000,
                                                                max_bytes=EXPERIMENT_PAYLOAD_BYTES)
            report = {
                "experiment": "actual-checkout-offline-dependencies",
                "checkout_sha": expected_sha,
                "lockfile_sha256": lock_hashes,
                "deployed_lock_graph_check": {"@vercel/functions": deployed_vercel_functions},
                "source_bytes": source_size,
                "pnpm_store_entries": store_count,
                "pnpm_store_bytes": store_bytes,
                "same_filesystem_seed_move": seed_move_measurement,
                "payload_entries": len(entries),
                "payload_expanded_bytes": payload_bytes,
                "payload_export": {"entries_copied": export_entries, "expanded_bytes_copied": export_bytes,
                                   "source_hardlink_aliases_preserved": False},
                "materialized_entries": materialized_count,
                "materialized_bytes": materialized_bytes,
                "smoke_sha256": smoke_hash,
                "preverify_seconds": round(time.monotonic() - preverify_started, 2),
                "production_equivalent_sampled_high_water": production_high_water.report(),
                "production_limits_bytes_and_entries": PRODUCTION_RESOURCE_LIMITS,
                "total_seconds": round(time.monotonic() - started, 2),
                "network_policy": "preverify-only-fixed-registry; all builds offline",
                "measurement_caps_bytes": {
                    "metadata_cache": EXPERIMENT_CACHE_BYTES,
                    "store": EXPERIMENT_STORE_BYTES,
                    "payload": EXPERIMENT_PAYLOAD_BYTES,
                    "monitored_scratch": MAX_TREE_BYTES,
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
