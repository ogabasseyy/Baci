import hashlib
import io
import json
import os
from pathlib import Path
from pathlib import PurePosixPath
import shutil
import stat
import subprocess
import tarfile
import tempfile
import time
from types import ModuleType
import uuid


ROOT = Path('/opt/baci-savings-funding')
HERE = Path(__file__).resolve().parent
INSTALLER_HASH = 'f85dd45692278e2aadb083d71a27440c06dfbe45a6adc46bf1c6f395adc8e1de'
CANDIDATE_HASH = '972d4a66ccbd7051f2b48570fabca0e704435244735e957a8416aca92d61c760'
SERVICE = 'baci-savings-funding.service'
HEALTH_PATHS = (
    ('GET', '/api/storefront/customer/savings/goals'),
    ('POST', '/api/storefront/customer/savings/funding'),
    ('GET', '/api/storefront/customer/wallet'),
    ('GET', '/api/storefront/customer/wallet/piggyvest-plan'),
    ('GET', '/api/storefront/customer/savings/notifications'),
)


def read_pinned(name, digest):
    source = HERE / name
    descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as handle:
        metadata = os.fstat(handle.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_nlink != 1 or metadata.st_mode & 0o022:
            raise RuntimeError('Unsafe artifact input')
        content = handle.read()
    if hashlib.sha256(content).hexdigest() != digest:
        raise RuntimeError('Artifact input hash drift')
    return content


def load_pinned(name, digest):
    source = HERE / name
    content = read_pinned(name, digest)
    module = ModuleType(name.replace('-', '_'))
    module.__file__ = str(source)
    exec(compile(content, str(source), 'exec'), module.__dict__)
    return module


def _read_root_file(path, limit=2_000_000):
    for parent in path.parents:
        metadata = parent.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            raise RuntimeError('Untrusted protected-file parent')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_nlink != 1 or before.st_mode & 0o022:
            raise RuntimeError('Unsafe protected file')
        content = handle.read(limit + 1)
        after = os.fstat(handle.fileno())
    if len(content) > limit or (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
        raise RuntimeError('Protected file changed during read')
    return content


def read_artifact_pins():
    if os.geteuid() != 0:
        raise RuntimeError('Owner root execution required')
    pins = json.loads(_read_root_file(HERE / 'artifact-pins.json', 65536))
    if (not isinstance(pins, dict) or set(pins) != {'tarballSha256', 'manifestSha256'} or
        any(not isinstance(value, str) or len(value) != 64 or any(char not in '0123456789abcdef' for char in value) for value in pins.values())):
        raise RuntimeError('Unexpected artifact pins')
    return pins


def _archive_entries(archive_bytes):
    entries = {}
    explicit = set()
    with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode='r:gz') as archive:
        for member in archive.getmembers():
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts:
                raise RuntimeError('Unsafe pinned archive path')
            name = path.as_posix().removeprefix('./')
            if name in ('', '.'):
                if member.isdir():
                    continue
                raise RuntimeError('Invalid pinned archive entry')
            kind = 'directory' if member.isdir() else 'file' if member.isfile() else 'symlink' if member.issym() else None
            if kind is None or name in explicit or name in entries and entries[name] != kind:
                raise RuntimeError('Invalid or duplicate pinned archive entry')
            explicit.add(name)
            entries[name] = kind
            for parent in path.parents:
                parent_name = parent.as_posix()
                if parent_name in ('', '.'):
                    break
                if parent_name in explicit and entries[parent_name] != 'directory':
                    raise RuntimeError('Pinned archive parent is not a directory')
                entries.setdefault(parent_name, 'directory')
    return entries


def _installed_entries(root):
    entries = {}
    for directory, names, files in os.walk(root, followlinks=False):
        for name in [*names, *files]:
            path = Path(directory) / name
            relative = path.relative_to(root).as_posix()
            metadata = path.lstat()
            if stat.S_ISLNK(metadata.st_mode):
                kind = 'symlink'
            elif stat.S_ISDIR(metadata.st_mode):
                kind = 'directory'
            elif stat.S_ISREG(metadata.st_mode):
                kind = 'file'
            else:
                raise RuntimeError('Unexpected installed artifact entry')
            entries[relative] = kind
            if name.startswith('.env'):
                raise RuntimeError('Environment file in installed artifact')
            if kind == 'symlink' and name in names:
                names.remove(name)
    return entries


def verify_installed():
    if os.geteuid() != 0:
        raise RuntimeError('Owner root execution required')
    pins = read_artifact_pins()
    archive_bytes = read_pinned('funding-deploy.tar.gz', pins['tarballSha256'])
    manifest = json.loads(read_pinned('funding-deploy.manifest.json', pins['manifestSha256']))
    installer = load_pinned('install-funding-artifact.py', INSTALLER_HASH)
    candidate = load_pinned('funding-service-candidate.py', CANDIDATE_HASH)
    candidate.verify_artifact()
    candidate.verify_config_metadata()
    if ROOT.is_symlink() or not ROOT.is_dir():
        raise RuntimeError('Installed funding artifact is missing')
    expected = _archive_entries(archive_bytes)
    installer._verify_manifest(ROOT, manifest)
    candidate._verify_artifact_tree(ROOT)
    candidate._verify_service_artifact_access(ROOT)
    if _installed_entries(ROOT) != expected:
        raise RuntimeError('Installed artifact file set drift')
    required = (ROOT / 'apps/web/server.js', ROOT / 'apps/web/.next/server/app/api/storefront/customer/savings/notifications/route.js')
    if not all(path.is_file() and not path.is_symlink() for path in required):
        raise RuntimeError('New notification route missing from installed artifact')
    unit = Path('/etc/systemd/system') / SERVICE
    if _read_root_file(unit, 65536) != candidate.render_unit().encode():
        raise RuntimeError('Funding service unit drift')
    probe_health()
    return {'status': 'verified', 'entries': len(expected)}


def run_service(action):
    subprocess.run(['/usr/bin/systemctl', action, SERVICE], check=True,
                   capture_output=True, timeout=60)


def probe_health(*, include_notifications=True):
    paths = [item for item in HEALTH_PATHS if include_notifications or not item[1].endswith('/notifications')]
    for attempt in range(15):
        passed = True
        for method, path in paths:
            result = subprocess.run([
                '/usr/bin/curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}',
                '--max-time', '2', '-X', method, '-H', 'Host: staging.ogabassey.com',
                '-H', 'X-Forwarded-Host: staging.ogabassey.com',
                '-H', 'X-Forwarded-Proto: https', f'http://127.0.0.1:4795{path}',
            ], capture_output=True, text=True, timeout=3)
            if result.returncode or result.stdout != '401':
                passed = False
                break
        if passed:
            return
        if attempt < 14:
            time.sleep(1)
    raise RuntimeError('Funding service health failed')


def prepare():
    if os.geteuid() != 0:
        raise RuntimeError('Owner root execution required')
    pins_path = HERE / 'artifact-pins.json'
    metadata = pins_path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
        raise RuntimeError('Unsafe artifact pins')
    pins = json.loads(pins_path.read_bytes())
    if set(pins) != {'tarballSha256', 'manifestSha256'}:
        raise RuntimeError('Unexpected artifact pins')
    archive_bytes = read_pinned('funding-deploy.tar.gz', pins['tarballSha256'])
    manifest = json.loads(read_pinned('funding-deploy.manifest.json', pins['manifestSha256']))
    installer = load_pinned('install-funding-artifact.py', INSTALLER_HASH)
    candidate = load_pinned('funding-service-candidate.py', CANDIDATE_HASH)
    candidate.verify_artifact()
    candidate.verify_config_metadata()
    unit = Path('/etc/systemd/system') / SERVICE
    if unit.is_symlink() or unit.read_text() != candidate.render_unit():
        raise RuntimeError('Funding service unit drift')
    temporary = Path(tempfile.mkdtemp(prefix='.baci-savings-funding-engagement-', dir='/opt'))
    try:
        with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode='r:gz') as archive:
            archive.extractall(temporary, filter='data')
        installer._verify_manifest(temporary, manifest)
        installer._normalize_tree(temporary)
        candidate._verify_artifact_tree(temporary)
        candidate._verify_service_artifact_access(temporary)
        required = [temporary / 'apps/web/server.js', temporary / 'apps/web/.next/server/app/api/storefront/customer/savings/notifications/route.js']
        if not all(path.is_file() for path in required):
            raise RuntimeError('New notification route missing from artifact')
        if any(path.name == '.env' or path.name.startswith('.env.') for path in temporary.rglob('*')):
            raise RuntimeError('Environment file in candidate artifact')
        return temporary
    except Exception:
        shutil.rmtree(temporary)
        raise


def swap(staged, verify):
    verify()
    suffix = str(int(time.time())) + '-' + uuid.uuid4().hex[:8]
    backup = ROOT.with_name(ROOT.name + '.rollback-' + suffix)
    failed = ROOT.with_name(ROOT.name + '.failed-' + suffix)
    run_service('stop')
    try:
        os.rename(ROOT, backup)
    except Exception:
        run_service('start')
        raise RuntimeError('Funding backup failed; existing service restarted') from None
    try:
        os.rename(staged, ROOT)
        run_service('start')
        probe_health()
    except Exception:
        run_service('stop')
        if ROOT.exists():
            os.rename(ROOT, failed)
        os.rename(backup, ROOT)
        run_service('start')
        probe_health(include_notifications=False)
        raise RuntimeError('Funding upgrade rolled back; candidate retained') from None
    return backup


def activate(staged):
    if os.geteuid() != 0 or staged.parent != Path('/opt') or not staged.name.startswith('.baci-savings-funding-engagement-'):
        raise RuntimeError('Invalid artifact activation context')
    candidate = load_pinned('funding-service-candidate.py', CANDIDATE_HASH)

    def verify():
        candidate.verify_artifact()
        candidate._verify_artifact_tree(staged)
        candidate._verify_service_artifact_access(staged)

    return swap(staged, verify)
