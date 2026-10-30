"""Root-owned mount targets for isolated runtime-verifier candidate views."""
from __future__ import annotations

import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path
from worker_release_runtime_view_journal import (
    RuntimeViewJournalRejected, RuntimeViewRecord, remove_runtime_view_record, verify_runtime_view_record,
    write_runtime_view_record,
)
from worker_release_runtime_identity import RuntimeIdentityRejected, runtime_verifier_identity

VIEW_ROOT = Path("/var/lib/baci-worker-runtime-views")
UNIT_RE = re.compile(r"^baci-worker-runtime-[0-9a-f]{16}-[0-9a-f]{12}-[01]\.service$")
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


class RuntimeViewRejected(RuntimeError):
    """The runtime candidate mountpoint cannot be safely managed."""


def _require_dir(fd: int, *, mode: int, owner_uid: int = 0, owner_gid: int = 0) -> os.stat_result:
    info = os.fstat(fd)
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid or info.st_gid != owner_gid
            or stat.S_IMODE(info.st_mode) != mode):
        raise RuntimeViewRejected("runtime view directory ownership or mode is unsafe")
    return info


def _open_view_root(view_root: Path) -> int:
    if not view_root.is_absolute() or view_root != Path(os.path.normpath(str(view_root))):
        raise RuntimeViewRejected("runtime view root is not normalized")
    current_fd = os.open("/", DIR_FLAGS)
    try:
        for component in view_root.parts[1:-1]:
            child_fd = os.open(component, DIR_FLAGS, dir_fd=current_fd)
            info = os.fstat(child_fd)
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != 0
                    or info.st_mode & 0o022):
                os.close(child_fd)
                raise RuntimeViewRejected("runtime view ancestor is untrusted")
            os.close(current_fd)
            current_fd = child_fd
        fd = os.open(view_root.name, DIR_FLAGS, dir_fd=current_fd)
        try:
            _require_dir(fd, mode=0o711)
            return fd
        except BaseException:
            os.close(fd)
            raise
    finally:
        os.close(current_fd)


@dataclass
class RuntimeView:
    unit: str
    path: Path
    candidate_path: Path
    root_fd: int
    unit_fd: int
    mountpoint_fd: int
    root_identity: tuple[int, int]
    unit_identity: tuple[int, int]
    candidate_identity: tuple[int, int]
    record: RuntimeViewRecord
    closed: bool = False

    def verify_target(self) -> None:
        if self.closed:
            raise RuntimeViewRejected("runtime view is closed")
        parent_fd = os.open(self.path.parent.parent, DIR_FLAGS)
        try:
            _require_dir(self.root_fd, mode=0o711)
            _require_dir(self.unit_fd, mode=0o711)
            root_info = os.stat(self.path.parent.name, dir_fd=parent_fd, follow_symlinks=False)
            unit_info = os.stat(self.unit, dir_fd=self.root_fd, follow_symlinks=False)
            candidate_info = os.stat("candidate", dir_fd=self.unit_fd, follow_symlinks=False)
            pinned_candidate = os.fstat(self.mountpoint_fd)
            if ((root_info.st_dev, root_info.st_ino) != self.root_identity
                    or (unit_info.st_dev, unit_info.st_ino) != self.unit_identity
                    or (candidate_info.st_dev, candidate_info.st_ino) != self.candidate_identity
                    or (pinned_candidate.st_dev, pinned_candidate.st_ino) != self.candidate_identity
                    or set(os.listdir(self.unit_fd)) != {"candidate"}):
                raise RuntimeViewRejected("runtime view target changed before bind")
            verify_runtime_view_record(self.root_fd, self.record)
            _require_dir(self.mountpoint_fd, mode=0o700)
            if os.listdir(self.mountpoint_fd):
                raise RuntimeViewRejected("runtime view mountpoint is not empty")
        finally:
            os.close(parent_fd)

    def cleanup(self) -> None:
        if self.closed:
            raise RuntimeViewRejected("runtime view is already closed")
        try:
            _require_dir(self.root_fd, mode=0o711)
            _require_dir(self.unit_fd, mode=0o711)
            parent_fd = os.open(self.path.parent.parent, DIR_FLAGS)
            try:
                named_root = os.stat(self.path.parent.name, dir_fd=parent_fd,
                                     follow_symlinks=False)
            finally:
                os.close(parent_fd)
            root = os.fstat(self.root_fd)
            unit = os.fstat(self.unit_fd)
            named_unit = os.stat(self.unit, dir_fd=self.root_fd, follow_symlinks=False)
            if ((named_root.st_dev, named_root.st_ino) != self.root_identity
                    or (root.st_dev, root.st_ino) != self.root_identity
                    or (unit.st_dev, unit.st_ino) != self.unit_identity
                    or (named_unit.st_dev, named_unit.st_ino) != self.unit_identity):
                raise RuntimeViewRejected("runtime view path identity changed")
            verify_runtime_view_record(self.root_fd, self.record)
            candidate = os.fstat(self.mountpoint_fd)
            named_candidate = os.stat("candidate", dir_fd=self.unit_fd, follow_symlinks=False)
            if ((candidate.st_dev, candidate.st_ino) != self.candidate_identity
                    or (named_candidate.st_dev, named_candidate.st_ino) != self.candidate_identity
                    or os.listdir(self.mountpoint_fd)):
                raise RuntimeViewRejected("runtime view mountpoint changed or is not empty")
            os.rmdir("candidate", dir_fd=self.unit_fd)
            os.fsync(self.unit_fd)
            os.close(self.mountpoint_fd)
            self.mountpoint_fd = -1
            os.close(self.unit_fd)
            self.unit_fd = -1
            os.rmdir(self.unit, dir_fd=self.root_fd)
            os.fsync(self.root_fd)
            remove_runtime_view_record(self.root_fd, self.record)
        finally:
            self.close()

    def abandon(self) -> None:
        """Close descriptors while retaining the empty mountpoint for recovery."""
        self.close()

    def close(self) -> None:
        if not self.closed:
            if self.unit_fd >= 0:
                os.close(self.unit_fd)
            if self.mountpoint_fd >= 0:
                os.close(self.mountpoint_fd)
            os.close(self.root_fd)
            self.closed = True

    def __enter__(self) -> "RuntimeView":
        return self

    def __exit__(self, *_exc) -> None:
        self.cleanup()


def create_runtime_view(unit: str, *, candidate_path: Path, fence_digest: str,
                        runtime_uid: int,
                        candidate_identity: tuple[int, int],
                        view_root: Path = VIEW_ROOT) -> RuntimeView:
    """Create the exact root-owned mountpoint; caller cleans only after unit drain proof."""
    if (os.geteuid() != 0 or not UNIT_RE.fullmatch(unit)
            or not re.fullmatch(r"[0-9a-f]{64}", fence_digest)
            or type(runtime_uid) is not int or runtime_uid <= 0
            or not isinstance(candidate_path, Path)
            or type(candidate_identity) is not tuple or len(candidate_identity) != 2
            or any(type(value) is not int or value <= 0 for value in candidate_identity)):
        raise RuntimeViewRejected("runtime view requires root and a transaction-bound unit")
    try:
        expected_uid, _gid = runtime_verifier_identity()
    except RuntimeIdentityRejected as error:
        raise RuntimeViewRejected("runtime verifier identity is not isolated") from error
    if runtime_uid != expected_uid:
        raise RuntimeViewRejected("runtime view UID is outside fixed verifier policy")
    root_fd = _open_view_root(view_root)
    unit_fd = -1
    mountpoint_fd = -1
    unit_identity = None
    view_candidate_identity = None
    record = None
    try:
        root_info = os.fstat(root_fd)
        candidate_named = os.stat(candidate_path, follow_symlinks=False)
        if (not stat.S_ISDIR(candidate_named.st_mode)
                or (candidate_named.st_dev, candidate_named.st_ino) != candidate_identity):
            raise RuntimeViewRejected("pinned candidate path changed before view journaling")
        try:
            record = write_runtime_view_record(
                root_fd, unit=unit, fence_digest=fence_digest,
                runtime_uid=runtime_uid,
                candidate_path=candidate_path, candidate_identity=candidate_identity,
                view_root_identity=(root_info.st_dev, root_info.st_ino),
            )
        except FileExistsError as error:
            raise RuntimeViewRejected("runtime view transaction already exists") from error
        except RuntimeViewJournalRejected as error:
            raise RuntimeViewRejected("runtime view candidate binding is invalid") from error
        try:
            os.mkdir(unit, 0o711, dir_fd=root_fd)
            os.fsync(root_fd)
        except FileExistsError as error:
            raise RuntimeViewRejected("runtime view transaction already exists") from error
        unit_named = os.stat(unit, dir_fd=root_fd, follow_symlinks=False)
        unit_identity = (unit_named.st_dev, unit_named.st_ino)
        unit_fd = os.open(unit, DIR_FLAGS, dir_fd=root_fd)
        unit_info = _require_dir(unit_fd, mode=0o711)
        os.mkdir("candidate", 0o700, dir_fd=unit_fd)
        os.fsync(unit_fd)
        mountpoint_fd = os.open("candidate", DIR_FLAGS, dir_fd=unit_fd)
        candidate_info = _require_dir(mountpoint_fd, mode=0o700)
        view_candidate_identity = (candidate_info.st_dev, candidate_info.st_ino)
        return RuntimeView(
            unit=unit, path=view_root / unit, candidate_path=view_root / unit / "candidate",
            root_fd=root_fd, unit_fd=unit_fd, mountpoint_fd=mountpoint_fd,
            root_identity=(root_info.st_dev, root_info.st_ino),
            unit_identity=(unit_info.st_dev, unit_info.st_ino),
            candidate_identity=view_candidate_identity,
            record=record,
        )
    except BaseException:
        if mountpoint_fd >= 0:
            try:
                os.close(mountpoint_fd)
            except OSError:
                pass
        if unit_fd >= 0 and view_candidate_identity is not None:
            try:
                info = os.stat("candidate", dir_fd=unit_fd, follow_symlinks=False)
                if (info.st_dev, info.st_ino) == view_candidate_identity:
                    candidate_fd = os.open("candidate", DIR_FLAGS, dir_fd=unit_fd)
                    try:
                        if not os.listdir(candidate_fd):
                            os.rmdir("candidate", dir_fd=unit_fd)
                    finally:
                        os.close(candidate_fd)
            except OSError:
                pass
        if unit_fd >= 0:
            try:
                info = os.fstat(unit_fd)
                if unit_identity == (info.st_dev, info.st_ino) and not os.listdir(unit_fd):
                    os.close(unit_fd)
                    unit_fd = -1
                    os.rmdir(unit, dir_fd=root_fd)
            except OSError:
                pass
        if record is not None:
            try:
                os.stat(unit, dir_fd=root_fd, follow_symlinks=False)
            except FileNotFoundError:
                try:
                    remove_runtime_view_record(root_fd, record)
                except (OSError, RuntimeViewRejected, RuntimeViewJournalRejected):
                    pass
            except OSError:
                pass
        if unit_fd >= 0:
            os.close(unit_fd)
        os.close(root_fd)
        raise


__all__ = ["RuntimeView", "RuntimeViewRecord", "RuntimeViewRejected", "VIEW_ROOT",
           "create_runtime_view"]
