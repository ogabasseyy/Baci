"""Descriptor-pinned cleanup and promotion for dependency build scratch."""
from __future__ import annotations

import os
import shutil
import stat
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected


def remove_verified_scratch_subtree(scratch: Path, relative: str, *, owner_uid: int) -> None:
    """Remove one fixed builder-owned tree without following links or mount paths.

    This is used only after the pnpm process that populated the subtree has
    exited. The fixed allowlist prevents a caller from turning reclamation into
    arbitrary path deletion; descriptor-relative rmtree pins the final name.
    """
    allowed = {"source", "source/node_modules", "pnpm-store", "pnpm-cache"}
    if (relative not in allowed or owner_uid <= 0
            or not shutil.rmtree.avoids_symlink_attacks):
        raise BuilderRejected("scratch cleanup request is not safe")
    parts = Path(relative).parts
    if (not parts or Path(relative).is_absolute()
            or any(part in ("", ".", "..") for part in parts)):
        raise BuilderRejected("scratch cleanup path is invalid")
    root_fd = os.open(scratch, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
    parent_fd = root_fd
    opened_parent_fds: list[int] = []
    try:
        root_info = os.fstat(root_fd)
        if (root_info.st_uid != owner_uid or stat.S_IMODE(root_info.st_mode) != 0o700):
            raise BuilderRejected("scratch cleanup root ownership or mode is unsafe")
        for component in parts[:-1]:
            child_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY
                               | getattr(os, "O_NOFOLLOW", 0), dir_fd=parent_fd)
            child_info = os.fstat(child_fd)
            parent_info = os.fstat(parent_fd)
            if (child_info.st_uid != owner_uid or child_info.st_dev != root_info.st_dev
                    or child_info.st_dev != parent_info.st_dev
                    or child_info.st_mode & 0o022):
                os.close(child_fd)
                raise BuilderRejected("scratch cleanup parent ownership or mount is unsafe")
            opened_parent_fds.append(child_fd)
            parent_fd = child_fd
        try:
            before = os.stat(parts[-1], dir_fd=parent_fd, follow_symlinks=False)
        except OSError as exc:
            raise BuilderRejected("scratch cleanup target is unavailable") from exc
        parent_info = os.fstat(parent_fd)
        if (not stat.S_ISDIR(before.st_mode) or before.st_uid != owner_uid
                or before.st_dev != root_info.st_dev or before.st_dev != parent_info.st_dev
                or before.st_mode & 0o022):
            raise BuilderRejected("scratch cleanup target ownership or type is unsafe")
        child_fd = os.open(parts[-1], os.O_RDONLY | os.O_DIRECTORY
                           | getattr(os, "O_NOFOLLOW", 0), dir_fd=parent_fd)
        try:
            opened = os.fstat(child_fd)
            named = os.stat(parts[-1], dir_fd=parent_fd, follow_symlinks=False)
            if ((before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino)
                    or (before.st_dev, before.st_ino) != (named.st_dev, named.st_ino)):
                raise BuilderRejected("scratch cleanup target changed before removal")
        finally:
            os.close(child_fd)
        shutil.rmtree(parts[-1], dir_fd=parent_fd)
        try:
            os.stat(parts[-1], dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            return
        raise BuilderRejected("scratch cleanup target remained after removal")
    except OSError as exc:
        raise BuilderRejected("scratch cleanup could not prove safe removal") from exc
    finally:
        for fd in reversed(opened_parent_fds):
            os.close(fd)
        os.close(root_fd)


def reclaim_workspace_node_modules(scratch: Path, *, owner_uid: int) -> int:
    """Remove every pnpm install tree under the fixed source workspace.

    Workspace packages can each have their own node_modules directory. Walk
    using pinned directory descriptors so cleanup does not assume a single
    pnpm layout and never traverses a link or a mount point.
    """
    if owner_uid <= 0 or not shutil.rmtree.avoids_symlink_attacks:
        raise BuilderRejected("workspace cleanup is not supported safely")
    root_fd = os.open(scratch, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
    source_fd = -1
    removed = 0
    try:
        scratch_info = os.fstat(root_fd)
        if scratch_info.st_uid != owner_uid or stat.S_IMODE(scratch_info.st_mode) != 0o700:
            raise BuilderRejected("workspace cleanup root ownership or mode is unsafe")
        source_fd = os.open("source", os.O_RDONLY | os.O_DIRECTORY
                            | getattr(os, "O_NOFOLLOW", 0), dir_fd=root_fd)
        source_info = os.fstat(source_fd)
        if (source_info.st_uid != owner_uid or source_info.st_dev != scratch_info.st_dev
                or source_info.st_mode & 0o022):
            raise BuilderRejected("workspace cleanup source ownership or mount is unsafe")

        def visit(directory_fd: int) -> None:
            nonlocal removed
            before_dir = os.fstat(directory_fd)
            for name in sorted(os.listdir(directory_fd)):
                info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                if name == "node_modules":
                    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid
                            or info.st_dev != scratch_info.st_dev or info.st_mode & 0o022):
                        raise BuilderRejected("workspace install tree ownership or type is unsafe")
                    child_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY
                                       | getattr(os, "O_NOFOLLOW", 0), dir_fd=directory_fd)
                    try:
                        opened = os.fstat(child_fd)
                        named = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                        if ((info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino)
                                or (info.st_dev, info.st_ino) != (named.st_dev, named.st_ino)):
                            raise BuilderRejected("workspace install tree changed before removal")
                    finally:
                        os.close(child_fd)
                    shutil.rmtree(name, dir_fd=directory_fd)
                    try:
                        os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                    except FileNotFoundError:
                        removed += 1
                        continue
                    raise BuilderRejected("workspace install tree remained after removal")
                if stat.S_ISDIR(info.st_mode):
                    if (info.st_uid != owner_uid or info.st_dev != scratch_info.st_dev
                            or info.st_mode & 0o022):
                        raise BuilderRejected("workspace directory ownership or mount is unsafe")
                    child_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY
                                       | getattr(os, "O_NOFOLLOW", 0), dir_fd=directory_fd)
                    try:
                        opened = os.fstat(child_fd)
                        if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
                            raise BuilderRejected("workspace directory changed during cleanup")
                        visit(child_fd)
                    finally:
                        os.close(child_fd)
            after_dir = os.fstat(directory_fd)
            if (before_dir.st_dev, before_dir.st_ino) != (after_dir.st_dev, after_dir.st_ino):
                raise BuilderRejected("workspace changed during cleanup")

        visit(source_fd)
        if removed == 0:
            raise BuilderRejected("workspace install trees were not found for reclamation")
        named_source = os.stat("source", dir_fd=root_fd, follow_symlinks=False)
        if (named_source.st_dev, named_source.st_ino) != (source_info.st_dev, source_info.st_ino):
            raise BuilderRejected("workspace path changed during cleanup")
        return removed
    except OSError as exc:
        raise BuilderRejected("workspace install cleanup could not prove safe removal") from exc
    finally:
        if source_fd >= 0:
            os.close(source_fd)
        os.close(root_fd)


def move_worker_install_tree(scratch: Path, *, owner_uid: int) -> None:
    """Atomically promote the isolated worker install into candidate payload."""
    if owner_uid <= 0:
        raise BuilderRejected("worker install promotion identity is invalid")
    root_fd = os.open(scratch, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
    opened: list[int] = []
    try:
        root_info = os.fstat(root_fd)
        if root_info.st_uid != owner_uid or stat.S_IMODE(root_info.st_mode) != 0o700:
            raise BuilderRejected("worker install promotion root ownership or mode is unsafe")

        def open_parent(parts: tuple[str, ...]) -> int:
            parent_fd = root_fd
            for component in parts:
                fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY
                             | getattr(os, "O_NOFOLLOW", 0), dir_fd=parent_fd)
                info = os.fstat(fd)
                parent_info = os.fstat(parent_fd)
                if (info.st_uid != owner_uid or info.st_dev != root_info.st_dev
                        or info.st_dev != parent_info.st_dev or info.st_mode & 0o022):
                    os.close(fd)
                    raise BuilderRejected("worker install promotion directory is unsafe")
                opened.append(fd)
                parent_fd = fd
            return parent_fd

        source_parent = open_parent(("source", "vps-workers"))
        target_parent = open_parent(("payload", "root"))
        source_info = os.stat("node_modules", dir_fd=source_parent, follow_symlinks=False)
        if (not stat.S_ISDIR(source_info.st_mode) or source_info.st_uid != owner_uid
                or source_info.st_dev != root_info.st_dev or source_info.st_mode & 0o022):
            raise BuilderRejected("worker install output ownership or type is unsafe")
        source_fd = os.open("node_modules", os.O_RDONLY | os.O_DIRECTORY
                            | getattr(os, "O_NOFOLLOW", 0), dir_fd=source_parent)
        try:
            opened_source = os.fstat(source_fd)
            named_source = os.stat("node_modules", dir_fd=source_parent, follow_symlinks=False)
            if ((source_info.st_dev, source_info.st_ino) !=
                    (opened_source.st_dev, opened_source.st_ino)
                    or (source_info.st_dev, source_info.st_ino) !=
                    (named_source.st_dev, named_source.st_ino)):
                raise BuilderRejected("worker install output changed before promotion")
        finally:
            os.close(source_fd)
        try:
            os.stat("node_modules", dir_fd=target_parent, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise BuilderRejected("worker candidate destination already exists")
        os.rename("node_modules", "node_modules", src_dir_fd=source_parent,
                  dst_dir_fd=target_parent)
        moved = os.stat("node_modules", dir_fd=target_parent, follow_symlinks=False)
        if (moved.st_dev, moved.st_ino) != (source_info.st_dev, source_info.st_ino):
            raise BuilderRejected("worker install promotion changed the candidate inode")
        try:
            os.stat("node_modules", dir_fd=source_parent, follow_symlinks=False)
        except FileNotFoundError:
            return
        raise BuilderRejected("worker install output remained after promotion")
    except OSError as exc:
        raise BuilderRejected("worker install promotion could not prove safe movement") from exc
    finally:
        for fd in reversed(opened):
            os.close(fd)
        os.close(root_fd)



__all__ = ["move_worker_install_tree", "reclaim_workspace_node_modules", "remove_verified_scratch_subtree"]
