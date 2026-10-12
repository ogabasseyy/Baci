import hashlib
import os
import shutil
import stat
import uuid
from pathlib import Path, PurePosixPath

from artifact_validation import Refused, artifact_entries


def directory_paths(entries: list[dict[str, str]]) -> list[PurePosixPath]:
    directories = {PurePosixPath('apps'), PurePosixPath('apps/web'), PurePosixPath('apps/web/.next'),
                   PurePosixPath('apps/web/.next/static'), PurePosixPath('apps/web/public'), PurePosixPath('node_modules')}
    for entry in entries:
        parent = PurePosixPath(entry['path']).parent
        while parent != PurePosixPath('.'):
            directories.add(parent)
            parent = parent.parent
    return sorted(directories, key=lambda path: (len(path.parts), path.as_posix()))


def open_source(root: Path) -> int:
    descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW)
    if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
        os.close(descriptor)
        raise Refused('Artifact root is not a directory.')
    return descriptor


def open_parent(root_descriptor: int, relative: PurePosixPath) -> tuple[int, str]:
    descriptor = os.dup(root_descriptor)
    try:
        for part in relative.parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return descriptor, relative.name
    except Exception:
        os.close(descriptor)
        raise


def write_all(descriptor: int, value: bytes) -> None:
    offset = 0
    while offset < len(value):
        offset += os.write(descriptor, value[offset:])


def copy_file(root_descriptor: int, target: Path, entry: dict[str, str]) -> None:
    relative = PurePosixPath(entry['path'])
    parent, name = open_parent(root_descriptor, relative)
    try:
        source = os.open(name, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW, dir_fd=parent)
    finally:
        os.close(parent)
    try:
        if not stat.S_ISREG(os.fstat(source).st_mode):
            raise Refused('Artifact file changed during copy.')
        target_path = target / relative
        destination = os.open(target_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | os.O_NOFOLLOW, 0o644)
        digest = hashlib.sha256()
        try:
            while chunk := os.read(source, 1024 * 1024):
                digest.update(chunk)
                write_all(destination, chunk)
        finally:
            os.close(destination)
        if digest.hexdigest() != entry['sha256']:
            raise Refused('Artifact file changed during copy.')
    finally:
        os.close(source)


def copy_link(root_descriptor: int, target: Path, entry: dict[str, str]) -> None:
    relative = PurePosixPath(entry['path'])
    parent, name = open_parent(root_descriptor, relative)
    try:
        if not stat.S_ISLNK(os.stat(name, dir_fd=parent, follow_symlinks=False).st_mode):
            raise Refused('Artifact symlink changed during copy.')
        if os.readlink(name, dir_fd=parent) != entry['target']:
            raise Refused('Artifact symlink changed during copy.')
    finally:
        os.close(parent)
    os.symlink(entry['target'], target / relative)


def protect_tree(root: Path) -> None:
    for path in [root, *root.rglob('*')]:
        if not path.is_symlink():
            os.chown(path, 0, 0)
            os.chmod(path, 0o755 if path.is_dir() else 0o644)


def copy_verified(source: Path, destination: Path, entries: list[dict[str, str]]) -> Path:
    if artifact_entries(source) != entries:
        raise Refused('Source does not match the reviewed full-artifact manifest.')
    candidate = destination.parent / f'.{destination.name}.new-{uuid.uuid4().hex}'
    if candidate.exists() or candidate.is_symlink():
        raise Refused('Candidate path already exists.')
    candidate.mkdir(mode=0o755)
    try:
        for directory in directory_paths(entries):
            (candidate / directory).mkdir(mode=0o755, exist_ok=True)
        root_descriptor = open_source(source)
        try:
            for entry in entries:
                if entry['type'] == 'file':
                    copy_file(root_descriptor, candidate, entry)
                else:
                    copy_link(root_descriptor, candidate, entry)
        finally:
            os.close(root_descriptor)
        protect_tree(candidate)
        if artifact_entries(candidate) != entries:
            raise Refused('Root-protected copy does not match the reviewed manifest.')
        return candidate
    except Exception:
        shutil.rmtree(candidate)
        raise
