import grp
import hashlib
import json
import os
import pwd
import re
import stat
import sys
import types

STAGE = 'invocation'
STAGES = frozenset(('invocation', 'bundle-validation', 'preflight', 'lock-create', 'lock-cleanup',
    'state-create', 'group-create', 'user-create', 'account-lock-check', 'code-directory-create',
    'config-directory-create', 'runtime-code-stage', 'validation-files-stage', 'sudoers-candidate-validate',
    'systemd-unit-verify', 'sudoers-install', 'sudoers-global-validate', 'unit-install', 'daemon-reload',
    'inactive-confirm', 'rollback-load', 'rollback-verify', 'rollback-remove', 'rollback-daemon-reload',
    'rollback-state-remove'))


def failure_report(error):
    def summary(failure, fallback):
        stage = getattr(failure, 'install_stage', fallback)
        stage = stage if isinstance(stage, str) and stage in STAGES else 'unknown'
        name = type(failure).__name__
        if name not in ('RuntimeError', 'ValueError', 'KeyError', 'IndexError', 'TypeError', 'OSError',
                        'PermissionError', 'FileExistsError', 'FileNotFoundError', 'NotADirectoryError',
                        'CalledProcessError', 'TimeoutExpired', 'JSONDecodeError', 'UnicodeDecodeError',
                        'KeyboardInterrupt', 'SystemExit'):
            name = 'Exception'
        result = f'stage={stage} type={name}'
        for attribute, label in (('errno', 'errno'), ('returncode', 'exit')):
            value = getattr(failure, attribute, None)
            if type(value) is int and -2147483648 <= value <= 2147483647:
                result += f' {label}={value}'
        return result
    result = summary(error, STAGE)
    for attribute, label in (('rollback_error', 'rollback'), ('cleanup_error', 'cleanup')):
        secondary = getattr(error, attribute, None)
        if isinstance(secondary, BaseException):
            result += '; ' + label + ' ' + summary(secondary, 'unknown')
    return result


def trusted_read(path):
    directory = os.path.dirname(path)
    while True:
        info = os.lstat(directory)
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError('Root-owned source ancestry required')
        if directory == '/':
            break
        directory = os.path.dirname(directory)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_mode & 0o7222 or before.st_nlink != 1:
            raise RuntimeError('Immutable root-owned source required')
        content = handle.read(1048577)
        after = os.fstat(handle.fileno())
        identity = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_mode, info.st_uid, info.st_nlink)
        if len(content) > 1048576 or identity(before) != identity(after):
            raise RuntimeError('Source changed or oversized')
        return content


def load_bundle(directory, digest):
    if not os.path.isabs(directory) or os.path.normpath(directory) != directory or not re.fullmatch('[0-9a-f]{64}', digest):
        raise RuntimeError('Absolute reviewed bundle and manifest digest required')
    manifest_bytes = trusted_read(directory + '/managed-install-manifest.json')
    if hashlib.sha256(manifest_bytes).hexdigest() != digest:
        raise RuntimeError('Manifest digest mismatch')
    manifest = json.loads(manifest_bytes)
    payloads = {}
    for name, expected in manifest['files'].items():
        if not re.fullmatch('[a-z][a-z0-9.-]+', name) or '/' in name:
            raise RuntimeError('Manifest filename refused')
        content = trusted_read(directory + '/' + name)
        if hashlib.sha256(content).hexdigest() != expected:
            raise RuntimeError('Bundle checksum mismatch')
        payloads[name] = content
    if payloads.get('install-managed-gateway.py') != trusted_read(os.path.abspath(__file__)):
        raise RuntimeError('Executing installer does not match manifest')
    modules = {}
    for name in ('managed-install-policy', 'managed-install-transaction'):
        module = types.ModuleType(name)
        exec(compile(payloads[name + '.py'], directory + '/' + name + '.py', 'exec'), module.__dict__)
        modules[name] = module
    policy = modules['managed-install-policy']
    policy.validate_bundle(manifest, payloads)
    return policy, modules['managed-install-transaction'].Installation, manifest, payloads


def main(arguments):
    global STAGE
    STAGE = 'invocation'
    if sys.platform != 'linux' or os.geteuid() != 0 or os.getegid() != 0 or not sys.flags.isolated:
        raise RuntimeError('Candidate requires owner-reviewed root Python -I execution')
    if len(arguments) != 3 or arguments[0] not in ('--check', '--install', '--rollback'):
        raise RuntimeError('Use --check, --install or --rollback with bundle and manifest SHA256')
    mode, directory, digest = arguments
    STAGE = 'bundle-validation'
    policy, installation, manifest, payloads = load_bundle(directory, digest)
    os.umask(0o077)
    if mode == '--check':
        STAGE = 'preflight'
        policy.preflight(manifest, payloads, pwd, grp)
        print('Preflight passed; no resources created; exact-unit smoke still required.')
        return
    lock = '/run/baci-savings-gateway-installer.lock'
    STAGE = 'lock-create'
    policy.parents(lock)
    os.mkdir(lock, 0o700)
    original = None
    transaction = None
    try:
        if mode == '--install':
            STAGE = 'preflight'
            policy.preflight(manifest, payloads, pwd, grp)
            transaction = installation(policy, pwd, grp, digest)
            transaction.install(payloads)
            print('Candidate installed inactive; no binding, evidence, public change, start or enable.')
        else:
            STAGE = 'rollback-load'
            policy.validate_binaries(manifest['versions'])
            record = json.loads(policy.read(policy.STATE + '/receipt.json', readonly=False))
            policy.require(set(record) == {'version', 'manifestSha256', 'entries'} and record['version'] == 1
                           and record['manifestSha256'] == digest, 'Rollback receipt mismatch')
            transaction = installation(policy, pwd, grp, digest, record['entries'])
            transaction.rollback()
            print('Recorded newly created resources removed; public configuration untouched.')
    except BaseException as error:
        original = error
        if not hasattr(error, 'install_stage'):
            error.install_stage = transaction.stage if transaction else STAGE
        raise
    finally:
        try:
            os.rmdir(lock)
        except BaseException as error:
            error.install_stage = 'lock-cleanup'
            if original is None:
                raise
            original.cleanup_error = error


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except BaseException as error:
        print('Managed installer failure: ' + failure_report(error), file=sys.stderr)
        print('Managed installer refused or incomplete. Preserve receipt; review before retry. No start/enable performed.', file=sys.stderr)
        sys.exit(1)
