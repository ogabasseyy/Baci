"""Fenced, transactional worker release pointer operations.

This module deliberately accepts an already authenticated broker identity. It
does not parse caller-controlled shell commands or perform network requests.
The caller must hold the returned exclusive lock for the whole transaction.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import fcntl
import os
from pathlib import Path
import re
from typing import Callable, Iterator


SHA_RE = re.compile(r"^[0-9a-f]{40}$")
ID_RE = re.compile(r"^[1-9][0-9]{0,19}$")


class LifecycleRejected(Exception):
    """A release lifecycle request failed closed."""


class ReleaseHealthRejected(LifecycleRejected):
    """Health failed after the prior pointer was successfully restored."""


class ReleaseHealthProbeError(LifecycleRejected):
    """The health probe errored, but the prior pointer was restored."""


@dataclass(frozen=True)
class AuthenticatedRun:
    """Identity fields emitted only after broker OIDC and GitHub API checks."""

    repository: str
    workflow: str
    ref: str
    sha: str
    run_id: str
    run_attempt: int
    job_id: str
    status: str

    @classmethod
    def from_broker(cls, value: object, *, expected_sha: str) -> "AuthenticatedRun":
        if not isinstance(value, dict):
            raise LifecycleRejected("authenticated run identity is required")
        expected = {
            "repository": "ogabasseyy/Baci",
            "workflow": ".github/workflows/production-release.yml",
            "ref": "refs/heads/main",
            "status": "in_progress",
        }
        for key, wanted in expected.items():
            if value.get(key) != wanted:
                raise LifecycleRejected("authenticated run identity does not match policy")
        sha = value.get("sha")
        run_id = str(value.get("run_id", ""))
        job_id = str(value.get("job_id", ""))
        attempt = value.get("run_attempt")
        if not isinstance(sha, str) or not SHA_RE.fullmatch(sha) or sha != expected_sha:
            raise LifecycleRejected("source SHA does not match authenticated run")
        if not ID_RE.fullmatch(run_id) or not ID_RE.fullmatch(job_id):
            raise LifecycleRejected("authenticated run identifiers are invalid")
        if not isinstance(attempt, int) or isinstance(attempt, bool) or attempt < 1:
            raise LifecycleRejected("authenticated run attempt is invalid")
        return cls(**expected, sha=sha, run_id=run_id, run_attempt=attempt, job_id=job_id)

    def fence(self) -> dict[str, object]:
        return {
            "repository": self.repository,
            "workflow": self.workflow,
            "ref": self.ref,
            "sha": self.sha,
            "run_id": self.run_id,
            "run_attempt": self.run_attempt,
            "job_id": self.job_id,
        }


@contextmanager
def release_lock(lock_path: str | Path, *, expected_owner_uid: int = 0) -> Iterator[None]:
    """Take a nonblocking exclusive lock on a fixed, trusted lock file."""
    path = Path(lock_path)
    fd = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        metadata = os.fstat(fd)
        if not os.path.isfile(path) or metadata.st_uid != expected_owner_uid or metadata.st_mode & 0o022:
            raise LifecycleRejected("release lock ownership or mode is invalid")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise LifecycleRejected("another release operation holds the lock") from None
        yield
    finally:
        os.close(fd)


def _current_target(current_link: Path, releases_root: Path) -> str | None:
    try:
        target = os.readlink(current_link)
    except FileNotFoundError:
        return None
    if not SHA_RE.fullmatch(target):
        raise LifecycleRejected("current release pointer is invalid")
    release = releases_root / target
    if not release.is_dir() or release.is_symlink():
        raise LifecycleRejected("current release target is unavailable")
    return target


def _atomic_pointer(current_link: Path, releases_root: Path, sha: str) -> None:
    if not SHA_RE.fullmatch(sha):
        raise LifecycleRejected("release SHA is invalid")
    release = releases_root / sha
    if not release.is_dir() or release.is_symlink():
        raise LifecycleRejected("staged release is unavailable")
    temp_link = current_link.parent / f".current.{os.getpid()}.tmp"
    try:
        os.symlink(sha, temp_link)
        os.replace(temp_link, current_link)
        directory_fd = os.open(current_link.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        try:
            os.unlink(temp_link)
        except FileNotFoundError:
            pass


def _unlink_pointer(current_link: Path) -> None:
    current_link.unlink(missing_ok=True)
    directory_fd = os.open(current_link.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


@contextmanager
def _quiescence_operation(lease: object | None) -> Iterator[None]:
    """Require the lease's mutation guard even for direct lifecycle callers."""
    operation = getattr(lease, "operation", None)
    require_active = getattr(lease, "require_active", None)
    if not callable(operation) or not callable(require_active):
        raise LifecycleRejected("trusted worker quiescence lease is required")
    try:
        with operation():
            require_active()
            yield
    except LifecycleRejected:
        raise
    except Exception as error:
        raise LifecycleRejected("trusted worker quiescence lease operation failed") from error


def promote_release(
    *, current_link: str | Path, releases_root: str | Path, identity: AuthenticatedRun,
    health_check: Callable[[str], bool], quiescence_lease: object | None = None,
) -> dict[str, object]:
    """Switch the release pointer only while the broker holds the fixed quiescence lease."""
    with _quiescence_operation(quiescence_lease):
        current = Path(current_link)
        root = Path(releases_root)
        previous = _current_target(current, root)
        if previous is None:
            raise LifecycleRejected("prior release pointer is unavailable")
        _atomic_pointer(current, root, identity.sha)
        return {"ok": True, "sha": identity.sha, "previous_sha": previous}


def check_release_health(
    *, current_link: str | Path, releases_root: str | Path, identity: AuthenticatedRun,
    health_check: Callable[[str], bool],
) -> dict[str, object]:
    """Health is accepted only while the authenticated SHA is still current."""
    current = _current_target(Path(current_link), Path(releases_root))
    if current != identity.sha:
        raise LifecycleRejected("active release SHA changed during health check")
    if health_check(identity.sha) is not True:
        raise LifecycleRejected("release health check failed")
    result: dict[str, object] = {"ok": True, "sha": identity.sha, "healthy": True}
    result.update(identity.fence())
    return result


def rollback_release(
    *, current_link: str | Path, releases_root: str | Path, identity: AuthenticatedRun,
    promoted_sha: str, previous_sha: str, quiescence_lease: object | None = None,
) -> dict[str, object]:
    """Restore only the recorded prior SHA while the fixed quiescence lease is active."""
    with _quiescence_operation(quiescence_lease):
        current = Path(current_link)
        root = Path(releases_root)
        if _current_target(current, root) != promoted_sha or promoted_sha != identity.sha:
            raise LifecycleRejected("active release is not owned by this authenticated run")
        if not isinstance(previous_sha, str) or not SHA_RE.fullmatch(previous_sha):
            raise LifecycleRejected("recorded prior release is invalid")
        _atomic_pointer(current, root, previous_sha)
        return {"ok": True, "sha": previous_sha}
