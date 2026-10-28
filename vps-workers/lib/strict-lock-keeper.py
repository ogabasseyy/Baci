#!/usr/bin/env python3
"""Open and retain a worker lock without following any path symlink."""
import fcntl
import os
import signal
import stat
import sys
import time


def open_lock(path: str, expected_uid: int, expected_gid: int) -> int:
    if not os.path.isabs(path) or "\n" in path or "\r" in path:
        raise ValueError("invalid lock path")
    parts = [part for part in path.split("/") if part]
    if not parts or any(part in (".", "..") for part in parts):
        raise ValueError("invalid lock path")
    directory = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        parent = os.fstat(directory)
        if (
            not stat.S_ISDIR(parent.st_mode)
            or parent.st_uid != 0
            or parent.st_gid != expected_gid
            or stat.S_IMODE(parent.st_mode) & 0o027 != 0
        ):
            raise PermissionError("lock parent ownership mismatch")
        fd = os.open(
            parts[-1], os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=directory
        )
        info = os.fstat(fd)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != 0
            or info.st_gid != expected_gid
            or info.st_nlink != 1
            or stat.S_IMODE(info.st_mode) & 0o007
            or not stat.S_IMODE(info.st_mode) & 0o020
        ):
            os.close(fd)
            raise PermissionError("lock descriptor is not a private worker regular file")
        return fd
    finally:
        os.close(directory)


def main() -> int:
    path, uid_text, gid_text, ready_fifo, release_fifo = sys.argv[1:6]
    fd = open_lock(path, int(uid_text), int(gid_text))
    deadline = time.monotonic() + 600
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            if time.monotonic() >= deadline:
                os.close(fd)
                return 1
            time.sleep(0.1)
    with open(ready_fifo, "w", encoding="ascii") as ready:
        ready.write("READY\n")
        ready.flush()
    try:
        with open(release_fifo, "rb") as release:
            while release.read(1):
                pass
    finally:
        os.close(fd)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"strict lock keeper: {exc}", file=sys.stderr)
        raise SystemExit(1)
