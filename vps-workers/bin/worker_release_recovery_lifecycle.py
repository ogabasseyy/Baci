"""Restore only the prior SHA recorded by trusted release state."""
from pathlib import Path

from worker_release_lifecycle import LifecycleRejected, SHA_RE, _atomic_pointer, _current_target, _quiescence_operation


def restore_recorded_prior(*, current_link, releases_root, release_sha, previous_sha, quiescence_lease):
    if not SHA_RE.fullmatch(release_sha or "") or not SHA_RE.fullmatch(previous_sha or ""):
        raise LifecycleRejected("recorded worker recovery SHA is invalid")
    current_link = Path(current_link)
    releases_root = Path(releases_root)
    with _quiescence_operation(quiescence_lease):
        current = _current_target(current_link, releases_root)
        if current == previous_sha:
            return {"ok": True, "sha": previous_sha, "alreadyRestored": True}
        if current != release_sha:
            raise LifecycleRejected("active release does not match the durable recovery record")
        _atomic_pointer(current_link, releases_root, previous_sha)
        return {"ok": True, "sha": previous_sha, "alreadyRestored": False}
