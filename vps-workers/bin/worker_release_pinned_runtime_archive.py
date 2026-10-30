"""Bounded extraction of the fixed Node and pnpm release archives."""
from __future__ import annotations

import base64
import hashlib
import io
import os
import stat
import tarfile
from pathlib import Path, PurePosixPath

from worker_release_pinned_runtime import PinnedRuntimeRejected

MAX_NODE_ARCHIVE = 64 * 1024 * 1024
MAX_PNPM_ARCHIVE = 16 * 1024 * 1024
MAX_NODE_MEMBER = 128 * 1024 * 1024
MAX_PNPM_MEMBERS = 600
MAX_PNPM_EXPANDED = 32 * 1024 * 1024
NODE_MEMBER = "node-v24.22.2-linux-x64/bin/node"


class RuntimeInstallRejected(PinnedRuntimeRejected):
    pass


def read_pinned_archive(path: Path, *, expected_sha256: str, max_bytes: int,
                        expected_sha512_b64: str | None = None,
                        owner_uid: int = 0) -> bytes:
    fd = -1
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != owner_uid or before.st_nlink != 1
                or before.st_size <= 0 or before.st_size > max_bytes or before.st_mode & 0o022):
            raise RuntimeInstallRejected("runtime archive ownership or size is unsafe")
        chunks = []
        remaining = before.st_size
        while remaining:
            block = os.read(fd, min(1024 * 1024, remaining))
            if not block:
                raise RuntimeInstallRejected("runtime archive changed while reading")
            chunks.append(block)
            remaining -= len(block)
        after = os.fstat(fd)
        if ((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
             before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size,
                                     after.st_mtime_ns, after.st_ctime_ns)):
            raise RuntimeInstallRejected("runtime archive changed while reading")
        payload = b"".join(chunks)
        if hashlib.sha256(payload).hexdigest() != expected_sha256:
            raise RuntimeInstallRejected("runtime archive hash differs from fixed pin")
        if (expected_sha512_b64 is not None
                and base64.b64encode(hashlib.sha512(payload).digest()).decode("ascii")
                != expected_sha512_b64):
            raise RuntimeInstallRejected("runtime archive integrity differs from fixed pin")
        return payload
    except RuntimeInstallRejected:
        raise
    except OSError as error:
        raise RuntimeInstallRejected("runtime archive is unavailable") from error
    finally:
        if fd >= 0:
            os.close(fd)


def safe_relative(name: str, *, prefix: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if (path.is_absolute() or not path.parts or path.parts[0] != prefix
            or any(part in {"", ".", ".."} for part in path.parts)
            or "\\" in name or "\x00" in name):
        raise RuntimeInstallRejected("runtime archive contains an unsafe member name")
    return path


def extract_node(archive: bytes, destination: Path) -> None:
    try:
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:xz") as source:
            members = source.getmembers()
            candidates = [member for member in members if member.name == NODE_MEMBER]
            member = candidates[0] if len(candidates) == 1 else None
            if (len(members) > 7000 or len(candidates) != 1
                    or member is None or not member.isreg() or member.size <= 0
                    or member.size > MAX_NODE_MEMBER):
                raise RuntimeInstallRejected("Node archive lacks the fixed regular binary")
            stream = source.extractfile(member)
            if stream is None:
                raise RuntimeInstallRejected("Node archive binary cannot be read")
            target = destination / "node/bin/node"
            target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o755)
            try:
                remaining = member.size
                while remaining:
                    block = stream.read(min(1024 * 1024, remaining))
                    if not block or len(block) > remaining:
                        raise RuntimeInstallRejected("Node archive binary size is inconsistent")
                    view = memoryview(block)
                    while view:
                        count = os.write(fd, view)
                        if count <= 0:
                            raise RuntimeInstallRejected("Node binary extraction was incomplete")
                        view = view[count:]
                    remaining -= len(block)
                if stream.read(1):
                    raise RuntimeInstallRejected("Node archive binary exceeds declared size")
                os.fchown(fd, 0, 0)
                os.fchmod(fd, 0o755)
                os.fsync(fd)
            finally:
                os.close(fd)
    except RuntimeInstallRejected:
        raise
    except (tarfile.TarError, OSError, EOFError) as error:
        raise RuntimeInstallRejected("Node archive is malformed") from error


def extract_pnpm(archive: bytes, destination: Path) -> None:
    try:
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as source:
            members = source.getmembers()
            if len(members) > MAX_PNPM_MEMBERS:
                raise RuntimeInstallRejected("pnpm archive has too many members")
            seen: set[str] = set()
            total = 0
            for member in members:
                relative = safe_relative(member.name, prefix="package")
                if (not member.isreg() or member.pax_headers or member.name in seen
                        or member.size < 0):
                    raise RuntimeInstallRejected("pnpm archive contains a link or special member")
                seen.add(member.name)
                total += member.size
                if total > MAX_PNPM_EXPANDED:
                    raise RuntimeInstallRejected("pnpm archive exceeds fixed extraction bound")
                stream = source.extractfile(member)
                if stream is None:
                    raise RuntimeInstallRejected("pnpm archive member cannot be read")
                payload = stream.read(member.size + 1)
                if len(payload) != member.size:
                    raise RuntimeInstallRejected("pnpm archive member size is inconsistent")
                relative_parts = relative.parts[1:]
                if not relative_parts:
                    raise RuntimeInstallRejected("pnpm archive member has no package-relative path")
                target = destination / "pnpm" / Path(*relative_parts)
                target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
                mode = 0o755 if member.mode & 0o111 else 0o644
                fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
                try:
                    view = memoryview(payload)
                    while view:
                        count = os.write(fd, view)
                        if count <= 0:
                            raise RuntimeInstallRejected("pnpm member extraction was incomplete")
                        view = view[count:]
                    os.fchown(fd, 0, 0)
                    os.fchmod(fd, mode)
                    os.fsync(fd)
                finally:
                    os.close(fd)
            if "package/bin/pnpm.cjs" not in seen:
                raise RuntimeInstallRejected("pnpm archive lacks its fixed Node entrypoint")
    except RuntimeInstallRejected:
        raise
    except (tarfile.TarError, OSError, EOFError) as error:
        raise RuntimeInstallRejected("pnpm archive is malformed") from error
