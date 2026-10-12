"""Sealed executable notification-only adapter. Default execution is RO preflight."""

import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from types import ModuleType


R2 = Path('/root/baci-existing-continuation-r2.w2fa2hp8')
R2_SEAL = 'b236f0d961601aa0b7b305605c2554f42c241180a86de733cc6b078240a54613'
PINS = {'continuation_release.py': '1d54d0c6f5592e9cada78a55553e2e116671c20f543e7de606507dccf794f221',
    'public_resume.py': '897aa81a788fa29a5c79f152cfa81a3f8f43e5fb5e2da815c6481acc19fa4028',
    'owned_public_stop.py': '0ebbdaae762f2db668a7e91e69ab8927a7e8a2165afa761bbbf07fad0a77a928',
    'public_resume_runtime.py': '854360452017277d28b760420cf833e82f8cc5d6a75a3dd4db5144707d372edc',
    'public_resume_adapter.py': '5c5b34239c6dca71552d95ae6237d0321700091208480eb2a4a64079ada9a7a1',
    'notification-scope-query.sql': '1c7a8d44fb84f37d2357509abeefbc5d8465bdd1d7094c25beaa81ad8e3c30a7',
    'notification-role-guard.sql': '9384fd9054ac08fc88b799ab7dfd666ca77dd049e12d9c7757d405bbf63d3e63',
    'approved-scope.json': '5dfda373c8461831031380c9f2defeff49f3e28a37ca049fd006f578e40e3d09'}
LOCAL = ('public_resume', 'owned_public_stop', 'public_resume_runtime', 'public_resume_adapter', 'notification_contract',
    'notification_io', 'notification_resume', 'notification_scope', 'notification_collection',
    'notification_systemd', 'notification_adapter', 'notification_timer_resume')
FILES = {name+'.py' for name in LOCAL} | set(PINS) | {'notification_cli.py', 'approved-snapshot.json'}
KIND = 'sealed-notification-timer-only-resume'
FIELDS = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')


def require(value):
    if not value:
        raise ValueError('notification_cli_refused')


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def decode(raw):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value)
            value[key] = item
        return value
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: require(False))


def protected(path, pin):
    require(path.is_absolute() and '..' not in path.parts and re.fullmatch('[a-f0-9]{64}', pin))
    parents = {parent: parent.lstat() for parent in path.parents}
    require(all(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0
        and not info.st_mode & 0o7022 for info in parents.values()))
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == before.st_gid == 0
        and stat.S_IMODE(before.st_mode) == 0o600 and before.st_nlink == 1 and 0 < before.st_size <= 16000000)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as handle:
        opened, raw = os.fstat(handle.fileno()), handle.read(16000001)
        after = os.fstat(handle.fileno())
    fingerprint = lambda info: tuple(getattr(info, field) for field in FIELDS)
    require(all(fingerprint(before) == fingerprint(info) for info in (opened, after, path.lstat()))
        and len(raw) == before.st_size and hashlib.sha256(raw).hexdigest() == pin
        and all(fingerprint(parent.lstat()) == fingerprint(info) for parent, info in parents.items()))
    return raw


def check_files(files):
    require(type(files) is dict and set(files) == FILES and all(type(raw) is bytes for raw in files.values())
        and all(hashlib.sha256(files[name]).hexdigest() == pin for name, pin in PINS.items()))


def capture(directory, seal):
    manifest = decode(protected(directory/'notification-release.json', seal))
    require(type(manifest) is dict and set(manifest) == {'kind', 'files', 'reviewed'} and manifest['kind'] == KIND
        and type(manifest['files']) is dict and set(manifest['files']) == FILES)
    files = {name: protected(directory/name, pin) for name, pin in manifest['files'].items()}
    check_files(files)
    reviewed = manifest['reviewed']
    require(type(reviewed) is dict and set(reviewed) == {'public', 'publicRunning', 'authRows', 'expectedEvents'}
        and type(reviewed['publicRunning']) is bool and type(reviewed['authRows']) is dict
        and type(reviewed['expectedEvents']) is list)
    return manifest, files


def load(directory, files):
    check_files(files)
    release = ModuleType('notification_authenticated_r2_release')
    release.__file__ = str(directory/'continuation_release.py')
    exec(compile(files['continuation_release.py'], release.__file__, 'exec'), release.__dict__)
    original = release.capture_release(R2, R2_SEAL)
    require(original['continuation_release.py'] == files['continuation_release.py'])
    modules = release.load_modules(R2, original)
    require(all(name not in sys.modules for name in LOCAL))
    for name in LOCAL:
        module = ModuleType(name)
        module.__file__ = str(directory/(name+'.py'))
        sys.modules[name] = module
        exec(compile(files[name+'.py'], module.__file__, 'exec'), module.__dict__)
        modules[name] = module
    return modules, original


def validate_auth_rows(auth_rows):
    require(type(auth_rows) is dict and len(auth_rows) <= 32)
    for name, transition in auth_rows.items():
        require(type(name) is str and re.fullmatch(r'auth\.[a-z_][a-z0-9_]*', name)
            and type(transition) is dict and set(transition) == {'before', 'current'})
        for witness in transition.values():
            require(type(witness) is dict and set(witness) == {'oid', 'count', 'sha256'}
                and type(witness['oid']) is int and 0 < witness['oid'] < 2**32
                and type(witness['count']) is int and witness['count'] >= 0
                and type(witness['sha256']) is str and re.fullmatch('[a-f0-9]{64}', witness['sha256']))
        require(transition['before']['oid'] == transition['current']['oid'])


def approve_snapshot(base, current, approved, historical, auth_rows):
    validate_auth_rows(auth_rows)
    for snapshot in (current, approved, historical):
        base.financial_delta._snapshot(snapshot)
        require(snapshot['readOnly'] is True)
    base.same(current, approved)
    old = copy.deepcopy(historical)
    require(set(old['tableRows']) == set(approved['tableRows']))
    changed = {name for name in old['tableRows'] if old['tableRows'][name] != approved['tableRows'][name]}
    require(changed == set(auth_rows))
    for name, transition in auth_rows.items():
        require(transition['before'] == historical['tableRows'][name]
            and transition['current'] == approved['tableRows'][name])
        old['tableRows'][name] = copy.deepcopy(transition['current'])
    base.same(old, approved)


def withdraw(callbacks):
    if callbacks is None or not callbacks.attempted:
        return None
    try:
        callbacks.run(['/usr/bin/systemctl', 'stop', 'baci-savings-notifications.timer',
            'baci-savings-notifications.service'], timeout=30)
        return True if callbacks.cleanup_confirmed is True else None
    except Exception:
        return None


def invoke(modules, original, files, reviewed, sources, verify, apply=False):
    root, callbacks, result = None, None, None
    try:
        require(verify() is True)
        adapter = modules['notification_adapter']
        root = adapter.ReadonlyRoot(original)
        reviewed = decode(encode(reviewed))
        reviewed['public']['sources'] = sources
        callbacks = adapter.NotificationCallbacks(root, verify, reviewed, files)
        bundle, scope = callbacks.collect(), callbacks.scope_collect()
        base, fence = modules['notification_resume'], modules['notification_scope']
        base.same(bundle['protectedSnapshot'], scope['protectedSnapshot'])
        approved = decode(files['approved-snapshot.json'])
        historical = decode(callbacks.audits['completed'])['reconciliation']['collection']['protectedSnapshot']
        approve_snapshot(base, scope['protectedSnapshot'], approved, historical, reviewed['authRows'])
        approved_scope = decode(files['approved-scope.json'])
        require(scope['database'] == approved_scope['database'])
        require(scope['scope'] == {**approved_scope['scope'], 'capturedAt': scope['scope']['capturedAt']})
        fence.verify_transition(scope['scope'], scope['scope'], reviewed['expectedEvents'])
        for name, value in (('postcredit.json', bundle), ('scope-baseline.json', scope)):
            root.context.owner.write(root.audit/name, encode(value))
        inspected = dict(sources=sources, baselinePath=str(root.audit/'postcredit.json'),
            baselineSha256=hashlib.sha256(encode(bundle)).hexdigest(), assets=base.ASSET_PINS)
        timer_review = dict(inspection=inspected, scopeBaselinePath=str(root.audit/'scope-baseline.json'),
            scopeBaselineSha256=hashlib.sha256(encode(scope)).hexdigest(), expectedEvents=reviewed['expectedEvents'])
        require(verify() is True and callbacks.exclusive() is True)
        if apply:
            result = modules['notification_timer_resume'].restore_timer(reviewed=timer_review,
                reviewed_sha256=hashlib.sha256(encode(timer_review)).hexdigest(), read=callbacks.read,
                state=callbacks.state, collect=callbacks.collect, scope_collect=callbacks.scope_collect,
                exclusive=callbacks.exclusive, run=callbacks.run, job_state=callbacks.job_state,
                settle=callbacks.settle, clock=callbacks.clock)
        else:
            check = base.inspect_or_restore_check(reviewed=inspected,
                reviewed_sha256=hashlib.sha256(encode(inspected)).hexdigest(), read=callbacks.read,
                state=callbacks.state, collect=callbacks.collect, exclusive=callbacks.exclusive,
                run=callbacks.run, job_state=callbacks.job_state, clock=callbacks.clock)
            require(check['status'] == 'notification-resume-inspected' and check['protectedStateUnchanged'] is True)
            result = dict(status='notification-timer-preflight-only', timerStartAttempted=False,
                schedulingRestored=False, financialActionAttempted=False, newPaymentStarted=False)
        require(verify() is True)
    except Exception:
        cleanup = withdraw(callbacks)
        result = dict(status='notification-cli-refused', redacted=True, schedulingRestored=False,
            timerStartAttempted=callbacks.attempted if callbacks else False,
            cleanupConfirmed=cleanup, operatorReviewRequired=True, financialActionAttempted=False)
    finally:
        if root is not None:
            try:
                root.context.owner.write(root.audit/'result.json', encode(result))
            except Exception:
                result = dict(status='notification-audit-unconfirmed', priorResult=result,
                    cleanupConfirmed=withdraw(callbacks), schedulingRestored=False, operatorReviewRequired=True)
            try:
                root.close()
            except Exception:
                result = dict(status='notification-lock-cleanup-unconfirmed', priorResult=result,
                    schedulingRestored=False, operatorReviewRequired=True)
    return result


def main(arguments=None):
    try:
        arguments = sys.argv[1:] if arguments is None else arguments
        directory = Path(__file__).resolve().parent
        require(os.geteuid() == 0 and sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode
            and not sys.flags.optimize and directory.parent == Path('/root')
            and len(arguments) in (1, 2) and re.fullmatch('[a-f0-9]{64}', arguments[0])
            and (len(arguments) == 1 or arguments[1] == '--apply'))
        metadata = directory.lstat()
        require(stat.S_ISDIR(metadata.st_mode) and metadata.st_uid == metadata.st_gid == 0
            and stat.S_IMODE(metadata.st_mode) == 0o700)
        manifest, files = capture(directory, arguments[0])
        modules, original = load(directory, files)

        def verify():
            require(capture(directory, arguments[0]) == (manifest, files)
                and modules['continuation_release'].capture_release(R2, R2_SEAL) == original)
            for name, module in modules.items():
                parent = directory if name in LOCAL else R2
                require(sys.modules.get(name) is module and module.__file__ == str(parent/(name+'.py')))
            return True

        sources = {str(directory/name): hashlib.sha256(raw).hexdigest() for name, raw in files.items()
            if name.endswith(('.py', '.sql'))}
        sources.update({str(R2/name): hashlib.sha256(raw).hexdigest() for name, raw in original.items()})
        result = invoke(modules, original, files, manifest['reviewed'], sources, verify, len(arguments) == 2)
    except Exception:
        result = dict(status='notification-bootstrap-refused', redacted=True, schedulingRestored=False)
    print(json.dumps(result, sort_keys=True))
    return 0 if result['status'] in ('notification-timer-resumed', 'notification-timer-preflight-only') else 1


if __name__ == '__main__':
    raise SystemExit(main())
