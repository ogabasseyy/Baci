"""Authenticate a complete protected root package before importing its runner."""

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from types import CodeType, ModuleType


KIND = 'sealed-existing-payment-only-continuation'
OPERATION = 'ff561046-58e7-428d-9163-f6e60b0dab65'
DEADLINE = '2026-10-06T15:59:10Z'
MODULES = ('continuation_release', 'cutover_runtime', 'financial_completion', 'financial_delta', 'completion_snapshot',
    'application_reports', 'psql_transaction', 'projection_sql', 'inspection_sql',
    'projection_fence', 'continuation_runner', 'continuation_evidence', 'continuation_legacy',
    'continuation_checks', 'owned_transaction_drain', 'continuation_root')
FILES = frozenset(name+'.py' for name in MODULES) | {
    'continuation_release.py', 'financial_report.sql', 'financial_snapshot.sql'}
STAT_FIELDS = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink',
    'st_size', 'st_mtime_ns', 'st_ctime_ns')


def require(condition):
    if not condition:
        raise ValueError('continuation_release_refused')


def pin(value):
    return type(value) is str and re.fullmatch('[a-f0-9]{64}', value) is not None


def fingerprint(info):
    return tuple(getattr(info, field) for field in STAT_FIELDS)


def protected_bytes(path, digest):
    require(isinstance(path, Path))
    require(path.is_absolute() and '..' not in path.parts and pin(digest))
    parents = {parent: parent.lstat() for parent in path.parents}
    require(all(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0
        and not info.st_mode & 0o7022 for info in parents.values()))
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == before.st_gid == 0
        and before.st_nlink == 1 and stat.S_IMODE(before.st_mode) == 0o600
        and 0 < before.st_size <= 16000000)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as handle:
        opened = os.fstat(handle.fileno())
        raw = handle.read(16000001)
        after = os.fstat(handle.fileno())
    require(all(fingerprint(before) == fingerprint(info) for info in (opened, after, path.lstat()))
        and len(raw) == before.st_size and hashlib.sha256(raw).hexdigest() == digest
        and all(fingerprint(parent.lstat()) == fingerprint(info) for parent, info in parents.items()))
    return raw


def decode(raw):
    def unique(pairs):
        result = {}
        for name, value in pairs:
            require(name not in result)
            result[name] = value
        return result
    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=unique,
            parse_constant=lambda value: require(False))
    except Exception:
        raise ValueError('continuation_release_refused') from None


def capture_release(directory, seal):
    try:
        require(directory.is_absolute() and '..' not in directory.parts and pin(seal))
        raw = protected_bytes(directory/'release.json', seal)
        require(hashlib.sha256(raw).hexdigest() == seal)
        manifest = decode(raw)
        require(type(manifest) is dict and set(manifest) == {
            'kind', 'operationId', 'executionDeadline', 'files'} and manifest['kind'] == KIND
            and manifest['operationId'] == OPERATION and manifest['executionDeadline'] == DEADLINE)
        pins = manifest['files']
        require(type(pins) is dict and set(pins) == FILES and all(pin(value) for value in pins.values()))
        captured = {}
        for name in sorted(FILES):
            source = protected_bytes(directory/name, pins[name])
            require(type(source) is bytes and 0 < len(source) <= 16000000
                and hashlib.sha256(source).hexdigest() == pins[name])
            captured[name] = source
        return captured
    except Exception:
        raise ValueError('continuation_release_refused') from None


def load_modules(directory, captured):
    require(set(captured) == FILES and all(name not in sys.modules for name in MODULES))
    loaded = {}
    for name in MODULES:
        module = ModuleType(name)
        module.__file__ = str(directory/(name+'.py'))
        sys.modules[name] = module
        loaded[name] = module
        exec(compile(captured[name+'.py'], module.__file__, 'exec'), module.__dict__)
    return loaded


def checked_root(root, directory):
    for name in ('prepare', 'guard', 'journal', 'reconcile', 'close'):
        callback = getattr(root, name, None)
        code = getattr(callback, '__code__', None)
        require(callable(callback) and type(code) is CodeType
            and code.co_filename == str(directory/'continuation_root.py')
            and callback.__globals__.get('__file__') == str(directory/'continuation_root.py'))
    return root


def main(arguments=None):
    root, result, stage = None, None, 'sealed-root-inputs'
    try:
        arguments = sys.argv[1:] if arguments is None else arguments
        require(os.geteuid() == 0 and sys.flags.isolated and not sys.flags.optimize
            and len(arguments) == 1 and pin(arguments[0]))
        directory = Path(__file__).absolute().parent
        captured = capture_release(directory, arguments[0])
        loaded = load_modules(directory, captured)

        def verify():
            require(capture_release(directory, arguments[0]) == captured
                and all(sys.modules.get(name) is module and module.__file__ == str(directory/(name+'.py'))
                    for name, module in loaded.items()))

        verify()
        root = checked_root(loaded['continuation_root'].prepare_root(captured), directory)
        stage = 'continuation'
        result = loaded['continuation_runner'].run_continuation(root, loaded, captured, verify)
    except Exception:
        result = dict(status='existing-payment-continuation-refused', stage=stage, redacted=True,
            financialCommitted=None if stage == 'continuation' else False,
            financialActionAttempted=None if stage == 'continuation' else False,
            newPaymentStarted=False, automaticRetryAttempted=False)
    finally:
        if root is not None:
            try:
                root.close()
            except Exception:
                result.update(status='existing-payment-continuation-unconfirmed',
                    financialCompleted=False, financialCommitted=None, rootCleanupConfirmed=False)
    print(json.dumps(result, sort_keys=True))
    return 0 if result['status'] == 'existing-payment-continuation-completed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
