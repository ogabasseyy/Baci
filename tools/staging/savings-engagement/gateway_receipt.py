"""Atomic, no-overwrite publication for the staging gateway receipt."""

import os
import tempfile


def _fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def publish_exclusive(path, content, mode):
    descriptor, temporary = tempfile.mkstemp(prefix='.receipt-', dir=path.parent)
    published = False
    identity = None
    try:
        os.fchmod(descriptor, mode)
        view = memoryview(content)
        while view:
            written = os.write(descriptor, view)
            if written <= 0:
                raise OSError('Receipt write made no progress.')
            view = view[written:]
        os.fsync(descriptor)
        info = os.fstat(descriptor)
        identity = (info.st_dev, info.st_ino)
        os.close(descriptor)
        descriptor = -1
        os.link(temporary, path, follow_symlinks=False)
        published = True
        _fsync_directory(path.parent)
        os.unlink(temporary)
        _fsync_directory(path.parent)
    except BaseException:
        if published:
            try:
                info = path.lstat()
                if (info.st_dev, info.st_ino) == identity:
                    path.unlink()
            except FileNotFoundError:
                pass
        raise
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
