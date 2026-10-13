import hashlib
import hmac
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time

from public_nginx_transform import LIMIT, render_config
from treasury_owner_contract import DEADLINE_EPOCH, ENVIRONMENT, Refused
from treasury_owner_io import private_directory, read_file, root_ancestors, write_private


PREDECESSOR_SIZE = 9469
TARGET = Path('/etc/nginx/sites-available/staging-auth.ogabassey.com')
ENABLED = Path('/etc/nginx/sites-enabled/staging-auth.ogabassey.com')
SYNTAX = ['/usr/sbin/nginx', '-t']
RELOAD = ['/usr/bin/systemctl', 'reload', 'nginx']


def _root():
    if os.getuid() != 0 or os.geteuid() != 0:
        raise Refused('Nginx installation requires root owner')


def _deadline():
    if time.time() >= DEADLINE_EPOCH:
        raise Refused('Nginx approval expired')


def _identity(metadata):
    return tuple(getattr(metadata, name) for name in (
        'st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_nlink', 'st_mode',
        'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def _read_target():
    try:
        root_ancestors(TARGET)
        root_ancestors(ENABLED)
        link = ENABLED.lstat()
        if (not stat.S_ISLNK(link.st_mode) or link.st_uid != 0 or link.st_gid != 0
                or link.st_nlink != 1 or os.readlink(ENABLED) != str(TARGET)):
            raise Refused('Nginx enabled site identity refused')
        before = TARGET.lstat()
        content = read_file(TARGET, 0, 0o400, LIMIT + 16384)
        if (before.st_gid != 0 or _identity(before) != _identity(TARGET.lstat())
                or _identity(link) != _identity(ENABLED.lstat())):
            raise Refused('Nginx file identity changed')
        return content, before
    except OSError:
        raise Refused('Nginx pinned site unavailable') from None


def _unchanged(content, metadata):
    current, observed = _read_target()
    if current != content or _identity(observed) != _identity(metadata):
        raise Refused('Nginx predecessor changed during preparation')


def _command(command):
    subprocess.run(command, check=True, timeout=30, env=ENVIRONMENT,
                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _atomic_write(content, metadata, expected_content, expected_metadata):
    descriptor, name = tempfile.mkstemp(prefix='.public-checkout-', dir=TARGET.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as destination:
            destination.write(content)
            destination.flush()
            os.fchown(destination.fileno(), metadata.st_uid, metadata.st_gid)
            os.fchmod(destination.fileno(), stat.S_IMODE(metadata.st_mode))
            os.utime(destination.fileno(), ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
            os.fsync(destination.fileno())
        _unchanged(expected_content, expected_metadata)
        os.replace(temporary, TARGET)
        directory = os.open(TARGET.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


class PublicNginxInstaller:
    def __init__(self, audit_directory):
        self.audit_directory = Path(audit_directory)
        self.original = self.candidate = self.metadata = None
        self.attempted = False
        self.restore_required = False
        self.predecessor_sha256 = None
        self.baselineprobe = None

    def preflight(self):
        _root()
        _deadline()
        if self.attempted:
            raise Refused('Repeated Nginx installation refused')
        root_ancestors(self.audit_directory)
        private_directory(self.audit_directory)
        if self.original is not None:
            _unchanged(self.original, self.metadata)
            return self.predecessor_sha256
        original, metadata = _read_target()
        if len(original) != PREDECESSOR_SIZE:
            raise Refused('Nginx observed predecessor size changed')
        pin = hashlib.sha256(original).hexdigest()
        candidate = render_config(original, pin)
        self.original, self.metadata, self.candidate = original, metadata, candidate
        self.predecessor_sha256 = pin
        return pin

    def install(self, expected_sha256, postprobe, *, baselineprobe):
        """Bounded probes return exactly True: baseline checks old routes; postprobe checks new routes."""
        _root()
        _deadline()
        if (self.attempted or self.predecessor_sha256 is None
                or not isinstance(expected_sha256, str) or not re.fullmatch('[a-f0-9]{64}', expected_sha256)
                or not hmac.compare_digest(self.predecessor_sha256, expected_sha256)):
            raise Refused('Nginx preflight pin or installation state refused')
        if not callable(postprobe) or not callable(baselineprobe):
            raise Refused('Bounded Nginx baseline and postprobe required')
        root_ancestors(self.audit_directory)
        private_directory(self.audit_directory)
        _unchanged(self.original, self.metadata)
        try:
            if baselineprobe() is not True:
                raise Refused('Nginx baseline probe refused')
        except BaseException:
            raise Refused('Nginx baseline probe refused; no configuration written') from None
        self.baselineprobe = baselineprobe
        write_private(self.audit_directory / 'nginx-before.conf', self.original)
        _unchanged(self.original, self.metadata)
        _deadline()
        self.attempted = self.restore_required = True
        try:
            _atomic_write(self.candidate, self.metadata, self.original, self.metadata)
            _command(SYNTAX)
            _deadline()
            _command(RELOAD)
            if baselineprobe() is not True or postprobe() is not True:
                raise Refused('Nginx postprobe refused')
            _deadline()
            current, _ = _read_target()
            if current != self.candidate:
                raise Refused('Nginx installed configuration changed')
        except BaseException:
            try:
                self.rollback()
            except BaseException:
                raise Refused('Nginx install failed; rollback requires operator attention') from None
            raise Refused('Nginx install failed; original configuration restored') from None

    def rollback(self):
        _root()
        if not self.restore_required:
            return
        current, observed = _read_target()
        if current == self.candidate:
            _atomic_write(self.original, self.metadata, current, observed)
        elif current != self.original:
            raise Refused('Nginx rollback requires operator attention')
        _command(SYNTAX)
        _command(RELOAD)
        if self.baselineprobe() is not True:
            raise Refused('Nginx restored baseline probe refused')
        current, _ = _read_target()
        if current != self.original:
            raise Refused('Nginx rollback verification refused')
        self.restore_required = False
