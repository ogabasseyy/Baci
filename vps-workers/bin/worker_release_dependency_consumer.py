"""Fail-closed, disconnected consumer for broker-authenticated dependency builds.

This module is deliberately not wired into release dispatch. It accepts the
authenticated identity produced by the broker, extracts the associated
GitHub archive into a private immutable snapshot, verifies the builder's
root-owned manifest and payload, then materializes contained symlinks as
regular files before adding dependencies to a frozen incoming release.
"""
from __future__ import annotations

import base64
import hashlib
import io
import os
import re
import shutil
import stat
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from worker_release_archive import extract_github_tarball
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

EXPECTED_SMOKE = {"web_tsx": "passed", "worker_dotenv": "passed"}


@dataclass(frozen=True)
class BrokerFetchedArchive:
    """Bytes and identity rechecked from the fixed root-dispatcher response.

    This value is only a local integrity wrapper. Authenticity is established
    by the trusted broker call site: its fixed dispatcher fetches the GitHub
    tarball URL for the authenticated SHA and checks the returned digest
    against the requested bundle digest. Never construct it from a user value.
    """

    source_sha: str
    archive_sha256: str
    data: bytes


def _trusted_directory(path: Path, *, uid: int, writable_mask: int = 0o022) -> None:
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != uid or info.st_mode & writable_mask):
        raise BuilderRejected("dependency integration directory is not trusted")


def _freeze_source_tree(root: Path) -> None:
    for current, directories, files in os.walk(root, topdown=False, followlinks=False):
        for name in files:
            path = Path(current) / name
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_nlink != 1:
                raise BuilderRejected("verified archive source contains an unsafe file")
            os.chmod(path, 0o550 if info.st_mode & 0o111 else 0o440, follow_symlinks=False)
        for name in directories:
            path = Path(current) / name
            info = path.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid():
                raise BuilderRejected("verified archive source contains an unsafe directory")
            os.chmod(path, 0o550, follow_symlinks=False)
        os.chmod(current, 0o550, follow_symlinks=False)


def _remove_tree(path: Path) -> None:
    """Make root-owned private directories removable, then use safe rmtree."""
    if not path.exists() and not path.is_symlink():
        return
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid():
        raise BuilderRejected("private integration cleanup target changed")
    for current, directories, _files in os.walk(path, topdown=True, followlinks=False):
        os.chmod(current, 0o700, follow_symlinks=False)
        for name in directories:
            child = Path(current) / name
            child_info = child.lstat()
            if stat.S_ISDIR(child_info.st_mode):
                os.chmod(child, 0o700, follow_symlinks=False)
    if not shutil.rmtree.avoids_symlink_attacks:
        raise BuilderRejected("safe descriptor-based integration cleanup is unavailable")
    shutil.rmtree(path)


def _source_from_archive(archive: BrokerFetchedArchive, identity: AuthenticatedRun,
                         temp_root: Path) -> Path:
    if (not isinstance(archive, BrokerFetchedArchive) or archive.source_sha != identity.sha
            or not SHA_RE.fullmatch(archive.source_sha)
            or not re.fullmatch(r"[0-9a-f]{64}", archive.archive_sha256)
            or not isinstance(archive.data, bytes) or not archive.data
            or len(archive.data) > MAX_ARCHIVE_COMPRESSED_BYTES
            or hashlib.sha256(archive.data).hexdigest() != archive.archive_sha256):
        raise BuilderRejected("verified source archive contract is invalid")
    identity = _validated_identity(identity)
    _trusted_directory(temp_root, uid=os.geteuid())
    source = Path(tempfile.mkdtemp(prefix=f"{identity.sha}.", dir=temp_root))
    try:
        extract_github_tarball(io.BytesIO(archive.data), str(source))
        marker = source / ".baci-source-sha"
        if os.path.lexists(marker):
            raise BuilderRejected("source archive contains the reserved provenance marker")
        fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o440)
        try:
            payload = (identity.sha + "\n").encode("ascii")
            if os.write(fd, payload) != len(payload):
                raise BuilderRejected("source provenance marker write failed")
            os.fsync(fd)
        finally:
            os.close(fd)
        _freeze_source_tree(source)
        return source
    except BaseException:
        _remove_tree(source)
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
    try:
        archive = base64.b64decode(response["archiveBase64"], validate=True)
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
    expected_bundle_sha256: str,
    source_temp_root: Path,
    result_root: Path,
    release_root: Path,
    builder: Callable[[str, str], tuple[dict[str, object], Path]],
    owner_uid: int = 0,
) -> dict[str, object]:
    """Build from the archive associated with an authenticated run and stage it.

    The caller must pass the direct result from the fixed root-owned dispatcher
    after GitHub/OIDC verification, while holding the lifecycle release lock,
    and after freezing the source release tree. The SHA marker below only
    informs the builder; it does not authenticate the archive. This function
    itself never contacts GitHub and does not make a candidate launchable.
    """
    identity = _validated_identity(identity)
    archive = _archive_from_dispatch_response(dispatcher_response, identity, expected_bundle_sha256)
    _trusted_directory(result_root, uid=owner_uid, writable_mask=0o077)
    source = _source_from_archive(archive, identity, source_temp_root)
    manifest: dict[str, object] | None = None
    result_dir: Path | None = None
    try:
        manifest, result_dir = builder(str(source), identity.sha)
        result_dir = Path(result_dir)
        if result_dir.parent != result_root or result_dir.is_symlink():
            raise BuilderRejected("dependency candidate is outside the fixed result root")
        manifest_file = _read_manifest(result_dir, owner_uid=owner_uid)
        if manifest_file != manifest:
            raise BuilderRejected("dependency candidate returned manifest does not match its persisted manifest")
        payload = _verify_candidate(manifest_file, result_dir, source, identity.sha, owner_uid)
        install_payload(payload, release_root, owner_uid=owner_uid)
        return {
            "source_sha": identity.sha,
            "lockfiles": manifest_file["lockfiles"],
            "builder_smoke_claims": manifest_file["smoke_checks"],
            "installed_dependency_roots": ["apps/web/node_modules", "node_modules"],
        }
    finally:
        try:
            _remove_tree(source)
        except FileNotFoundError:
            pass
        if result_dir is not None and result_dir.parent == result_root:
            _remove_tree(result_dir)


__all__ = ["build_and_install_dependencies"]
