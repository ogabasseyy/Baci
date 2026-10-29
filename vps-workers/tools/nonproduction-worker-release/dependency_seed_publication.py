"""Atomic no-replace directory publication for the disconnected seed prototype."""
from __future__ import annotations

import ctypes
import errno
import os

from worker_release_dependency_artifacts import BuilderRejected


def rename_noreplace(parent_fd: int, source: str, destination: str) -> None:
    """Atomically publish a sibling directory without replacing any target."""
    for component in (source, destination):
        if (not component or component in {".", ".."} or "/" in component
                or "\\" in component or "\x00" in component):
            raise BuilderRejected("seed publication name is malformed")
    libc = ctypes.CDLL(None, use_errno=True)
    if hasattr(libc, "renameat2"):
        function = libc.renameat2
        function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                             ctypes.c_char_p, ctypes.c_uint]
        function.restype = ctypes.c_int
        result = function(parent_fd, os.fsencode(source), parent_fd,
                          os.fsencode(destination), 1)
    elif hasattr(libc, "renameatx_np"):
        function = libc.renameatx_np
        function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                             ctypes.c_char_p, ctypes.c_uint]
        function.restype = ctypes.c_int
        result = function(parent_fd, os.fsencode(source), parent_fd,
                          os.fsencode(destination), 0x00000004)
    else:
        raise BuilderRejected("atomic no-replace directory rename is unavailable")
    if result != 0:
        error = ctypes.get_errno()
        if error == errno.EEXIST:
            raise BuilderRejected("immutable source seed already exists")
        raise OSError(error, "atomic seed publication failed")
