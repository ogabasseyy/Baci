import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import uuid
from readiness import DIRECT_FUNDING_EXPECTATIONS, ReadinessRefused, verify

HERE = Path(__file__).resolve().parent
NGINX_TARGET = Path('/etc/nginx/sites-available/staging-auth.ogabassey.com')
STATE = Path('/var/lib/baci-piggyvest-goal-funding')
LOCK = STATE / 'deploy.lock'
EXPIRY = 1790697550
HOST = 'staging-auth.ogabassey.com'
FUNDING = '/api/storefront/customer/savings/funding'
TOKEN = re.compile(rb'''\s+|\#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{};]|[^\s{};"'\#]+''')
BASELINE = (
    ('GET', '/api/storefront/customer/wallet', 401),
    ('GET', '/api/storefront/customer/savings/goals', 401),
    ('GET', '/api/storefront/customer/savings/drafts', 401),
    ('GET', '/api/storefront/customer/wallet/piggyvest-plan', 401),
    ('GET', '/api/storefront/customer/savings/notifications', 401),
    ('PATCH', '/api/storefront/customer/savings/notifications', 401),
    ('POST', '/api/storefront/customer/savings/notifications', 405),
    ('POST', '/api/storefront/customer/wallet/top-up/initialize', 401),
    ('POST', '/api/storefront/customer/wallet/top-up/confirm', 401),
    ('POST', '/api/storefront/customer/savings/contributions/manual', 401),
    ('GET', '/piggyvest/intake', None),
)
class Refused(RuntimeError):
    pass

def digest(content):
    return hashlib.sha256(content).hexdigest()

def secure_read(path, limit=2_000_000, exact_mode=None):
    for parent in path.parents:
        metadata = parent.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            raise Refused('Untrusted protected-file parent')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        mode = stat.S_IMODE(before.st_mode)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_nlink != 1 or
                before.st_mode & 0o022 or exact_mode is not None and mode != exact_mode):
            raise Refused('Unsafe protected file')
        content = handle.read(limit + 1)
        after = os.fstat(handle.fileno())
    if len(content) > limit or fingerprint(before) != fingerprint(after):
        raise Refused('Protected file changed during read')
    return content, before


def fingerprint(metadata):
    return metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns

def load_bundle():
    if os.geteuid() != 0 or HERE.parent != Path('/root') or HERE.is_symlink():
        raise Refused('Root-private bundle required')
    directory = HERE.lstat()
    if not stat.S_ISDIR(directory.st_mode) or directory.st_uid != 0 or stat.S_IMODE(directory.st_mode) != 0o700:
        raise Refused('Unsafe owner bundle directory')
    pins_bytes, _ = secure_read(HERE / 'deploy-pins.json', 65536, 0o400)
    pins = json.loads(pins_bytes)
    if not isinstance(pins, dict) or set(pins) != {'expectedNginxSha256', 'artifactSha256'}:
        raise Refused('Unexpected deployment pins')
    for value in pins.values():
        if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value):
            raise Refused('Invalid deployment digest')
    artifact_bytes, _ = secure_read(HERE / 'artifact.py')
    if digest(artifact_bytes) != pins['artifactSha256']:
        raise Refused('Artifact helper hash drift')
    spec = importlib.util.spec_from_file_location('piggyvest_funding_artifact', HERE / 'artifact.py')
    artifact = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = artifact
    exec(compile(artifact_bytes, str(HERE / 'artifact.py'), 'exec'), artifact.__dict__)
    return pins, artifact


def render_nginx(content, expected_hash):
    if digest(content) != expected_hash:
        raise Refused('Nginx predecessor hash drift')
    tokens = []
    offset = 0
    for match in TOKEN.finditer(content):
        if match.start() != offset:
            raise Refused('Invalid Nginx token stream')
        offset = match.end()
        value = match.group()
        if not value.isspace() and not value.startswith(b'#'):
            tokens.append((value, match.start(), match.end()))
    if offset != len(content):
        raise Refused('Incomplete Nginx token stream')
    values = [token[0].strip(b"\"'") for token in tokens]
    host_declarations = [index for index in range(len(values) - 2)
                         if values[index:index + 3] == [b'server_name', HOST.encode(), b';']]
    if len(host_declarations) != 1:
        raise Refused('Expected one exact staging-auth server declaration')
    locations = [index for index in range(len(values) - 3)
                 if values[index:index + 3] == [b'location', b'=', FUNDING.encode()]
                 and values[index + 3] == b'{']
    if len(locations) != 1:
        raise Refused('Expected one exact funding location')
    opening = locations[0] + 3
    depth = 1
    closing = None
    for index in range(opening + 1, len(values)):
        if values[index] == b'{':
            depth += 1
        elif values[index] == b'}':
            depth -= 1
            if depth == 0:
                closing = index
                break
    if closing is None:
        raise Refused('Unclosed funding location')
    inside = values[opening + 1:closing]
    rules = [index for index in range(len(inside) - 8)
             if inside[index:index + 9] == [b'if', b'($request_method', b'!~', b'^(POST)$)', b'{', b'return', b'405', b';', b'}']]
    if len(rules) != 1:
        raise Refused('Funding method guard is not the reviewed POST-only form')
    first_token = opening + 1 + rules[0]
    start, end = tokens[first_token][1], tokens[first_token + 8][2]
    replacement = b'if ($request_method !~ ^(GET|POST)$) { return 405; }'
    return content[:start] + replacement + content[end:]


def probe(method, route, timeout=2, direct=False):
    origin = f'http://127.0.0.1:4795{route}' if direct else f'https://{HOST}{route}'
    headers = ['-H', 'Host: staging.ogabassey.com', '-H', 'X-Forwarded-Host: staging.ogabassey.com', '-H', 'X-Forwarded-Proto: https'] if direct else []
    result = subprocess.run([
        '/usr/bin/curl', '--noproxy', '*', '-sS', '-o', '/dev/null', '-w', '%{http_code}',
        '--max-time', str(timeout), '--resolve', f'{HOST}:443:127.0.0.1',
        '-X', method, *headers, origin,
    ], capture_output=True, text=True, timeout=timeout)
    if result.returncode or not re.fullmatch(r'[1-5][0-9]{2}', result.stdout):
        raise Refused('Nginx route probe unavailable')
    return int(result.stdout)


def check_routes(baseline, updated):
    expectations = [(method, route, expected if expected is not None else baseline[(method, route)]) for method, route, expected in BASELINE]
    if baseline and any(baseline[(method, route)] != expected for method, route, expected in expectations):
        raise Refused('Unchanged staging baseline does not match its contract')
    expectations.extend([('GET', FUNDING, 401 if updated else 405), ('POST', FUNDING, 401), ('PUT', FUNDING, 405)])
    verify(expectations, probe, 'nginx-ready' if updated else 'nginx-preflight', wait=updated)


def atomic_replace(path, content, expected_content, expected_metadata):
    current, metadata = secure_read(path, 262144)
    if current != expected_content or fingerprint(metadata) != fingerprint(expected_metadata):
        raise Refused('Nginx target changed before replacement')
    temporary = path.with_name(f'.{path.name}.{uuid.uuid4().hex}.tmp')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            os.fchown(handle.fileno(), metadata.st_uid, metadata.st_gid)
            os.fchmod(handle.fileno(), stat.S_IMODE(metadata.st_mode))
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def save_backup(content):
    ensure_state()
    path = STATE / f'nginx-before-{int(time.time())}-{uuid.uuid4().hex}.conf'
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    return path


def ensure_state():
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    metadata = STATE.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o700:
        raise Refused('Unsafe deployment state directory')


@contextmanager
def deployment_lock():
    ensure_state()
    descriptor = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_nlink != 1 or stat.S_IMODE(metadata.st_mode) != 0o600:
            raise Refused('Unsafe deployment lock')
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refused('Deployment already in progress') from None
        yield
    finally:
        os.close(descriptor)


def install():
    if time.time() >= EXPIRY:
        raise Refused('Fixed staging lease expired')
    pins, artifact = load_bundle()
    with deployment_lock():
        live, metadata = secure_read(NGINX_TARGET, 262144)
        if digest(live) != pins['expectedNginxSha256']:
            raise Refused('Nginx target does not match bundled predecessor pin')
        rendered = render_nginx(live, pins['expectedNginxSha256'])
        if rendered == live:
            raise Refused('Funding GET permission is already active')
        baseline = {(method, route): probe(method, route) for method, route, _ in BASELINE}
        check_routes(baseline, updated=False)
        staged = artifact.prepare()
        backup_file = save_backup(live)
        activated_backup = None
        nginx_write_attempted = False
        if time.time() >= EXPIRY:
            raise Refused('Fixed staging lease expired')
        try:
            activated_backup = artifact.activate(staged)
            verify(DIRECT_FUNDING_EXPECTATIONS, lambda method, route, timeout: probe(method, route, timeout, direct=True), 'funding-service-ready')
            if time.time() >= EXPIRY:
                raise Refused('Fixed staging lease expired')
            current, current_metadata = secure_read(NGINX_TARGET, 262144)
            if current != live or fingerprint(current_metadata) != fingerprint(metadata):
                raise Refused('Nginx target drifted during artifact activation')
            nginx_write_attempted = True
            atomic_replace(NGINX_TARGET, rendered, live, metadata)
            subprocess.run(['/usr/sbin/nginx', '-t'], check=True, capture_output=True, timeout=20)
            subprocess.run(['/usr/bin/systemctl', 'reload', 'nginx'], check=True, capture_output=True, timeout=30)
            check_routes(baseline, updated=True)
            return {'status': 'active', 'leaseExpiresAt': EXPIRY, 'nginxBackup': str(backup_file),
                    'artifactBackup': str(activated_backup)}
        except BaseException:
            rollback_failed = False
            if nginx_write_attempted:
                try:
                    current, current_metadata = secure_read(NGINX_TARGET, 262144)
                    if current == rendered:
                        atomic_replace(NGINX_TARGET, live, rendered, current_metadata)
                        subprocess.run(['/usr/sbin/nginx', '-t'], check=True, capture_output=True, timeout=20)
                        subprocess.run(['/usr/bin/systemctl', 'reload', 'nginx'], check=True, capture_output=True, timeout=30)
                    elif current != live:
                        raise Refused('Nginx drift prevents automatic rollback')
                except Exception:
                    rollback_failed = True
            if activated_backup is not None:
                try:
                    backup_metadata = activated_backup.lstat()
                    if (activated_backup.parent != artifact.ROOT.parent or
                            not activated_backup.name.startswith(artifact.ROOT.name + '.rollback-') or
                            not stat.S_ISDIR(backup_metadata.st_mode) or backup_metadata.st_uid != 0 or backup_metadata.st_mode & 0o022):
                        raise Refused('Artifact rollback path is unsafe')
                    candidate = artifact.load_pinned('funding-service-candidate.py', artifact.CANDIDATE_HASH)
                    artifact.swap(activated_backup, lambda: (
                        candidate._verify_artifact_tree(activated_backup),
                        candidate._verify_service_artifact_access(activated_backup),
                    ))
                except Exception:
                    rollback_failed = True
            if rollback_failed:
                raise Refused('Activation failed and rollback needs operator recovery') from None
            raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--install', action='store_true')
    options = parser.parse_args()
    if not options.install:
        raise Refused('Explicit --install required')
    print(json.dumps(install(), separators=(',', ':')))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'refused', 'errorType': type(error).__name__,
                          'reason': str(error) if type(error) in (Refused, ReadinessRefused) else 'redacted',
                          'readiness': error.report if type(error) is ReadinessRefused else None}), flush=True)
        raise SystemExit(1) from None
