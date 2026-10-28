"""Safe extraction of untrusted GitHub source archives."""
import os
import tarfile
from typing import BinaryIO

from worker_release_broker_common import BrokerProtocolError, MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_EXPANDED_BYTES

def _safe_relative_parts(name: str) -> tuple[str, ...]:
    if not isinstance(name, str) or not name or len(name) > 1024 or name.startswith("/") or "\\" in name:
        raise BrokerProtocolError("unsafe archive path")
    trimmed = name[:-1] if name.endswith("/") else name
    parts = tuple(trimmed.split("/"))
    if not parts or any(part in ("", ".", "..") for part in parts):
        raise BrokerProtocolError("unsafe archive path")
    return parts


def _open_directory_chain(root_fd: int, parts: tuple[str, ...], *, create: bool) -> int:
    current_fd = os.dup(root_fd)
    try:
        for part in parts:
            if create:
                try:
                    os.mkdir(part, 0o750, dir_fd=current_fd)
                except FileExistsError:
                    pass
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current_fd)
            os.close(current_fd)
            current_fd = next_fd
        return current_fd
    except Exception:
        os.close(current_fd)
        raise


def extract_github_tarball(archive: BinaryIO, destination: str, *, max_expanded_bytes: int = MAX_ARCHIVE_EXPANDED_BYTES) -> int:
    """Extract only regular files/directories into a fresh destination safely.

    GitHub tarballs have one generated top-level directory; that directory is
    removed. Files are opened relative to directory descriptors with O_NOFOLLOW.
    """
    root_fd = os.open(destination, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    seen: set[tuple[str, ...]] = set()
    top_level: str | None = None
    expanded = 0
    count = 0
    total_entries = 0
    try:
        with tarfile.open(fileobj=archive, mode="r|gz") as tar:
            for member in tar:
                total_entries += 1
                if total_entries > MAX_ARCHIVE_ENTRIES:
                    raise BrokerProtocolError("archive has too many entries")
                raw_parts = _safe_relative_parts(member.name)
                if top_level is None:
                    top_level = raw_parts[0]
                if raw_parts[0] != top_level:
                    raise BrokerProtocolError("archive has multiple roots")
                parts = raw_parts[1:]
                if not parts:
                    if not member.isdir():
                        raise BrokerProtocolError("archive root is not a directory")
                    continue
                if member.isdir():
                    if parts in seen:
                        raise BrokerProtocolError("duplicate archive entry")
                    directory_fd = _open_directory_chain(root_fd, parts, create=True)
                    os.close(directory_fd)
                    seen.add(parts)
                    count += 1
                    continue
                if not member.isreg() or getattr(member, "sparse", None):
                    raise BrokerProtocolError("archive contains a link or special file")
                if parts in seen or member.size < 0:
                    raise BrokerProtocolError("duplicate or invalid archive file")
                expanded += member.size
                if expanded > max_expanded_bytes:
                    raise BrokerProtocolError("expanded archive exceeds size limit")
                parent_fd = _open_directory_chain(root_fd, parts[:-1], create=True)
                try:
                    file_fd = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent_fd)
                    try:
                        source = tar.extractfile(member)
                        if source is None:
                            raise BrokerProtocolError("archive file has no body")
                        remaining = member.size
                        while remaining:
                            chunk = source.read(min(1024 * 1024, remaining))
                            if not chunk:
                                raise BrokerProtocolError("truncated archive file")
                            view = memoryview(chunk)
                            while view:
                                written = os.write(file_fd, view)
                                view = view[written:]
                            remaining -= len(chunk)
                        mode = 0o750 if member.mode & 0o111 else 0o640
                        os.fchmod(file_fd, mode)
                    finally:
                        os.close(file_fd)
                finally:
                    os.close(parent_fd)
                seen.add(parts)
                count += 1
    finally:
        os.close(root_fd)
    if count == 0:
        raise BrokerProtocolError("archive contains no files")
    return count
