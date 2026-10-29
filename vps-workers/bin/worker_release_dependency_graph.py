"""Materialize pnpm virtual-store dependency aliases as regular files."""
from __future__ import annotations

import json
import os
import re
import stat
from pathlib import Path
from typing import Callable

from worker_release_dependency_artifacts import BuilderRejected

_PACKAGE_NAME_RE = re.compile(r"^(?:@[a-z0-9._-]+/)?[a-zA-Z0-9._-]+$")


def _valid_package_name(name: object) -> bool:
    if not isinstance(name, str) or not _PACKAGE_NAME_RE.fullmatch(name):
        return False
    parts = name.split("/")
    return all(part not in ("", ".", "..") and len(part.encode("utf-8")) <= 255
               for part in parts) and len(name.encode("utf-8")) <= 512


def package_dependencies(source: Path) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Read bounded declared aliases; package contents remain opaque data."""
    manifest = source / "package.json"
    try:
        info = manifest.lstat()
    except FileNotFoundError:
        return (), ()
    try:
        if not stat.S_ISREG(info.st_mode) or info.st_size > 1024 * 1024:
            raise BuilderRejected("pnpm package manifest is unsafe")
        fd = os.open(manifest, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            opened = os.fstat(fd)
            if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                raise BuilderRejected("pnpm package manifest changed while reading")
            chunks = bytearray()
            while len(chunks) <= 1024 * 1024:
                block = os.read(fd, min(64 * 1024, 1024 * 1024 + 1 - len(chunks)))
                if not block:
                    break
                chunks.extend(block)
            after_fd = os.fstat(fd)
            after_path = manifest.lstat()
            if (len(chunks) > 1024 * 1024 or
                    (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns,
                     opened.st_ctime_ns) !=
                    (after_fd.st_dev, after_fd.st_ino, after_fd.st_size, after_fd.st_mtime_ns,
                     after_fd.st_ctime_ns) or
                    (info.st_dev, info.st_ino) != (after_path.st_dev, after_path.st_ino)):
                raise BuilderRejected("pnpm package manifest changed while reading")
        finally:
            os.close(fd)
        value = json.loads(bytes(chunks).decode("utf-8"))
    except (OSError, UnicodeError, ValueError) as error:
        raise BuilderRejected("pnpm package manifest is invalid") from error
    if not isinstance(value, dict):
        raise BuilderRejected("pnpm package manifest is invalid")
    dependencies: set[str] = set()
    optional: set[str] = set()
    for field, destination in (("dependencies", dependencies),
                              ("optionalDependencies", optional)):
        entries = value.get(field, {})
        if not isinstance(entries, dict):
            raise BuilderRejected("pnpm package manifest dependency map is invalid")
        for name in entries:
            if not _valid_package_name(name):
                raise BuilderRejected("pnpm package manifest dependency name is invalid")
            destination.add(name)
    peers = value.get("peerDependencies", {})
    peer_meta = value.get("peerDependenciesMeta", {})
    if not isinstance(peers, dict) or not isinstance(peer_meta, dict):
        raise BuilderRejected("pnpm package manifest peer map is invalid")
    required = dependencies - optional
    for name in peers:
        if not _valid_package_name(name):
            raise BuilderRejected("pnpm package manifest dependency name is invalid")
        if name in dependencies or name in optional:
            continue
        metadata = peer_meta.get(name, {})
        if not isinstance(metadata, dict):
            raise BuilderRejected("pnpm package manifest peer metadata is invalid")
        (optional if metadata.get("optional") is True else required).add(name)
    return tuple(sorted(required)), tuple(sorted(optional))


def node_modules_roots(path: Path, payload_root: Path) -> tuple[Path, ...]:
    roots: list[Path] = []
    for parent in path.parents:
        if parent.name == "node_modules":
            try:
                parent.relative_to(payload_root)
            except ValueError:
                continue
            roots.append(parent)
    return tuple(roots)


def materialize_package_dependencies(source: Path, destination: Path, payload_root: Path,
                                     budget: dict[str, int], tree_root: Path,
                                     materialized_root: Path,
                                     package_ancestors: frozenset[tuple[int, int]], *,
                                     materialize_directory: Callable,
                                     copy_file: Callable, max_entries: int) -> None:
    """Recreate dependency links from the package's pnpm virtual-store context.

    Pnpm places a package's dependency aliases beside its real package under a
    virtual-store ``node_modules`` directory. Flattening the package to a
    top-level alias loses that lookup context. Declared dependency aliases are
    copied beneath the new package path, bounded by the caller's shared budget.
    """
    package_info = source.lstat()
    inode = (package_info.st_dev, package_info.st_ino)
    if inode in package_ancestors:
        return
    dependency_roots = node_modules_roots(source, payload_root)
    if not dependency_roots:
        return
    target_modules = destination / "node_modules"
    next_ancestors = package_ancestors | {inode}
    required, optional = package_dependencies(source)
    dependencies = tuple(sorted(set(required) | set(optional)))
    if not dependencies:
        return
    if os.path.lexists(target_modules):
        info = target_modules.lstat()
        if not stat.S_ISDIR(info.st_mode):
            raise BuilderRejected("materialized package dependency directory is unsafe")
    else:
        budget["entries"] += 1
        if budget["entries"] > max_entries:
            raise BuilderRejected("materialized dependency candidate has too many entries")
        target_modules.mkdir(mode=0o700)
    os.chmod(target_modules, 0o700)
    for name in dependencies:
        source_dependency = next((root / name for root in dependency_roots
                                  if os.path.lexists(root / name)), None)
        if source_dependency is None:
            if name in required:
                raise BuilderRejected("pnpm required dependency alias is missing")
            continue
        alias_before = source_dependency.lstat()
        if not (stat.S_ISLNK(alias_before.st_mode) or stat.S_ISDIR(alias_before.st_mode)
                or stat.S_ISREG(alias_before.st_mode)):
            raise BuilderRejected("pnpm dependency alias is unsafe")
        alias_target = os.readlink(source_dependency) if stat.S_ISLNK(alias_before.st_mode) else None
        resolved = source_dependency.resolve(strict=True)
        alias_after = source_dependency.lstat()
        if ((alias_before.st_dev, alias_before.st_ino) !=
                (alias_after.st_dev, alias_after.st_ino) or
                (alias_target is not None and alias_target != os.readlink(source_dependency))):
            raise BuilderRejected("pnpm dependency alias changed while installing")
        try:
            resolved.relative_to(payload_root)
        except ValueError as error:
            raise BuilderRejected("dependency symlink escapes candidate payload") from error
        target = target_modules / name
        if os.path.lexists(target):
            continue
        cursor = target_modules
        for part in Path(name).parts[:-1]:
            cursor = cursor / part
            if not os.path.lexists(cursor):
                budget["entries"] += 1
                if budget["entries"] > max_entries:
                    raise BuilderRejected("materialized dependency candidate has too many entries")
                cursor.mkdir(mode=0o700)
            info = cursor.lstat()
            if not stat.S_ISDIR(info.st_mode):
                raise BuilderRejected("materialized package dependency directory is unsafe")
            os.chmod(cursor, 0o700)
        if resolved.is_dir():
            materialize_directory(resolved, target, payload_root, budget, frozenset(),
                                  tree_root, materialized_root, True, next_ancestors)
        elif resolved.is_file():
            copy_file(resolved, target, budget)
        else:
            raise BuilderRejected("dependency symlink target is not a regular file or directory")
    for current, directories, _files in os.walk(target_modules, topdown=False,
                                                  followlinks=False):
        for name in directories:
            child = Path(current) / name
            if child.is_symlink() or not child.is_dir():
                raise BuilderRejected("materialized package dependency directory is unsafe")
            os.chmod(child, 0o550)
        os.chmod(current, 0o550)
