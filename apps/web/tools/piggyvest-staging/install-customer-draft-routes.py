import argparse
import hashlib
import hmac
import os
import re
import shutil
import stat
import subprocess
import tempfile
from pathlib import Path


TARGET = Path('/etc/nginx/sites-available/staging-auth.ogabassey.com')
BACKUP_DIR = Path('/etc/nginx')
HOST = b'staging-auth.ogabassey.com'
DRAFT_PATH = b'/api/storefront/customer/savings/drafts'
LOCATIONS = b'''    location = /api/storefront/customer/savings/drafts {
        if ($request_method !~ ^(GET|POST)$) { return 405; }
        proxy_pass http://127.0.0.1:4792;
        proxy_set_header Host staging.ogabassey.com;
        proxy_set_header X-Forwarded-Host staging.ogabassey.com;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Port 443;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Forwarded "";
        proxy_set_header x-middleware-subrequest "";
        access_log off;
    }

    location = /api/storefront/customer/savings/drafts/policy {
        if ($request_method !~ ^(GET|POST)$) { return 405; }
        proxy_pass http://127.0.0.1:4792;
        proxy_set_header Host staging.ogabassey.com;
        proxy_set_header X-Forwarded-Host staging.ogabassey.com;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Port 443;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Forwarded "";
        proxy_set_header x-middleware-subrequest "";
        access_log off;
    }

    location = /api/storefront/customer/savings/drafts/catalogue {
        if ($request_method !~ ^GET$) { return 405; }
        proxy_pass http://127.0.0.1:4792;
        proxy_set_header Host staging.ogabassey.com;
        proxy_set_header X-Forwarded-Host staging.ogabassey.com;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Port 443;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Forwarded "";
        proxy_set_header x-middleware-subrequest "";
        access_log off;
    }
'''
TOKEN = re.compile(rb'''\s+|\#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{};]|[^\s{};"'\#]+''')


class Refused(Exception):
    pass


def render_config(content, expected_sha256):
    if not re.fullmatch(r'[0-9a-fA-F]{64}', expected_sha256 or ''):
        raise Refused()
    if not hmac.compare_digest(hashlib.sha256(content).hexdigest(), expected_sha256.lower()):
        raise Refused()
    tokens = []
    offset = 0
    for match in TOKEN.finditer(content):
        if match.start() != offset:
            raise Refused()
        offset = match.end()
        value = match.group()
        if not value.isspace() and not value.startswith(b'#'):
            tokens.append((value, match.start()))
    if offset != len(content):
        raise Refused()
    stack, directive, hosts, candidates = [], [], [], []
    for value, position in tokens:
        plain = value.strip(b'"\'')
        if DRAFT_PATH in plain:
            raise Refused()
        if value == b'{':
            stack.append((tuple(directive), position))
            directive = []
        elif value == b';':
            if directive and directive[0] == b'server_name' and HOST in directive[1:]:
                if directive != [b'server_name', HOST] or len(stack) != 1 or stack[0][0] != (b'server',):
                    raise Refused()
                hosts.append(stack[0][1])
            directive = []
        elif value == b'}':
            if not stack or directive:
                raise Refused()
            block, opening = stack.pop()
            if block == (b'server',) and not stack:
                candidates.append((opening, position))
        else:
            directive.append(plain)
    if stack or directive or len(hosts) != 1:
        raise Refused()
    closing = next((end for opening, end in candidates if opening == hosts[0]), None)
    if closing is None or tokens[-1] != (b'}', closing):
        raise Refused()
    return content[:closing] + b'\n' + LOCATIONS + content[closing:]


def read_target():
    descriptor = os.open(TARGET, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as source:
        metadata = os.fstat(source.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            raise Refused()
        return source.read(), metadata


def unchanged(content, metadata):
    current, current_metadata = read_target()
    if current != content or (current_metadata.st_dev, current_metadata.st_ino) != (metadata.st_dev, metadata.st_ino):
        raise Refused()


def make_backup(content, metadata):
    directory = tempfile.mkdtemp(prefix='customer-draft-route-backup-', dir=BACKUP_DIR)
    descriptor, name = tempfile.mkstemp(prefix='config-', dir=directory)
    backup = Path(name)
    with os.fdopen(descriptor, 'wb') as destination:
        destination.write(content)
        destination.flush()
        os.fsync(destination.fileno())
    shutil.copystat(TARGET, backup, follow_symlinks=False)
    os.chown(backup, 0, 0)
    os.chmod(backup, 0o600)
    os.utime(backup, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
    return backup


def atomic_write(content, metadata_source, metadata):
    descriptor, name = tempfile.mkstemp(prefix='.customer-draft-route-', dir=TARGET.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as destination:
            destination.write(content)
            destination.flush()
            shutil.copystat(metadata_source, temporary, follow_symlinks=False)
            os.fchown(destination.fileno(), metadata.st_uid, metadata.st_gid)
            os.fchmod(destination.fileno(), stat.S_IMODE(metadata.st_mode))
            os.utime(temporary, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))
            os.fsync(destination.fileno())
        os.replace(temporary, TARGET)
    finally:
        temporary.unlink(missing_ok=True)


def validate_reload():
    for command in (['/usr/sbin/nginx', '-t'], ['/usr/bin/systemctl', 'reload', 'nginx']):
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL,
                       timeout=30, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'})


def install(expected_sha256):
    if os.geteuid() != 0 or os.getuid() != 0:
        raise Refused()
    content, metadata = read_target()
    rendered = render_config(content, expected_sha256)
    unchanged(content, metadata)
    backup = make_backup(content, metadata)
    unchanged(content, metadata)
    try:
        atomic_write(rendered, backup, metadata)
        validate_reload()
    except Exception:
        try:
            current, _ = read_target()
            if current != rendered:
                raise Refused()
            atomic_write(backup.read_bytes(), backup, metadata)
            validate_reload()
        except Exception:
            raise Refused('Install failed; rollback requires operator attention.') from None
        raise Refused('Install failed; original configuration restored.') from None


def main():
    parser = argparse.ArgumentParser(description='Install the staging customer draft nginx routes.')
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--install', action='store_true', required=True)
    arguments = parser.parse_args()
    try:
        install(arguments.expected_sha256)
    except Refused as error:
        print(str(error) or 'Installation refused.')
        return 1
    except Exception:
        print('Installation failed.')
        return 1
    print('Staging customer draft routes installed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
