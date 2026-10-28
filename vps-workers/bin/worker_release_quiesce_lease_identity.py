"""Validation helpers for trusted release identity and installed lease files."""
from __future__ import annotations
import os
import stat
from pathlib import Path
from typing import Pattern

def identity_key(identity: object, *, id_re: Pattern[str], sha_re: Pattern[str], rejected: type[Exception]) -> tuple[str, int, str]:
    if not isinstance(identity, dict):
        raise rejected("authenticated release fence is required")
    run_id = str(identity.get("run_id", ""))
    attempt = identity.get("run_attempt")
    sha = identity.get("sha")
    if not id_re.fullmatch(run_id) or not isinstance(attempt, int) or isinstance(attempt, bool) or attempt < 1 or not isinstance(sha, str) or not sha_re.fullmatch(sha):
        raise rejected("authenticated release fence is invalid")
    return run_id, attempt, sha

def verify_installed_helper(helper_path: str, support_paths: tuple[str, ...], *, trusted_uid: int, rejected: type[Exception]) -> None:
    """Verify fixed helper ancestry and file modes before executing any shell."""
    for index, raw_path in enumerate((helper_path, *support_paths)):
        path = Path(raw_path)
        try:
            metadata = path.lstat()
        except OSError:
            raise rejected("trusted quiescence helper is unavailable") from None
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != trusted_uid or metadata.st_mode & 0o022:
            raise rejected("trusted quiescence helper ownership or mode is invalid")
        if index == 0 and not metadata.st_mode & 0o111:
            raise rejected("trusted quiescence lease helper is not executable")

    # Reject symlinked or writable parent directories. The whole install path
    # is fixed and each parent is checked, not only the final executable.
    parent = Path(helper_path).parent
    while str(parent) not in ("/", "."):
        try:
            metadata = parent.lstat()
        except OSError:
            raise rejected("trusted quiescence helper ancestry is unavailable") from None
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid not in {0, trusted_uid, os.geteuid()} or metadata.st_mode & 0o022:
            raise rejected("trusted quiescence helper ancestry is invalid")
        parent = parent.parent
