"""Fixed Node/pnpm runtime paths and independent installed-runtime verification."""
from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
from pathlib import Path

RUNTIME_ROOT = Path("/usr/local/lib/baci-worker-runtime")
RELEASE_NAME = "node-v24.22.2-linux-x64_pnpm-11.7.0"
RELEASE_ROOT = RUNTIME_ROOT / "releases" / RELEASE_NAME
NODE_VERSION = "v24.22.2"
PNPM_VERSION = "11.7.0"
NODE_PATH = RELEASE_ROOT / "node" / "bin" / "node"
PNPM_PATH = RELEASE_ROOT / "pnpm" / "bin" / "pnpm.cjs"
NODE_RUNTIME = NODE_PATH
PNPM_RUNTIME = PNPM_PATH
MANIFEST_NAME = "runtime-manifest.json"
NODE_ARCHIVE_SHA256 = "48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75"
PNPM_ARCHIVE_SHA256 = "deafa7ec98a1218b6a047289b92fbe2395c1e22d3495bb711653013218ee15ee"
PNPM_ARCHIVE_SHA512_B64 = "GcyFLBIMcSV2DyRD7mvgyltA+fUFmN4aCaHxd1A+AQ5Xwjx3ZG4B52HeWb+HT7IqM5jDOrlpH8E+uUa28PTWIA=="
MAX_MANIFEST_BYTES = 4096


class PinnedRuntimeRejected(RuntimeError):
    """The fixed runtime is absent, mutable, or does not match pinned artifacts."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            raise PinnedRuntimeRejected("pinned runtime file type is unsafe")
        while True:
            block = os.read(fd, 1024 * 1024)
            if not block:
                break
            digest.update(block)
        after = os.fstat(fd)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
                before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size,
                                        after.st_mtime_ns, after.st_ctime_ns):
            raise PinnedRuntimeRejected("pinned runtime file changed while hashing")
    finally:
        os.close(fd)
    return digest.hexdigest()


def _trusted_directory(path: Path, *, exact_mode: int | None = None) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError as error:
        raise PinnedRuntimeRejected("pinned runtime directory is unavailable") from error
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022
            or (exact_mode is not None and stat.S_IMODE(info.st_mode) != exact_mode)):
        raise PinnedRuntimeRejected("pinned runtime directory ownership or mode is unsafe")
    return info


def _trusted_chain(path: Path) -> None:
    current = Path(path.absolute())
    while True:
        _trusted_directory(current)
        if current == current.parent:
            return
        current = current.parent


def _trusted_file(path: Path, *, expected_mode: int) -> os.stat_result:
    _trusted_chain(path.parent)
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        raise PinnedRuntimeRejected("pinned runtime file is unavailable") from error
    try:
        info = os.fstat(fd)
        named = path.lstat()
    finally:
        os.close(fd)
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
            or stat.S_IMODE(info.st_mode) != expected_mode
            or (info.st_dev, info.st_ino) != (named.st_dev, named.st_ino)):
        raise PinnedRuntimeRejected("pinned runtime file ownership or mode is unsafe")
    return info


def runtime_paths(root: Path = RUNTIME_ROOT) -> tuple[Path, Path, Path]:
    release = Path(root) / "releases" / RELEASE_NAME
    return release / "node/bin/node", release / "pnpm/bin/pnpm.cjs", release / MANIFEST_NAME


def verify_installed_runtime(*, root: Path = RUNTIME_ROOT,
                             runner=subprocess.run) -> tuple[Path, Path]:
    """Verify fixed files, exact artifact provenance and actual runtime versions."""
    node, pnpm, manifest_path = runtime_paths(root)
    release = manifest_path.parent
    _trusted_chain(release)
    _trusted_directory(release, exact_mode=0o755)
    node_info = _trusted_file(node, expected_mode=0o755)
    pnpm_info = _trusted_file(pnpm, expected_mode=0o644)
    manifest_info = _trusted_file(manifest_path, expected_mode=0o444)
    if manifest_info.st_size > MAX_MANIFEST_BYTES:
        raise PinnedRuntimeRejected("pinned runtime manifest exceeds bound")
    fd = os.open(manifest_path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        raw = os.read(fd, MAX_MANIFEST_BYTES + 1)
        after = os.fstat(fd)
    finally:
        os.close(fd)
    manifest_named = manifest_path.lstat()
    if ((manifest_info.st_dev, manifest_info.st_ino, manifest_info.st_size,
         manifest_info.st_mtime_ns, manifest_info.st_ctime_ns) !=
        (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
            or (manifest_named.st_dev, manifest_named.st_ino) !=
               (manifest_info.st_dev, manifest_info.st_ino)
            or len(raw) != manifest_info.st_size):
        raise PinnedRuntimeRejected("pinned runtime manifest changed while reading")
    try:
        manifest = json.loads(raw.decode("utf-8"))
    except (UnicodeError, ValueError) as error:
        raise PinnedRuntimeRejected("pinned runtime manifest is malformed") from error
    expected = {
        "schema": 1, "nodeVersion": NODE_VERSION, "pnpmVersion": PNPM_VERSION,
        "nodeArchiveSha256": NODE_ARCHIVE_SHA256,
        "pnpmArchiveSha256": PNPM_ARCHIVE_SHA256,
        "nodeSha256": _sha256(node), "pnpmSha256": _sha256(pnpm),
    }
    if not isinstance(manifest, dict) or manifest != expected:
        raise PinnedRuntimeRejected("installed runtime provenance does not match fixed pins")
    for path, before in ((node, node_info), (pnpm, pnpm_info)):
        after = _trusted_file(path, expected_mode=stat.S_IMODE(before.st_mode))
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
                before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size,
                                        after.st_mtime_ns, after.st_ctime_ns):
            raise PinnedRuntimeRejected("pinned runtime file changed during verification")
    for command, expected_output in (
            ((str(node), "--version"), NODE_VERSION),
            ((str(node), str(pnpm), "--version"), PNPM_VERSION)):
        try:
            result = runner(command, check=False, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            text=True, timeout=10, cwd=str(release),
                            env={"PATH": "/usr/bin:/bin", "HOME": "/nonexistent",
                                 "LC_ALL": "C", "COREPACK_HOME": "/nonexistent"})
        except (OSError, subprocess.SubprocessError) as error:
            raise PinnedRuntimeRejected("pinned runtime version probe failed") from error
        if result.returncode != 0 or result.stdout.strip() != expected_output:
            raise PinnedRuntimeRejected("pinned runtime version does not match fixed pin")
    return node, pnpm
