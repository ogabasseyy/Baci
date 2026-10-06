#!/usr/bin/env python3
"""Owner-run placement of the checksummed funding deploy tree.

Runs as root from a staging directory holding the deploy tarball, its
manifest, and the pinned funding-service candidate. Verifies every hash,
then operates only on the verified bytes without re-opening staging
paths, extracts to a root-only temporary directory, re-verifies the manifest,
stages under /opt with explicit ownership and modes, renames atomically
into place, and proves the result with the candidate's own artifact
verification. Fresh installs only: refuses when the target exists.
Starts, enables, or reloads nothing.
"""

import argparse
import hashlib
import io
import json
import os
import shutil
import stat
import sys
import tarfile
import tempfile
from pathlib import Path
from types import ModuleType


TARBALL_SHA256 = "23966d993a2ca498292e6f620aff43b0c370fd4d8e8afa3530387215415050bd"
MANIFEST_SHA256 = "10b3c6049cb44eb19c5df1f150b0276fde6d7012cef6aa21e53e933080029f93"
CANDIDATE_SHA256 = "a110c5e305737110f9c5d5f047a07cbc5931c1b8f90d149a49c8a2cd1672f4f1"
TARBALL_NAME = "funding-deploy.tar.gz"
MANIFEST_NAME = "funding-deploy.manifest.json"
CANDIDATE_NAME = "funding-service-candidate.py"
ARTIFACT_ROOT = Path("/opt/baci-savings-funding")
STAGING_ROOT = Path("/opt/.baci-savings-funding-staging")
TEMP_PARENT = Path("/root")


class Refused(RuntimeError):
    pass


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def _pinned(path: Path, expected: str, label: str) -> bytes:
    try:
        content = path.read_bytes()
    except OSError as error:
        raise Refused(f"{label} is missing.") from error
    if hashlib.sha256(content).hexdigest() != expected:
        raise Refused(f"{label} hash differs.")
    return content


def _load_candidate(path: Path):
    content = _pinned(path, CANDIDATE_SHA256, "Funding service candidate")
    module = ModuleType("funding_service_candidate")
    module.__file__ = str(path)
    exec(compile(content, str(path), "exec"), module.__dict__)
    return module


def _is_environment_file(path: Path) -> bool:
    return path.name == ".env" or path.name.startswith(".env.")


def _verify_manifest(tree: Path, manifest: dict) -> int:
    if manifest.get("version") != 1 or not isinstance(manifest.get("files"), list):
        raise Refused("Deploy manifest is invalid.")
    checked = 0
    for entry in manifest["files"]:
        relative = entry.get("path", "")
        absolute = tree / relative
        if (
            not relative
            or not isinstance(relative, str)
            or Path(relative).is_absolute()
            or ".." in Path(relative).parts
        ):
            raise Refused("Deploy manifest entry is invalid.")
        if _is_environment_file(Path(relative)):
            raise Refused("Deploy manifest lists an environment file.")
        if entry.get("link"):
            if not absolute.is_symlink() or str(absolute.readlink()) != entry.get("target"):
                raise Refused("Deploy symlink differs.")
        else:
            if absolute.is_symlink() or not absolute.is_file():
                raise Refused("Deploy entry is missing.")
            if _hash_file(absolute) != entry.get("sha256"):
                raise Refused("Deploy entry differs.")
        checked += 1
    if checked != manifest.get("count"):
        raise Refused("Deploy entry count differs.")
    return checked


def _normalize_tree(root: Path) -> None:
    _normalize_entry(root)
    for current, directories, files in os.walk(root, followlinks=False):
        for name in (*directories, *files):
            _normalize_entry(Path(current) / name)


def _normalize_entry(path: Path) -> None:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise Refused("Staged artifact is unreadable.") from error
    if stat.S_ISLNK(metadata.st_mode):
        try:
            os.lchown(path, 0, 0)
        except OSError as error:
            raise Refused("Staged artifact ownership failed.") from error
        return
    try:
        os.chown(path, 0, 0, follow_symlinks=False)
        os.chmod(path, 0o755 if stat.S_ISDIR(metadata.st_mode) else 0o644, follow_symlinks=False)
    except OSError as error:
        raise Refused("Staged artifact permissions failed.") from error


def install(staging: Path) -> dict[str, object]:
    if os.geteuid() != 0:
        raise Refused("Owner-reviewed root execution is required.")
    tarball = staging / TARBALL_NAME
    manifest_path = staging / MANIFEST_NAME
    candidate_path = staging / CANDIDATE_NAME
    tarball_bytes = _pinned(tarball, TARBALL_SHA256, "Deploy tarball")
    manifest_bytes = _pinned(manifest_path, MANIFEST_SHA256, "Deploy manifest")
    candidate = _load_candidate(candidate_path)
    if candidate.ARTIFACT_ROOT != ARTIFACT_ROOT:
        raise Refused("Candidate artifact root differs.")
    candidate._verify_root_owned_ancestors(ARTIFACT_ROOT.parent, "Artifact path")
    for path in (ARTIFACT_ROOT, STAGING_ROOT):
        if path.exists() or path.is_symlink():
            raise Refused("Funding artifact target already exists.")
    manifest = json.loads(manifest_bytes)
    temporary = Path(tempfile.mkdtemp(prefix="funding-deploy-", dir=str(TEMP_PARENT)))
    try:
        with tarfile.open(fileobj=io.BytesIO(tarball_bytes), mode="r:gz") as archive:
            archive.extractall(temporary, filter="data")
        checked = _verify_manifest(temporary, manifest)
        shutil.copytree(temporary, STAGING_ROOT, symlinks=True)
        _normalize_tree(STAGING_ROOT)
        os.rename(STAGING_ROOT, ARTIFACT_ROOT)
    except Exception as error:
        shutil.rmtree(temporary, ignore_errors=True)
        shutil.rmtree(STAGING_ROOT, ignore_errors=True)
        if isinstance(error, Refused):
            raise
        raise Refused("Deploy staging failed.") from error
    shutil.rmtree(temporary, ignore_errors=True)
    try:
        candidate.verify_artifact()
    except Exception as error:
        shutil.rmtree(ARTIFACT_ROOT, ignore_errors=True)
        raise Refused("Placed artifact failed candidate verification.") from error
    return {"checked": checked, "tarballSha256": TARBALL_SHA256}


def main(arguments: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--install", action="store_true", required=True)
    parsed = parser.parse_args(arguments)
    try:
        result = install(Path.cwd())
    except (OSError, RuntimeError, ValueError):
        print("Funding artifact placement refused.", file=sys.stderr)
        return 1
    if parsed.install:
        print(json.dumps({"result": "placed", **result}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
