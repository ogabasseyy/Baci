"""Safe staging of the fixed egress client modules for disposable systemd tests."""
from __future__ import annotations

import os
from pathlib import Path
import stat

FIXTURE_MODULES = (
    "vps-workers/tools/nonproduction-worker-release/worker_release_egress_bridge.py",
    "vps-workers/tools/nonproduction-worker-release/worker_release_egress_broker.py",
    "vps-workers/tools/nonproduction-worker-release/worker_release_egress_network.py",
    "vps-workers/tools/nonproduction-worker-release/worker_release_egress_protocol.py",
    "vps-workers/tools/nonproduction-worker-release/worker_release_egress_systemd_client.py",
    "vps-workers/tools/nonproduction-worker-release/worker_release_egress_tls.py",
    "vps-workers/bin/worker_release_bounded_process.py",
)
MAX_FIXTURE_FILE_BYTES = 256 * 1024
_DIR_FLAGS = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)


def _open_absolute_directory(path: Path) -> int:
    fd = os.open("/", _DIR_FLAGS)
    try:
        for component in path.absolute().parts[1:]:
            child = os.open(component, _DIR_FLAGS, dir_fd=fd)
            info = os.fstat(child)
            if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o022:
                os.close(child)
                raise RuntimeError("fixture source path is writable by another identity")
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def _open_relative_directory(root_fd: int, components: tuple[str, ...]) -> int:
    fd = os.dup(root_fd)
    try:
        for component in components:
            child = os.open(component, _DIR_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def stage_fixture_modules(source_root: Path, destination_root: Path, *,
                           owner_uid: int = 0, owner_gid: int = 0) -> Path:
    """Copy only fixed root-readable fixture modules into a protected temp tree."""
    if os.geteuid() != owner_uid:
        raise RuntimeError("fixture staging caller identity is invalid")
    source_fd = _open_absolute_directory(Path(source_root))
    destination_root.mkdir(mode=0o711)
    os.chown(destination_root, owner_uid, owner_gid)
    os.chmod(destination_root, 0o711)
    destination_fd = _open_absolute_directory(destination_root)
    try:
        for relative_text in FIXTURE_MODULES:
            relative = Path(relative_text)
            source_parent = _open_relative_directory(source_fd, relative.parts[:-1])
            try:
                source_file = os.open(relative.name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
                                      dir_fd=source_parent)
            finally:
                os.close(source_parent)
            destination_parent = os.dup(destination_fd)
            try:
                for component in relative.parts[:-1]:
                    created = False
                    try:
                        os.mkdir(component, 0o755, dir_fd=destination_parent)
                        created = True
                    except FileExistsError:
                        pass
                    child = os.open(component, _DIR_FLAGS, dir_fd=destination_parent)
                    info = os.fstat(child)
                    if created:
                        os.fchown(child, owner_uid, owner_gid)
                        os.fchmod(child, 0o755)
                        info = os.fstat(child)
                    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid
                            or info.st_gid != owner_gid):
                        os.close(child)
                        raise RuntimeError("staged fixture directory is unsafe")
                    if info.st_mode & 0o022:
                        os.close(child)
                        raise RuntimeError("staged fixture directory is writable by another identity")
                    os.close(destination_parent)
                    destination_parent = child
                try:
                    before = os.fstat(source_file)
                    if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                            or before.st_mode & 0o022 or before.st_size > MAX_FIXTURE_FILE_BYTES):
                        raise RuntimeError("fixture module source is unsafe")
                    output = os.open(relative.name,
                                     os.O_WRONLY | os.O_CREAT | os.O_EXCL
                                     | getattr(os, "O_NOFOLLOW", 0),
                                     0o444, dir_fd=destination_parent)
                    try:
                        total = 0
                        while chunk := os.read(source_file, 64 * 1024):
                            total += len(chunk)
                            if total > MAX_FIXTURE_FILE_BYTES:
                                raise RuntimeError("fixture module exceeds its size bound")
                            view = memoryview(chunk)
                            while view:
                                written = os.write(output, view)
                                if written <= 0:
                                    raise RuntimeError("fixture module copy was short")
                                view = view[written:]
                        after = os.fstat(source_file)
                        if (total != before.st_size
                                or (before.st_dev, before.st_ino, before.st_size,
                                    before.st_mtime_ns, before.st_ctime_ns)
                                != (after.st_dev, after.st_ino, after.st_size,
                                    after.st_mtime_ns, after.st_ctime_ns)):
                            raise RuntimeError("fixture module changed while staging")
                        os.fchown(output, owner_uid, owner_gid)
                        os.fchmod(output, 0o444)
                        os.fsync(output)
                    finally:
                        os.close(output)
                finally:
                    os.close(source_file)
            finally:
                os.close(destination_parent)
        os.fsync(destination_fd)
    finally:
        os.close(source_fd)
        os.close(destination_fd)
    return destination_root / FIXTURE_MODULES[4]
