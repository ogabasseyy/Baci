#!/usr/bin/env python3
"""Fixture-oriented pnpm policy preverification and offline cache receipt.

The receipt is a consistency record, not a source or identity attestation. A
production caller must create it only after a root-trusted online verifier has
checked the authenticated immutable source and fixed policy.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Sequence

from worker_release_dependency_artifacts import BuilderRejected

EXPECTED_PNPM = "11.7.0"
RECEIPT_NAME = ".baci-policy-verification.json"
LOCKFILES = ("pnpm-lock.yaml", "vps-workers/pnpm-lock.yaml")
POLICY_FILES = ("pnpm-workspace.yaml", "vps-workers/pnpm-workspace.yaml")
POLICY_FLAGS = {
    "frozenLockfile": True,
    "ignoreScripts": True,
    "ignorePnpmfile": True,
    "trustLockfile": False,
}
TRUSTED_REGISTRY = "https://registry.npmjs.org/"
MAX_CACHE_BYTES = 256 * 1024 * 1024
MAX_CACHE_ENTRIES = 100_000
SHA_RE = re.compile(r"^[0-9a-f]{40}$")

from worker_release_dependency_registry_policy import (
    validate_registry_routing as _validate_registry_routing,
)


def _sha256_regular_file(path: Path, *, owner_uid: int | None = None, max_bytes: int = 64 * 1024 * 1024) -> str:
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError as exc:
        raise BuilderRejected("dependency policy input is unavailable") from exc
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                or (owner_uid is not None and before.st_uid != owner_uid)
                or before.st_size > max_bytes):
            raise BuilderRejected("dependency policy input inode is unsafe")
        digest = hashlib.sha256()
        total = 0
        while chunk := os.read(fd, 1024 * 1024):
            total += len(chunk)
            if total > max_bytes:
                raise BuilderRejected("dependency policy input exceeds its size limit")
            digest.update(chunk)
        after = os.fstat(fd)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) or total != before.st_size:
            raise BuilderRejected("dependency policy input changed while hashing")
        return digest.hexdigest()
    finally:
        os.close(fd)


def _hash_tree(root: Path, expected_owner: int | None = None) -> str:
    owner = os.geteuid() if expected_owner is None else expected_owner
    root_info = root.lstat()
    if not stat.S_ISDIR(root_info.st_mode) or root_info.st_uid != owner or root_info.st_mode & 0o022:
        raise BuilderRejected("pnpm policy cache ownership or mode is unsafe")
    digest = hashlib.sha256()
    total = 0
    entries = 0
    for current, directories, files in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        for name in sorted(directories):
            child = current_path / name
            info = child.lstat()
            entries += 1
            if entries > MAX_CACHE_ENTRIES or not stat.S_ISDIR(info.st_mode) or info.st_uid != owner or info.st_mode & 0o022:
                raise BuilderRejected("pnpm policy cache contains an unsafe directory")
        for name in sorted(files):
            child = current_path / name
            before = child.lstat()
            entries += 1
            if entries > MAX_CACHE_ENTRIES or not stat.S_ISREG(before.st_mode) or before.st_uid != owner or before.st_mode & 0o022:
                raise BuilderRejected("pnpm policy cache contains an unsafe file")
            relative = child.relative_to(root).as_posix().encode("utf-8")
            digest.update(len(relative).to_bytes(4, "big"))
            digest.update(relative)
            file_digest = hashlib.sha256()
            with child.open("rb") as handle:
                while chunk := handle.read(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_CACHE_BYTES:
                        raise BuilderRejected("pnpm policy cache exceeds its byte limit")
                    file_digest.update(chunk)
            after = child.lstat()
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise BuilderRejected("pnpm policy cache changed while hashing")
            digest.update(file_digest.digest())
    after_root = root.lstat()
    if (root_info.st_dev, root_info.st_ino, root_info.st_mtime_ns, root_info.st_ctime_ns) != (after_root.st_dev, after_root.st_ino, after_root.st_mtime_ns, after_root.st_ctime_ns):
        raise BuilderRejected("pnpm policy cache changed while hashing")
    return digest.hexdigest()


def _input_hashes(source: Path) -> tuple[dict[str, str], dict[str, str]]:
    locks: dict[str, str] = {}
    policies: dict[str, str] = {}
    for relative in LOCKFILES:
        path = source / relative
        try:
            info = path.lstat()
        except OSError as exc:
            raise BuilderRejected("required dependency policy input is missing") from exc
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise BuilderRejected("dependency policy input must be a regular file")
        locks[relative] = _sha256_regular_file(path)
    for relative in POLICY_FILES:
        path = source / relative
        try:
            info = path.lstat()
        except OSError as exc:
            raise BuilderRejected("required dependency policy input is missing") from exc
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise BuilderRejected("dependency policy input must be a regular file")
        policies[relative] = _sha256_regular_file(path)
    return locks, policies


def _source_sha(source: Path) -> str:
    marker = source / ".baci-source-sha"
    try:
        fd = os.open(marker, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError as exc:
        raise BuilderRejected("dependency source SHA marker is unavailable") from exc
    try:
        before = os.fstat(fd)
        value = os.read(fd, 65)
        after = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > 64
                or before.st_size != len(value) or (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino)
                or before.st_mtime_ns != after.st_mtime_ns or before.st_ctime_ns != after.st_ctime_ns):
            raise BuilderRejected("dependency source SHA marker is unsafe")
    finally:
        os.close(fd)
    try:
        sha = value.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise BuilderRejected("dependency source SHA marker is malformed") from exc
    if not SHA_RE.fullmatch(sha):
        raise BuilderRejected("dependency source SHA marker is malformed")
    return sha


def make_receipt(source: Path, cache: Path, pnpm_version: str, *, cache_owner: int | None = None) -> dict[str, object]:
    _validate_registry_routing(source, POLICY_FILES, TRUSTED_REGISTRY)
    locks, policies = _input_hashes(source)
    if pnpm_version != EXPECTED_PNPM:
        raise BuilderRejected("pnpm version does not match the dependency policy pin")
    return {
        "schema": 1,
        "sourceSha": _source_sha(source),
        "pnpmVersion": EXPECTED_PNPM,
        "lockfiles": locks,
        "policyFiles": policies,
        "effectiveFlags": POLICY_FLAGS,
        "registryRouting": {"default": TRUSTED_REGISTRY, "scoped": "none"},
        "metadataCacheSha256": _hash_tree(cache, cache_owner),
        "verification": "pnpm-online-frozen-install-passed",
    }


def validate_receipt(source: Path, cache: Path, receipt_path: Path, pnpm_version: str = EXPECTED_PNPM,
                     *, owner_uid: int | None = None, expected_sha: str | None = None) -> dict[str, object]:
    owner = os.geteuid() if owner_uid is None else owner_uid
    try:
        fd = os.open(receipt_path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_uid != owner
                or before.st_mode & 0o022 or before.st_size > 32_768):
            raise BuilderRejected("pnpm policy verification receipt is unsafe")
        raw = os.read(fd, 32_769)
        after = os.fstat(fd)
        if (len(raw) > 32_768 or len(raw) != before.st_size
                or (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns)):
            raise BuilderRejected("pnpm policy verification receipt changed while reading")
        value = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise BuilderRejected("pnpm policy verification receipt is unavailable or malformed") from exc
    finally:
        if "fd" in locals():
            os.close(fd)
    expected = make_receipt(source, cache, pnpm_version, cache_owner=owner)
    if value != expected:
        raise BuilderRejected("pnpm policy verification receipt does not match exact lockfiles and policy")
    if expected_sha is not None and not hmac.compare_digest(str(value["sourceSha"]), expected_sha):
        raise BuilderRejected("pnpm policy verification receipt does not match expected source SHA")
    return value


def preverify(source: Path, store: Path, cache: Path, pnpm: str) -> None:
    _validate_registry_routing(source, POLICY_FILES, TRUSTED_REGISTRY)
    version = subprocess.run((pnpm, "--version"), cwd=source, check=True, capture_output=True, text=True, timeout=15).stdout.strip()
    if version != EXPECTED_PNPM:
        raise BuilderRejected("pnpm runtime differs from pinned dependency policy version")
    env = {
        "PATH": "/usr/bin:/bin",
        "CI": "true",
        "PNPM_CONFIG_CACHE_DIR": str(cache),
        "PNPM_CONFIG_STORE_DIR": str(store),
        "PNPM_CONFIG_FROZEN_LOCKFILE": "true",
        "PNPM_CONFIG_IGNORE_SCRIPTS": "true",
        "PNPM_CONFIG_TRUST_LOCKFILE": "false",
        "PNPM_CONFIG_OFFLINE": "false",
        "PNPM_CONFIG_REGISTRY": TRUSTED_REGISTRY,
        "npm_config_registry": TRUSTED_REGISTRY,
        "npm_config_userconfig": "/dev/null",
        "npm_config_globalconfig": "/dev/null",
    }
    before = _input_hashes(source)
    with tempfile.TemporaryDirectory(prefix="pnpm-policy-home-", dir=cache.parent) as home:
        env["HOME"] = home
        with tempfile.TemporaryDirectory(prefix="pnpm-policy-preverify-", dir=cache.parent) as output_root:
            commands = (
                ((pnpm, "--registry", TRUSTED_REGISTRY, "--filter", "@baci/web", "--prod", "deploy", "--legacy", "--ignore-scripts", "--ignore-pnpmfile", "--store-dir", str(store), str(Path(output_root) / "web")), source),
                ((pnpm, "--registry", TRUSTED_REGISTRY, "install", "--prod", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile", "--store-dir", str(store)), source / "vps-workers"),
            )
            for command, cwd in commands:
                result = subprocess.run(command, cwd=cwd, env=env, check=True, capture_output=True, text=True, timeout=240)
                if "Lockfile passes supply-chain policies" not in result.stdout:
                    raise BuilderRejected("pnpm did not report a lockfile supply-chain policy verification")
    if before != _input_hashes(source):
        raise BuilderRejected("pnpm changed a lockfile or policy during preverification")
    receipt = make_receipt(source, cache, version)
    path = store / RECEIPT_NAME
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o400)
    try:
        payload = (json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n").encode()
        remaining = memoryview(payload)
        while remaining:
            written = os.write(fd, remaining)
            if written <= 0:
                raise OSError("short write while recording policy receipt")
            remaining = remaining[written:]
        os.fsync(fd)
    finally:
        os.close(fd)
    directory_fd = os.open(store, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preverify", action="store_true", help="fixture-only: online verify and write consistency receipt")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--store", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--pnpm", default="/usr/bin/pnpm")
    args = parser.parse_args(argv)
    try:
        if not args.preverify:
            parser.error("--preverify is required")
        preverify(args.source, args.store, args.cache, args.pnpm)
        print("synthetic dependency policy preverification passed")
        return 0
    except (BuilderRejected, OSError, subprocess.SubprocessError) as exc:
        print(f"dependency policy preverification rejected: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
