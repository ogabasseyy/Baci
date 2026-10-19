"""Isolated authenticated entrypoint for one rollback-only rehearsal, never a start."""

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from types import ModuleType


MODULES = ('cutover_runtime', 'financial_delta', 'financial_completion', 'completion_snapshot',
    'cutover_database', 'replay_quiescence', 'replay_fence_rehearsal',
    'replay_rehearsal_transport', 'replay_rehearsal_inventory',
    'replay_rehearsal_support', 'replay_rehearsal_owner')
FENCE_PIN = '0a2f0610b68ec0565788bf4ad06a4e5f90c2eda63406e9639ef2418f8fcd5e29'
REVIEWED = dict(
    financialAuditPath='/root/baci-existing-payment-continuation.xksoez3y/completed-533ee4d66f624a71b65cc9c268f4baaa.json',
    financialAuditSha256='b05cb92ae1d17fba8b9f09216ac198da08b5470ec11fd851aa0e9c97ec026c9c')
FINGERPRINT = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink',
    'st_size', 'st_mtime_ns', 'st_ctime_ns')


def require(value):
    if not value:
        raise ValueError('rehearsal_seal_refused')


def pin(value):
    return type(value) is str and re.fullmatch('[a-f0-9]{64}', value) is not None


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def decode(raw):
    def unique(pairs):
        result = {}
        for name, value in pairs:
            require(name not in result)
            result[name] = value
        return result
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: require(False))


def protected(path, expected):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts and pin(expected))
    parents = {parent: parent.lstat() for parent in path.parents}
    require(all(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0
        and not info.st_mode & 0o022 for info in parents.values()))
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == before.st_gid == 0
        and stat.S_IMODE(before.st_mode) == 0o600 and before.st_nlink == 1
        and 0 < before.st_size <= 16000000)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as handle:
        opened = os.fstat(handle.fileno())
        raw = handle.read(16000001)
        after = os.fstat(handle.fileno())
    fingerprint = lambda info: tuple(getattr(info, field) for field in FINGERPRINT)
    require(all(fingerprint(before) == fingerprint(info) for info in (opened, after, path.lstat()))
        and len(raw) == before.st_size and hashlib.sha256(raw).hexdigest() == expected
        and all(fingerprint(parent.lstat()) == fingerprint(info) for parent, info in parents.items()))
    return raw


def validate_manifest(manifest):
    require(type(manifest) is dict and set(manifest) == {
        'kind', 'files', 'fenceInventorySha256', 'reviewed'}
        and manifest['kind'] == 'rollback-only-replay-rehearsal'
        and manifest['fenceInventorySha256'] == FENCE_PIN
        and type(manifest['files']) is dict
        and set(manifest['files']) == {name+'.py' for name in MODULES}
        and all(pin(value) for value in manifest['files'].values())
        and manifest['reviewed'] == REVIEWED)


def exact_directory(directory, names):
    require({entry.name for entry in directory.iterdir()} == set(names))
    info = directory.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0
        and stat.S_IMODE(info.st_mode) == 0o700)


def capture(directory, seal):
    raw = protected(directory/'release.json', seal)
    require(hashlib.sha256(raw).hexdigest() == seal)
    manifest = decode(raw)
    validate_manifest(manifest)
    exact_directory(directory, set(manifest['files']) | {'release.json', 'replay_rehearsal_seal.py'})
    captured = {name: protected(directory/name, digest) for name, digest in manifest['files'].items()}
    fence = directory.parent/'replay-claim-fence'
    inventory = protected(fence/'SOURCE-INVENTORY.sha256', FENCE_PIN)
    fence_bytes = {}
    for line in inventory.decode().splitlines():
        digest, name = line.split('  ')
        require(pin(digest) and re.fullmatch('[a-zA-Z0-9_.-]+', name) and name not in fence_bytes)
        fence_bytes[name] = protected(fence/name, digest)
    require('renderer.py' in fence_bytes and 'contract.py' in fence_bytes)
    exact_directory(fence, set(fence_bytes) | {'SOURCE-INVENTORY.sha256'})
    return manifest, captured, fence_bytes


def load_modules(directory, captured):
    require(all(name not in sys.modules for name in MODULES)
        and set(captured) == {name+'.py' for name in MODULES})
    modules = {}
    for name in MODULES:
        module = ModuleType(name)
        module.__file__ = str(directory/(name+'.py'))
        sys.modules[name] = module
        exec(compile(captured[name+'.py'], module.__file__, 'exec'), module.__dict__)
        modules[name] = module
    return modules


def main(arguments=None):
    try:
        arguments = sys.argv[1:] if arguments is None else arguments
        directory = Path(__file__).resolve().parent
        require(os.geteuid() == 0 and sys.flags.isolated and sys.flags.no_site
            and sys.flags.dont_write_bytecode and not sys.flags.optimize
            and len(arguments) == 2 and pin(arguments[0]) and arguments[1] in ('--check', '--rehearse')
            and directory.name == 'owner' and directory.parent.parent == Path('/root'))
        for parent in (directory, directory.parent):
            info = parent.lstat()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0
                and stat.S_IMODE(info.st_mode) == 0o700)
        manifest, captured, fence = capture(directory, arguments[0])
        modules = load_modules(directory, captured)

        def verify():
            require(capture(directory, arguments[0]) == (manifest, captured, fence))
            require(all(sys.modules.get(name) is module
                and module.__file__ == str(directory/(name+'.py')) for name, module in modules.items()))
            return True

        result = modules['replay_rehearsal_owner'].invoke(directory, manifest['reviewed'], verify, protected,
            rehearse=arguments[1] == '--rehearse')
        print(json.dumps(result, sort_keys=True))
        return 0 if result['status'] in ('replay-fence-rollback-verified', 'replay-rehearsal-preflight-passed') else 1
    except Exception:
        print(json.dumps(dict(status='rehearsal-bootstrap-refused', redacted=True,
            liveReplayStarted=False, newPaymentStarted=False)))
        return 1


if __name__ == '__main__':
    sys.exit(main())
