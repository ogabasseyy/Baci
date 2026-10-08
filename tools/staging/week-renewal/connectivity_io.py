import os
from pathlib import Path
import tempfile

from renewal_contract import digest
from renewal_io import read_verified, sync_directory, trusted_parents, unchanged


def replace_owned(path, previous, content, mode, group, owner=0):
    path = Path(path)
    trusted_parents(path, owner)
    _, metadata = read_verified(path, (mode,), (group,), previous)
    descriptor, filename = tempfile.mkstemp(prefix='.baci-renewal-', dir=path.parent)
    temporary = Path(filename)
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(content)
            handle.flush()
            os.fchown(handle.fileno(), owner, group)
            os.fchmod(handle.fileno(), mode)
            os.fsync(handle.fileno())
        unchanged(path, metadata)
        os.replace(temporary, path)
        sync_directory(path.parent)
        read_verified(path, (mode,), (group,), digest(content))
    finally:
        if temporary.exists():
            temporary.unlink()
            sync_directory(path.parent)
    return digest(content)
