import hashlib
import os
from pathlib import Path
import stat
import tempfile

from constants import EVIDENCE, GROUP


class ProtectedFiles:
    @staticmethod
    def fingerprint(info):
        return tuple(getattr(info, name) for name in ('st_dev', 'st_ino', 'st_mode', 'st_uid',
            'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))

    @staticmethod
    def metadata(info, modes, groups, limit=262144):
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid not in groups
                or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) not in modes
                or not 0 < info.st_size <= limit):
            raise ValueError('protected_file_metadata')

    @staticmethod
    def parents(filename):
        target = Path(filename)
        if not target.is_absolute() or str(target) != os.path.normpath(str(target)):
            raise ValueError('protected_path')
        for parent in target.parents:
            info = parent.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                raise ValueError('protected_parent')

    def read(self, filename, modes, groups, expected=None):
        target = Path(filename)
        self.parents(target)
        original = target.lstat()
        descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, 'rb') as handle:
            before = os.fstat(handle.fileno())
            self.metadata(before, modes, groups)
            if self.fingerprint(before) != self.fingerprint(original):
                raise ValueError('protected_read_race')
            content = handle.read(262145)
            after = os.fstat(handle.fileno())
        if (len(content) != before.st_size or self.fingerprint(before) != self.fingerprint(after)
                or self.fingerprint(after) != self.fingerprint(target.lstat())):
            raise ValueError('protected_read_race')
        if expected is not None and hashlib.sha256(content).hexdigest() != expected:
            raise ValueError('protected_pin')
        return content, self.fingerprint(after)

    @staticmethod
    def sync(directory):
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def write(self, filename, content):
        self.parents(filename)
        descriptor = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        self.sync(Path(filename).parent)

    def replace_evidence(self, expected, content, fingerprint=None):
        previous, observed = self.read(EVIDENCE, (0o440,), (GROUP,), expected)
        if fingerprint is not None and observed != fingerprint:
            raise ValueError('evidence_predecessor_metadata')
        descriptor, temporary = tempfile.mkstemp(prefix='.fresh-evidence-', dir=EVIDENCE.parent)
        try:
            with os.fdopen(descriptor, 'wb') as handle:
                handle.write(content)
                handle.flush()
                os.fchown(handle.fileno(), 0, GROUP)
                os.fchmod(handle.fileno(), 0o440)
                os.fsync(handle.fileno())
            current, current_info = self.read(EVIDENCE, (0o440,), (GROUP,), expected)
            if current != previous or current_info != observed:
                raise ValueError('evidence_compare_failed')
            os.replace(temporary, EVIDENCE)
            self.sync(EVIDENCE.parent)
            self.read(EVIDENCE, (0o440,), (GROUP,), hashlib.sha256(content).hexdigest())
        finally:
            if os.path.lexists(temporary):
                os.unlink(temporary)
