"""Remove only pnpm's temporary workspace pointer from the seed store."""
from __future__ import annotations

import os
import re
import stat
from pathlib import Path


class SeedNormalizationRejected(RuntimeError):
    """The temporary pnpm project index is not the exact expected shape."""


DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
PROJECT_KEY_RE = re.compile(r"^[0-9a-f]{32}$")


def _directory(fd: int, *, owner_uid: int, same_device: int | None = None) -> os.stat_result:
    info = os.fstat(fd)
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid
            or info.st_mode & 0o022
            or (same_device is not None and info.st_dev != same_device)):
        raise SeedNormalizationRejected("pnpm project-index directory is unsafe")
    return info


def normalize_temporary_project_index(store: Path, workspace: Path, *,
                                     owner_uid: int = 0,
                                     expected_subdirectories: tuple[str, ...] = ("vps-workers",)) -> int:
    """Remove only pnpm-generated pointers to the fixed workspace importers.

    pnpm 11.7 writes `v10/projects/<32-hex-key>` as relative symlinks to the
    importer roots. The temporary workspace is deleted after preverification,
    so these pointers cannot enter an immutable seed. Only the workspace root
    and explicitly enumerated importer directories are accepted; the publisher
    itself remains strict and rejects every symlink.
    """
    if owner_uid < 0 or not store.is_absolute() or not workspace.is_absolute():
        raise SeedNormalizationRejected("pnpm seed normalization paths are invalid")
    store_fd = workspace_fd = v10_fd = projects_fd = -1
    importer_fds: list[int] = []
    try:
        store_fd = os.open(store, DIRECTORY_FLAGS)
        store_info = _directory(store_fd, owner_uid=owner_uid)
        workspace_fd = os.open(workspace, DIRECTORY_FLAGS)
        workspace_info = _directory(workspace_fd, owner_uid=owner_uid)
        expected_importers = {(workspace_info.st_dev, workspace_info.st_ino)}
        if (not isinstance(expected_subdirectories, tuple)
                or any(not isinstance(part, str) or not part or part in {".", ".."}
                       or "/" in part or "\\" in part for part in expected_subdirectories)
                or len(set(expected_subdirectories)) != len(expected_subdirectories)):
            raise SeedNormalizationRejected("pnpm importer allowlist is malformed")
        for relative in expected_subdirectories:
            fd = os.open(relative, DIRECTORY_FLAGS, dir_fd=workspace_fd)
            info = _directory(fd, owner_uid=owner_uid, same_device=workspace_info.st_dev)
            importer_fds.append(fd)
            expected_importers.add((info.st_dev, info.st_ino))
        try:
            v10_fd = os.open("v10", DIRECTORY_FLAGS, dir_fd=store_fd)
        except FileNotFoundError as error:
            raise SeedNormalizationRejected("pnpm project-index is unavailable") from error
        v10_info = _directory(v10_fd, owner_uid=owner_uid, same_device=store_info.st_dev)
        try:
            projects_fd = os.open("projects", DIRECTORY_FLAGS, dir_fd=v10_fd)
        except FileNotFoundError as error:
            raise SeedNormalizationRejected("pnpm project-index is unavailable") from error
        projects_info = _directory(projects_fd, owner_uid=owner_uid,
                                   same_device=store_info.st_dev)
        names = os.listdir(projects_fd)
        if not names:
            raise SeedNormalizationRejected("pnpm project-index is missing expected importer pointers")
        if (len(names) != len(expected_importers)
                or any(PROJECT_KEY_RE.fullmatch(name) is None for name in names)):
            raise SeedNormalizationRejected("pnpm project-index contents are not the fixed importer set")
        observed_importers: set[tuple[int, int]] = set()
        pinned_links: list[tuple[str, os.stat_result]] = []
        for name in names:
            link_before = os.stat(name, dir_fd=projects_fd, follow_symlinks=False)
            if not stat.S_ISLNK(link_before.st_mode):
                raise SeedNormalizationRejected("pnpm project-index entry is not a symlink")
            target = os.readlink(name, dir_fd=projects_fd)
            if os.path.isabs(target) or not target:
                raise SeedNormalizationRejected("pnpm project-index target is not relative")
            try:
                target_info = os.stat(name, dir_fd=projects_fd, follow_symlinks=True)
            except OSError as error:
                raise SeedNormalizationRejected("pnpm project-index target is unavailable") from error
            target_identity = (target_info.st_dev, target_info.st_ino)
            if target_identity not in expected_importers or target_identity in observed_importers:
                raise SeedNormalizationRejected("pnpm project-index does not match fixed importers")
            observed_importers.add(target_identity)
            pinned_links.append((name, link_before))
        if observed_importers != expected_importers:
            raise SeedNormalizationRejected("pnpm project-index is missing a fixed importer pointer")
        # pnpm has exited; this root-owned directory is no longer writable by
        # the builder. Recheck each exact link inode immediately before unlink.
        named_projects = os.stat("projects", dir_fd=v10_fd, follow_symlinks=False)
        if ((named_projects.st_dev, named_projects.st_ino) !=
                (projects_info.st_dev, projects_info.st_ino)):
            raise SeedNormalizationRejected("pnpm project-index directory changed before normalization")
        for name, link_before in pinned_links:
            named_link = os.stat(name, dir_fd=projects_fd, follow_symlinks=False)
            if ((named_link.st_dev, named_link.st_ino) !=
                    (link_before.st_dev, link_before.st_ino)):
                raise SeedNormalizationRejected("pnpm project-index entry changed before normalization")
            os.unlink(name, dir_fd=projects_fd)
        if os.listdir(projects_fd):
            raise SeedNormalizationRejected("pnpm project-index changed during normalization")
        if (os.fstat(v10_fd).st_ino, os.fstat(v10_fd).st_dev) != (
                v10_info.st_ino, v10_info.st_dev):
            raise SeedNormalizationRejected("pnpm store version directory changed")
        return len(pinned_links)
    except SeedNormalizationRejected:
        raise
    except OSError as error:
        raise SeedNormalizationRejected("pnpm project-index normalization failed") from error
    finally:
        for fd in reversed(importer_fds):
            os.close(fd)
        for fd in (projects_fd, v10_fd, workspace_fd, store_fd):
            if fd >= 0:
                os.close(fd)


__all__ = ["SeedNormalizationRejected", "normalize_temporary_project_index"]
