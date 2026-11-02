#!/usr/bin/env python3
"""Experimental cache-lock launcher; failure runs the worker without a lock."""
import fcntl
import os
import stat
import sys

LOCK_FD = 9


def trusted_parent(path):
    uid = os.getuid()
    current = os.path.realpath(path)
    while True:
        info = os.lstat(current)
        if not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, uid):
            return False
        if info.st_mode & 0o022 and not (info.st_uid == 0 and info.st_mode & stat.S_ISVTX):
            return False
        parent = os.path.dirname(current)
        if parent == current:
            return True
        current = parent


def acquire():
    home = os.environ.get("HOME", "")
    if not os.path.isabs(home):
        return
    parent = os.path.realpath(os.path.join(home, "baci-workers"))
    if not trusted_parent(parent):
        return
    directory = os.path.join(parent, "gigl-tracking-token-cache")
    try:
        os.mkdir(directory, 0o700)
    except FileExistsError:
        pass
    directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(directory_fd)
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
            return
        fd = os.open("cache.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=directory_fd)
        keep_fd = False
        try:
            info = os.fstat(fd)
            path_info = os.stat("cache.lock", dir_fd=directory_fd, follow_symlinks=False)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or
                    stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1 or
                    (info.st_dev, info.st_ino) != (path_info.st_dev, path_info.st_ino)):
                return
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            os.ftruncate(fd, 0)
            os.pwrite(fd, f"{os.getpid()}\n".encode(), 0)
            # Close the directory handle before reserving the worker's lock fd.
            os.close(directory_fd)
            directory_fd = None
            if fd != LOCK_FD:
                os.dup2(fd, LOCK_FD, inheritable=True)
            else:
                os.set_inheritable(fd, True)
            keep_fd = True
            return
        finally:
            if fd != LOCK_FD or not keep_fd:
                os.close(fd)
    finally:
        if directory_fd is not None:
            os.close(directory_fd)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(2)
    try:
        os.close(LOCK_FD)
    except OSError:
        pass
    try:
        acquire()
    except OSError:
        pass
    os.execvp(sys.argv[1], sys.argv[1:])


if __name__ == "__main__":
    main()
