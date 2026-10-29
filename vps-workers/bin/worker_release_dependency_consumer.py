"""Fail-closed, disconnected consumer for broker-authenticated dependency builds.

This module is deliberately not wired into release dispatch. It accepts the
authenticated identity, matching dispatcher archive binding, and a frozen
source snapshot supplied by its trusted caller. It verifies the builder's
root-owned manifest and payload, then materializes contained symlinks as
regular files before adding dependencies to a frozen incoming release.
"""
from __future__ import annotations

import base64
import hashlib
import os
import re
import shutil
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from worker_release_broker_common import MAX_ARCHIVE_COMPRESSED_BYTES
from worker_release_dependency_artifacts import (
    MANIFEST_NAME,
    SHA_RE,
    BuilderRejected,
    sha256_file,
    validate_payload,
)
from worker_release_dependency_install import install_payload
from worker_release_lifecycle import AuthenticatedRun
from worker_release_result_root import pin_result_root
from worker_release_source_snapshot import PinnedSourceSnapshot, pin_source_snapshot

EXPECTED_SMOKE = {"web_tsx": "passed", "worker_dotenv": "passed"}
WORKER_ROOT = Path("/srv/baci-workers")


@dataclass(frozen=True)
class BrokerFetchedArchive:
    """Rechecked bytes from the fixed dispatcher; not an auth token."""

    source_sha: str
    archive_sha256: str
    data: bytes


@dataclass(frozen=True)
class BrokerFrozenSourceSnapshot:
    """Caller-owned consistency contract, not an authentication token.

    The broker must bind it to the authenticated response and constrained
    extraction. Snapshot fields and marker alone never prove provenance.
    """

    path: Path
    source_sha: str
    archive_sha256: str


def _trusted_directory(path: Path, *, uid: int, writable_mask: int = 0o022) -> None:
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != uid or info.st_mode & writable_mask):
        raise BuilderRejected("dependency integration directory is not trusted")


def _remove_tree(path: Path) -> None:
    """Remove only a root-owned private builder result tree after consumption."""
    if not path.exists() and not path.is_symlink():
        return
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid():
        raise BuilderRejected("private builder result cleanup target changed")
    for current, directories, _files in os.walk(path, topdown=True, followlinks=False):
        os.chmod(current, 0o700, follow_symlinks=False)
        for name in directories:
            child = Path(current) / name
            child_info = child.lstat()
            if stat.S_ISDIR(child_info.st_mode):
                os.chmod(child, 0o700, follow_symlinks=False)
    if not shutil.rmtree.avoids_symlink_attacks:
        raise BuilderRejected("safe descriptor-based builder result cleanup is unavailable")
    shutil.rmtree(path)


def _validate_source_snapshot(snapshot: BrokerFrozenSourceSnapshot, archive: BrokerFetchedArchive,
                              identity: AuthenticatedRun, *, owner_uid: int) -> PinnedSourceSnapshot:
    """Check a caller-frozen snapshot without unpacking archive bytes as root."""
    if (not isinstance(snapshot, BrokerFrozenSourceSnapshot)
            or snapshot.source_sha != identity.sha
            or snapshot.archive_sha256 != archive.archive_sha256):
        raise BuilderRejected("frozen source snapshot does not match the authenticated archive binding")
    root = snapshot.path
    if not isinstance(root, Path):
        raise BuilderRejected("frozen source snapshot path is invalid")
    if root == WORKER_ROOT or WORKER_ROOT in root.parents:
        raise BuilderRejected("frozen source snapshot must be outside the production worker root")
    try:
        pinned = pin_source_snapshot(root, trusted_root=root.parent, owner_uid=owner_uid)
    except (OSError, BuilderRejected) as exc:
        raise BuilderRejected("frozen source snapshot is unavailable") from exc
    try:
        marker = root / ".baci-source-sha"
        fd = os.open(marker, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            info = os.fstat(fd)
            value = os.read(fd, 65)
            after = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != owner_uid or info.st_nlink != 1
                    or stat.S_IMODE(info.st_mode) != 0o440 or len(value) != info.st_size
                    or info.st_size > 64 or (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
                    != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)):
                raise BuilderRejected("frozen source snapshot SHA marker is unsafe")
        finally:
            os.close(fd)
        if value != (identity.sha + "\n").encode("ascii"):
            raise BuilderRejected("frozen source snapshot SHA marker does not match the run")
        required = (root / "pnpm-lock.yaml", root / "vps-workers" / "pnpm-lock.yaml")
        if any(not item.is_file() or item.is_symlink() for item in required):
            raise BuilderRejected("frozen source snapshot lockfiles are missing or unsafe")
        pinned.verify_unchanged()
        return pinned
    except BaseException:
        pinned.close()
        raise


def _validated_identity(identity: AuthenticatedRun) -> AuthenticatedRun:
    if not isinstance(identity, AuthenticatedRun):
        raise BuilderRejected("authenticated broker identity is required")
    try:
        return AuthenticatedRun.from_broker({
            "repository": identity.repository, "workflow": identity.workflow,
            "ref": identity.ref, "sha": identity.sha, "run_id": identity.run_id,
            "run_attempt": identity.run_attempt, "job_id": identity.job_id,
            "status": identity.status,
        }, expected_sha=identity.sha)
    except Exception as error:
        raise BuilderRejected("authenticated broker identity does not match release policy") from error


def _archive_from_dispatch_response(response: dict[str, object], identity: AuthenticatedRun,
                                    expected_bundle_sha256: str) -> BrokerFetchedArchive:
    """Validate the exact response fields emitted by the trusted dispatcher."""
    if (not isinstance(response, dict) or response.get("operation") != "stage"
            or response.get("sourceSha") != identity.sha
            or response.get("repository") != identity.repository
            or response.get("workflow") != identity.workflow
            or response.get("ref") != identity.ref
            or response.get("status") != identity.status
            or str(response.get("runId")) != identity.run_id
            or response.get("runAttempt") != identity.run_attempt
            or str(response.get("jobId")) != identity.job_id
            or response.get("archiveSha256") != expected_bundle_sha256
            or not isinstance(expected_bundle_sha256, str)
            or not re.fullmatch(r"[0-9a-f]{64}", expected_bundle_sha256)
            or not isinstance(response.get("archiveBase64"), str)):
        raise BuilderRejected("trusted dispatcher source archive identity is invalid")
    encoded = response["archiveBase64"]
    max_encoded_bytes = 4 * ((MAX_ARCHIVE_COMPRESSED_BYTES + 2) // 3)
    if len(encoded) > max_encoded_bytes:
        raise BuilderRejected("trusted dispatcher source archive encoding exceeds the size limit")
    try:
        archive = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError) as error:
        raise BuilderRejected("trusted dispatcher source archive encoding is invalid") from error
    if (not archive or len(archive) > MAX_ARCHIVE_COMPRESSED_BYTES
            or hashlib.sha256(archive).hexdigest() != expected_bundle_sha256):
        raise BuilderRejected("trusted dispatcher source archive digest is invalid")
    return BrokerFetchedArchive(identity.sha, expected_bundle_sha256, archive)
def _read_manifest(result_dir: Path, *, owner_uid: int) -> dict[str, object]:
    _trusted_directory(result_dir, uid=owner_uid)
    path = result_dir / MANIFEST_NAME
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != owner_uid or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) not in (0o440, 0o600) or info.st_size > 16 * 1024 * 1024):
            raise BuilderRejected("dependency build manifest inode is unsafe")
        raw = os.read(fd, info.st_size + 1)
        if len(raw) != info.st_size or os.fstat(fd).st_mtime_ns != info.st_mtime_ns:
            raise BuilderRejected("dependency build manifest changed while reading")
    finally:
        os.close(fd)
    import json
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BuilderRejected("dependency build manifest is malformed") from error
    if not isinstance(value, dict):
        raise BuilderRejected("dependency build manifest is malformed")
    return value


def _verify_candidate(manifest: dict[str, object], result_dir: Path, source: Path,
                      expected_sha: str, owner_uid: int) -> Path:
    # The smoke fields are builder claims only. This disconnected consumer
    # does not execute candidate code; it must not be wired into promotion
    # until an isolated verifier runs against the materialized snapshot.
    payload = result_dir / "payload"
    if (manifest.get("schema") != 1 or manifest.get("requested_commit_sha") != expected_sha
            or manifest.get("exact_sha_provenance_verified") is not False
            or manifest.get("source_provenance") != "broker-attestation-required"
            or manifest.get("builder") != "credential-free-systemd-proposal-v1"
            or manifest.get("pnpm_version") != "11.7.0"
            or manifest.get("lifecycle_scripts") != "disabled"
            or manifest.get("runtime_ready") is not False
            or manifest.get("smoke_checks") != EXPECTED_SMOKE
            or manifest.get("symlink_validation") != "portable-contained"):
        raise BuilderRejected("dependency candidate manifest does not match broker policy")
    lockfiles = manifest.get("lockfiles")
    expected_locks = {
        "pnpm-lock.yaml": sha256_file(source / "pnpm-lock.yaml"),
        "vps-workers/pnpm-lock.yaml": sha256_file(source / "vps-workers" / "pnpm-lock.yaml"),
    }
    if lockfiles != expected_locks:
        raise BuilderRejected("dependency candidate lockfile hashes do not match verified source")
    _trusted_directory(payload, uid=owner_uid)
    for current, directories, files in os.walk(payload, followlinks=False):
        for name in directories + files:
            info = (Path(current) / name).lstat()
            if info.st_uid != owner_uid or (not stat.S_ISLNK(info.st_mode) and info.st_mode & 0o022):
                raise BuilderRejected("dependency candidate ownership or permissions are unsafe")
    entries, expanded = validate_payload(payload)
    if manifest.get("entries") != entries or manifest.get("expanded_bytes") != expanded:
        raise BuilderRejected("dependency candidate manifest does not describe its payload")
    if set(os.listdir(payload)) != {"web", "root"}:
        raise BuilderRejected("dependency candidate payload layout is invalid")
    if not (payload / "web" / "node_modules").is_dir() or not (payload / "root" / "node_modules").is_dir():
        raise BuilderRejected("dependency candidate is missing a required runtime dependency tree")
    return payload


def build_and_install_dependencies(
    dispatcher_response: dict[str, object],
    identity: AuthenticatedRun,
    *,
    source_snapshot: BrokerFrozenSourceSnapshot,
    expected_bundle_sha256: str,
    result_root: Path,
    release_root: Path,
    builder: Callable[[str, str], tuple[dict[str, object], Path]],
    owner_uid: int = 0,
) -> dict[str, object]:
    """Build from the archive associated with an authenticated run and stage it.

    The caller must pass the direct fixed-dispatcher result after GitHub/OIDC
    verification and a snapshot made from those exact archive bytes by a
    constrained extractor, then frozen before this call. The snapshot object
    and SHA marker are consistency checks, not authentication. This function
    does not extract untrusted bytes as root or make a candidate launchable.
    """
    identity = _validated_identity(identity)
    archive = _archive_from_dispatch_response(dispatcher_response, identity, expected_bundle_sha256)
    result_root = Path(result_root)
    result_pin = pin_result_root(result_root, owner_uid=owner_uid)
    pinned_source: PinnedSourceSnapshot | None = None
    manifest: dict[str, object] | None = None
    result_dir: Path | None = None
    try:
        pinned_source = _validate_source_snapshot(source_snapshot, archive, identity, owner_uid=owner_uid)
        source = pinned_source.path
        manifest, result_dir = builder(str(source), identity.sha)
        result_pin.verify_unchanged()
        result_dir = Path(result_dir)
        if result_dir.parent != result_root or result_dir.is_symlink():
            raise BuilderRejected("dependency candidate is outside the fixed result root")
        manifest_file = _read_manifest(result_dir, owner_uid=owner_uid)
        if manifest_file != manifest:
            raise BuilderRejected("dependency candidate returned manifest does not match its persisted manifest")
        payload = _verify_candidate(manifest_file, result_dir, source, identity.sha, owner_uid)
        # A successful builder result is not accepted if the pinned snapshot
        # changed or its pathname was replaced while the builder ran.
        pinned_source.verify_unchanged()
        result_pin.verify_unchanged()
        install_payload(payload, release_root, owner_uid=owner_uid)
        return {
            "source_sha": identity.sha,
            "lockfiles": manifest_file["lockfiles"],
            "builder_smoke_claims": manifest_file["smoke_checks"],
            "installed_dependency_roots": ["apps/web/node_modules", "node_modules"],
        }
    finally:
        try:
            if result_dir is not None and result_dir.parent == result_root:
                result_pin.verify_unchanged()
                _remove_tree(result_dir)
        finally:
            if pinned_source is not None:
                pinned_source.close()
            result_pin.close()


__all__ = ["build_and_install_dependencies"]
