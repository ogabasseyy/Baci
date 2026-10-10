import argparse
import hashlib
import io
import json
from pathlib import Path
import shlex
import tarfile

from install_contract import HOSTED_PROFILE_SHA256


HERE = Path(__file__).resolve().parent
REMOTE = '/home/bassey/baci-test-payments-20260925'
RECOVERY_REMOTE = '/home/bassey/baci-test-payments-nginx-recovery-20260925'
NGINX_SHA256 = '607cb3c3235fb7d1001dd815a96d359654103e73df635e66613476b691f7277b'


def digest(content):
    return hashlib.sha256(content).hexdigest()


def archive(entries):
    files = {**entries, 'SHA256SUMS': ''.join(f'{digest(content)}  {name}\n' for name, content in sorted(entries.items())).encode()}
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as handle:
        for name, content in sorted(files.items()):
            entry = tarfile.TarInfo(name)
            entry.size = len(content)
            entry.mode = 0o400
            handle.addfile(entry, io.BytesIO(content))
    return output.getvalue()


def wrapper(bootstrap_digest, archive_digest, manifest_digest, recover_nginx=False):
    remote = RECOVERY_REMOTE if recover_nginx else REMOTE
    loader = f'''import hashlib, os, pwd, stat
source_path = "{remote}/bootstrap.py"
descriptor = os.open(source_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
with os.fdopen(descriptor, "rb") as handle:
    before = os.fstat(handle.fileno())
    if not stat.S_ISREG(before.st_mode) or before.st_uid != pwd.getpwnam("bassey").pw_uid or before.st_nlink != 1 or stat.S_IMODE(before.st_mode) != 0o600:
        raise SystemExit("Bootstrap metadata refused.")
    source = handle.read(131073)
    after = os.fstat(handle.fileno())
if len(source) > 131072 or (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
    raise SystemExit("Bootstrap changed during verification.")
if hashlib.sha256(source).hexdigest() != "{bootstrap_digest}":
    raise SystemExit("Bootstrap checksum refused.")
exec(compile(source, source_path, "exec"), {{"__name__": "__main__", "__file__": source_path}})
'''
    command = f'/usr/bin/sudo /usr/bin/python3 -I -c {shlex.quote(loader)} {archive_digest} {manifest_digest} {NGINX_SHA256}'
    if recover_nginx:
        command += ' --recover-nginx'
    return f'#!/bin/sh\nset -eu\n/usr/bin/ssh -t -o ServerAliveInterval=15 -o ServerAliveCountMax=20 bassey@82.29.190.219 {shlex.quote(command)}\n'


def prepare(profile_path, server_path, legacy_root, output, recover_nginx=False):
    if output.exists() or output.is_symlink():
        raise RuntimeError('Refusing to overwrite an owner bundle')
    profile_bytes = profile_path.read_bytes()
    if digest(profile_bytes) != HOSTED_PROFILE_SHA256:
        raise RuntimeError('Hosted public profile changed')
    profile = json.loads(profile_bytes)
    config = {
        'authOrigin': profile['supabaseOrigin'], 'apiOrigin': profile['apiOrigin'],
        'anonKey': profile['publicKey'], 'merchantId': profile['merchantId'],
        'customerIds': ['10000000-0000-4000-8000-000000000002'],
    }
    dependencies = legacy_root / 'apps/web/tools/piggyvest-staging'
    files = {
        'server.cjs': server_path.read_bytes(),
        'config.json': json.dumps(config, separators=(',', ':')).encode(),
        'database.sql': (HERE / 'database.sql').read_bytes(),
        'gateway.py': (HERE / 'gateway.py').read_bytes(),
        'engagement_gateway.py': (HERE.parent / 'savings-engagement/gateway.py').read_bytes(),
        'gateway_receipt.py': (HERE.parent / 'savings-engagement/gateway_receipt.py').read_bytes(),
        'funding-gateway-transition-activator.py': (dependencies / 'funding-gateway-transition/funding-gateway-transition-activator.py').read_bytes(),
        'funding-gateway-transition-activator-shared.py': (dependencies / 'funding-gateway-transition/funding-gateway-transition-activator-shared.py').read_bytes(),
        'funding-gateway-transition-activator-package.py': (dependencies / 'funding-gateway-transition/funding-gateway-transition-activator-package.py').read_bytes(),
        'funding-gateway-transition-activator-preflight.py': (dependencies / 'funding-gateway-transition/funding-gateway-transition-activator-preflight.py').read_bytes(),
        'funding-gateway-transition-activator-install.py': (dependencies / 'funding-gateway-transition/funding-gateway-transition-activator-install.py').read_bytes(),
        'funding-gateway-transition-candidate.py': (dependencies / 'funding-gateway-transition/funding-gateway-transition-candidate.py').read_bytes(),
        'wallet-gateway-transition-installer.py': (dependencies / 'wallet-route-repair/wallet-gateway-transition-installer.py').read_bytes(),
    }
    manifest = json.dumps({'version': 1, 'files': {name: digest(content) for name, content in files.items()}}, sort_keys=True, separators=(',', ':')).encode()
    files['bundle.json'] = manifest
    for source in HERE.glob('install*.py'):
        if not source.name.endswith('.test.py'):
            files[source.name] = source.read_bytes()
    if recover_nginx:
        files['nginx_recover.py'] = (HERE / 'nginx_recover.py').read_bytes()
    content = archive(files)
    bootstrap = (HERE / 'bootstrap.py').read_bytes()
    output.mkdir(mode=0o700)
    for name, value in {
        'owner-bundle.tar.gz': content,
        'bootstrap.py': bootstrap,
        'reviewed.sh': wrapper(digest(bootstrap), digest(content), digest(manifest), recover_nginx).encode(),
    }.items():
        destination = output / name
        with destination.open('xb') as handle:
            handle.write(value)
        destination.chmod(0o600)
    return {'archiveSha256': digest(content), 'bootstrapSha256': digest(bootstrap), 'manifestSha256': digest(manifest), 'serverSha256': digest(files['server.cjs']), 'files': len(files), 'activated': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', type=Path, required=True)
    parser.add_argument('--server', type=Path, required=True)
    parser.add_argument('--legacy-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--recover-nginx', action='store_true')
    options = parser.parse_args()
    print(json.dumps(prepare(options.profile, options.server, options.legacy_root, options.output, options.recover_nginx)))
