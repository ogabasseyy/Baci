#!/usr/bin/env python3
"""Install the bounded hosted-savings-drafts staging cutover exactly once."""

import argparse
import hashlib
import json
import os
import pwd
import grp
import shutil
import stat
import subprocess
import sys
from pathlib import Path, PurePosixPath


EXPIRY = 1789989845
SOURCE_ROOT = Path('/home/bassey/baci-drafts-build-20260920/apps/web/.next/standalone')
DESTINATION = Path('/opt/baci-savings-drafts')
PROFILE = Path('/home/bassey/baci-isolated-savings/hosted-public-client-profile.json')
STAGED_NGINX_INSTALLER = Path('/home/bassey/baci-isolated-savings/install-customer-draft-routes.py')
STAGED_NGINX_INSTALLER_SHA256 = '6f23bd6dd2276dc1cbb762426556ede964f75ee62028352e9402b4930fc72d9c'
NGINX_TARGET = Path('/etc/nginx/sites-available/staging-auth.ogabassey.com')
UNIT_DIRECTORY = Path('/etc/systemd/system')
ROUTES = '/api/storefront/customer/savings/drafts'


class Refused(RuntimeError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def safe_relative(root: Path, path: Path) -> str:
    relative = path.relative_to(root)
    if relative == Path('.') or relative.is_absolute() or '..' in relative.parts:
        raise Refused('Unsafe artifact path.')
    return relative.as_posix()


def link_target_is_safe(root: Path, link: Path) -> str:
    target = os.readlink(link)
    if os.path.isabs(target):
        raise Refused('Absolute artifact symlink refused.')
    resolved = (link.parent / target).resolve(strict=False)
    try:
        resolved.relative_to(root.resolve())
    except ValueError as error:
        raise Refused('Escaping artifact symlink refused.') from error
    return target


def artifact_entries(root: Path) -> list[dict[str, str]]:
    if not root.is_dir() or (root / 'apps/web/node_modules').exists():
        raise Refused('Unexpected standalone layout.')
    if not (root / 'apps/web/server.js').is_file() or not (root / 'node_modules').is_dir():
        raise Refused('Incomplete standalone build.')
    entries: list[dict[str, str]] = []
    for path in sorted(root.rglob('*')):
        relative = safe_relative(root, path)
        if any(part == '.env' or part.startswith('.env.') for part in PurePosixPath(relative).parts):
            raise Refused('Environment files are not allowed in the artifact.')
        if path.is_symlink():
            entries.append({'path': relative, 'type': 'symlink', 'target': link_target_is_safe(root, path)})
        elif path.is_file():
            entries.append({'path': relative, 'type': 'file', 'sha256': sha256(path)})
        elif not path.is_dir():
            raise Refused('Unsupported artifact entry.')
    return entries


def verify_seal(bundle: Path) -> None:
    manifest = bundle / 'cutover-seal.sha256'
    if not manifest.is_file() or manifest.is_symlink():
        raise Refused('Missing root seal.')
    lines = manifest.read_text(encoding='ascii').splitlines()
    expected = {'install-savings-drafts-cutover.py', 'cutover_runtime.py', 'artifact-pin.txt'}
    actual = set()
    for line in lines:
        parts = line.split(maxsplit=1)
        if len(parts) != 2 or len(parts[0]) != 64 or not all(char in '0123456789abcdef' for char in parts[0]):
            raise Refused('Invalid root seal.')
        name = parts[1].removeprefix('*')
        if name not in expected or '/' in name or name in actual:
            raise Refused('Unexpected root seal entry.')
        if sha256(bundle / name) != parts[0]:
            raise Refused('Root seal verification failed.')
        actual.add(name)
    if actual != expected:
        raise Refused('Incomplete root seal.')


def require_root_and_time() -> None:
    if os.getuid() != 0 or os.geteuid() != 0 or int(__import__('time').time()) >= EXPIRY:
        raise Refused('Cutover refused.')


def public_anon_key() -> str:
    profile = json.loads(PROFILE.read_text(encoding='utf-8'))
    key = profile.get('publicKey')
    if (not isinstance(key, str) or hashlib.sha256(key.encode()).hexdigest()
            != '1065d3a5c300f1d3ba3d6c42cbe0524128c57cc2032a4345bff4100cb6f7a3f2'):
        raise Refused('Hosted public profile is invalid.')
    return key


def run(command: list[str]) -> None:
    subprocess.run(command, check=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL, timeout=30,
                   env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'})


def nginx_hash() -> str:
    if not NGINX_TARGET.is_file() or NGINX_TARGET.is_symlink():
        raise Refused('Nginx target is unsafe.')
    metadata = NGINX_TARGET.stat()
    if metadata.st_uid != 0 or metadata.st_mode & 0o022:
        raise Refused('Nginx target permissions are unsafe.')
    return sha256(NGINX_TARGET)


def copy_artifact(entries: list[dict[str, str]], bundle: Path) -> None:
    if DESTINATION.exists():
        raise Refused('Destination already exists; refusing overwrite.')
    if sha256(STAGED_NGINX_INSTALLER) != STAGED_NGINX_INSTALLER_SHA256:
        raise Refused('Reviewed Nginx installer seal failed.')
    shutil.copytree(SOURCE_ROOT, DESTINATION, symlinks=True, copy_function=shutil.copy2)
    if artifact_entries(DESTINATION) != entries:
        raise Refused('Copied artifact manifest verification failed.')
    group_id = grp.getgrnam('baci-savings-ingress').gr_gid
    for path in [DESTINATION, *DESTINATION.rglob('*')]:
        if path.is_symlink():
            continue
        os.chown(path, 0, group_id)
        os.chmod(path, 0o750 if path.is_dir() else 0o640)
    installer_dir = DESTINATION / 'installer'
    installer_dir.mkdir(mode=0o750)
    for name, source in {'install-customer-draft-routes.py': STAGED_NGINX_INSTALLER}.items():
        if not source.is_file() or source.is_symlink():
            raise Refused('Required installer source is unsafe.')
        target = installer_dir / name
        shutil.copy2(source, target, follow_symlinks=False)
        os.chown(target, 0, group_id)
        os.chmod(target, 0o750)
    manifest = {'version': 1, 'source_root': str(SOURCE_ROOT), 'entries': entries,
                'installer_sha256': {name: sha256(installer_dir / name) for name in
                                     ('install-customer-draft-routes.py',)}}
    manifest_path = DESTINATION / 'artifact-manifest.json'
    manifest_path.write_text(json.dumps(manifest, sort_keys=True, separators=(',', ':')) + '\n', encoding='utf-8')
    os.chown(manifest_path, 0, group_id)
    os.chmod(manifest_path, 0o640)


def write_units(anon_key: str) -> None:
    service = f'''[Unit]\nDescription=Bounded isolated savings drafts server (staging loopback)\nAfter=network-online.target\n\n[Service]\nType=simple\nUser=baci-savings-gateway\nGroup=baci-savings-ingress\nWorkingDirectory=/opt/baci-savings-drafts/apps/web\nBindReadOnlyPaths=/opt/baci-savings-drafts\nEnvironment=NODE_ENV=production BACI_WORKER_PROFILE=hosted-savings-drafts PIGGYVEST_HOSTED_DRAFT_STAGING_ENABLED=true PORT=4792 HOSTNAME=127.0.0.1\nEnvironment=NEXT_PUBLIC_APP_URL=https://staging.ogabassey.com NEXT_PUBLIC_SUPABASE_URL=https://staging-auth.ogabassey.com\nEnvironment=NEXT_PUBLIC_SUPABASE_ANON_KEY={anon_key}\nExecCondition=/bin/sh -c '[ "$(/bin/date -u +%s)" -lt {EXPIRY} ]'\nExecStart=/usr/bin/node server.js\nRestart=no\nRuntimeMaxSec=1d\nKillMode=control-group\nTimeoutStopSec=5s\nLimitCORE=0\nMemoryMax=4G\nCPUQuota=200%\nTasksMax=512\nProtectSystem=strict\nProtectHome=yes\nPrivateTmp=yes\nPrivateDevices=yes\nProtectKernelTunables=yes\nProtectKernelModules=yes\nUMask=0007\n'''
    service = service.replace(
        'TasksMax=512\nProtectSystem',
        'TasksMax=512\nNoNewPrivileges=yes\nCapabilityBoundingSet=\nProtectSystem',
    )
    service = service.replace('/bin/date -u +%s', '/bin/date -u +%%s')
    deadline = '[Unit]\nDescription=Stop isolated savings drafts at lease expiry\n\n[Service]\nType=oneshot\nExecStart=/usr/bin/systemctl stop baci-savings-drafts.service\n'
    timer = '[Unit]\nDescription=Absolute lease deadline for isolated savings drafts\n\n[Timer]\nOnCalendar=2026-09-21 11:24:05 UTC\nAccuracySec=1s\nUnit=baci-savings-drafts-deadline.service\n\n[Install]\nWantedBy=timers.target\n'
    for name, content in {'baci-savings-drafts.service': service,
                          'baci-savings-drafts-smoke.service': service.replace('PORT=4792', 'PORT=4794').replace('RuntimeMaxSec=1d', 'RuntimeMaxSec=120'),
                          'baci-savings-drafts-deadline.service': deadline,
                          'baci-savings-drafts-deadline.timer': timer}.items():
        target = UNIT_DIRECTORY / name
        if target.exists():
            raise Refused('Systemd unit already exists; refusing overwrite.')
        target.write_text(content, encoding='utf-8')
        os.chown(target, 0, 0)
        os.chmod(target, 0o644)


def install(bundle: Path) -> None:
    import cutover_runtime
    require_root_and_time()
    verify_seal(bundle)
    cutover_runtime.preflight_units(UNIT_DIRECTORY)
    anon_key = public_anon_key()
    entries = artifact_entries(SOURCE_ROOT)
    actual = hashlib.sha256(json.dumps(entries, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if actual != (bundle / 'artifact-pin.txt').read_text().strip():
        raise Refused('Artifact changed since review.')
    config_hash = nginx_hash()
    copy_artifact(entries, bundle)
    write_units(anon_key)
    root_installer = DESTINATION / 'installer/install-customer-draft-routes.py'
    if sha256(root_installer) != STAGED_NGINX_INSTALLER_SHA256:
        raise Refused('Copied Nginx installer seal failed.')
    cutover_runtime.activate(sys.modules[__name__], config_hash)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--install', action='store_true', required=True)
    arguments = parser.parse_args()
    try:
        install(Path(__file__).resolve().parent)
    except (OSError, ValueError, subprocess.SubprocessError, RuntimeError):
        print('Cutover refused or failed; do not retry automatically. Inspect the artifact, Nginx rollback backup, and service journal.')
        return 1
    print('Savings drafts cutover installed; verify the service and deadline timer before enabling traffic.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
