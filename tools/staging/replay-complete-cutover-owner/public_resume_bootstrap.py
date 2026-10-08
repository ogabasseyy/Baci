"""Separate sealed public-only entrypoint; never invokes the financial runner."""

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from types import ModuleType


HERE = Path(__file__).resolve().parent
R2 = Path('/root/baci-existing-continuation-r2.w2fa2hp8')
R2_SEAL = 'b236f0d961601aa0b7b305605c2554f42c241180a86de733cc6b078240a54613'
RELEASE_PIN = '1d54d0c6f5592e9cada78a55553e2e116671c20f543e7de606507dccf794f221'
LOCAL = ('public_resume', 'owned_public_stop', 'public_resume_runtime', 'public_resume_adapter')
FILES = {name + '.py' for name in LOCAL} | {'public_resume_bootstrap.py', 'continuation_release.py'}
FINGERPRINT = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
CONFIGS = {'/opt/baci-prefunded-public/config/checkout.json': '5953209ee31ebfe4290f227d7c0f5254ba251e2c4f9fc9d763af2a6d9320e67f',
    '/opt/baci-prefunded-public/config/anon.json': '4763e070945b3ab7a954c12e8da7ed9d3cd79b44b30ef6843eb2da567126934e'}
MANIFEST = '/root/baci-public-readonly-r4.dzbLtcKe/public-app.manifest.json'


def require(value):
    if not value:
        raise ValueError('public_bootstrap_refused')


def pin(value):
    return type(value) is str and re.fullmatch('[a-f0-9]{64}', value) is not None


def decode(raw):
    def unique(pairs):
        result = {}
        for name, value in pairs:
            require(name not in result)
            result[name] = value
        return result
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: require(False))


def protected(path, expected):
    require(path.is_absolute() and '..' not in path.parts and pin(expected))
    parents = {parent: parent.lstat() for parent in path.parents}
    require(all(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0
        and not info.st_mode & 0o022 for info in parents.values()))
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == before.st_gid == 0
        and stat.S_IMODE(before.st_mode) == 0o600 and before.st_nlink == 1 and 0 < before.st_size <= 16000000)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as handle:
        opened = os.fstat(handle.fileno())
        raw = handle.read(16000001)
        after = os.fstat(handle.fileno())
    fingerprint = lambda info: tuple(getattr(info, field) for field in FINGERPRINT)
    require(all(fingerprint(before) == fingerprint(info) for info in (opened, after, path.lstat()))
        and len(raw) == before.st_size and hashlib.sha256(raw).hexdigest() == expected
        and all(fingerprint(parent.lstat()) == fingerprint(info) for parent, info in parents.items()))
    return raw


def capture(seal):
    manifest = decode(protected(HERE/'public-release.json', seal))
    require(type(manifest) is dict and set(manifest) == {'kind', 'files', 'reviewed', 'reviewedSha256'}
        and manifest['kind'] == 'sealed-postcredit-public-only-resume')
    files, reviewed = manifest['files'], manifest['reviewed']
    require(type(files) is dict and set(files) == FILES and all(pin(value) for value in files.values())
        and files['continuation_release.py'] == RELEASE_PIN)
    require(type(reviewed) is dict and reviewed.get('configPins') == CONFIGS
        and reviewed.get('manifestPath') == MANIFEST and pin(manifest['reviewedSha256'])
        and hashlib.sha256(json.dumps(reviewed, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
            == manifest['reviewedSha256'])
    captured = {name: protected(HERE/name, digest) for name, digest in files.items()}
    return manifest, captured


def make_manifest(reviewed, captured):
    require(type(captured) is dict and set(captured) == FILES and all(type(raw) is bytes for raw in captured.values())
        and hashlib.sha256(captured['continuation_release.py']).hexdigest() == RELEASE_PIN)
    require(type(reviewed) is dict and reviewed.get('configPins') == CONFIGS and reviewed.get('manifestPath') == MANIFEST)
    encoded = json.dumps(reviewed, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
    return dict(kind='sealed-postcredit-public-only-resume',
        files={name: hashlib.sha256(raw).hexdigest() for name, raw in captured.items()},
        reviewed=decode(encoded), reviewedSha256=hashlib.sha256(encoded).hexdigest())


def load(captured):
    require(all(name not in sys.modules for name in LOCAL))
    release = ModuleType('public_authenticated_r2_release')
    release.__file__ = str(HERE/'continuation_release.py')
    exec(compile(captured['continuation_release.py'], release.__file__, 'exec'), release.__dict__)
    original = release.capture_release(R2, R2_SEAL)
    require(original['continuation_release.py'] == captured['continuation_release.py'])
    modules = release.load_modules(R2, original)
    for name in LOCAL:
        module = ModuleType(name)
        module.__file__ = str(HERE/(name+'.py'))
        sys.modules[name] = module
        exec(compile(captured[name+'.py'], module.__file__, 'exec'), module.__dict__)
        modules[name] = module
    return modules, original


def late_refusal(callbacks, previous, resume):
    stopped, terminal = None, None
    if callbacks.attempted:
        try:
            observed = callbacks.inspect(resume.CID)
            require(observed['Id'] == resume.CID and observed['Name'] == '/' + resume.NAME and observed['Image'] == resume.IMAGE)
            callbacks.run([*resume.DOCKER, 'stop', '--time', '5', resume.CID], timeout=15)
            terminal = resume._terminal(callbacks.start_job_state, callbacks.submitted, callbacks.clock)
            observed = callbacks.inspect(resume.CID)
            require(observed['Id'] == resume.CID and observed['Name'] == '/' + resume.NAME and observed['Image'] == resume.IMAGE
                and type(observed['State']['Running']) is bool)
            stopped = False if observed['State']['Running'] else True if terminal else None
        except Exception:
            pass
    return dict(status='public-resume-refused', stage='final-seal-guard', startAttempted=callbacks.attempted,
        startJobTerminal=terminal, ownedContainerStopped=stopped, priorPublicResult=previous, redacted=True)


def invoke(modules, original, manifest, verify, apply=False):
    root, result = None, None
    try:
        require(verify() is True)
        root = modules['continuation_root'].prepare_root(original)
        adapter = modules['public_resume_adapter']
        callbacks = adapter.PublicCallbacks(root, adapter.AUDIT_PINS, verify)
        reviewed = manifest['reviewed']
        if apply:
            result = callbacks.resume(reviewed, manifest['reviewedSha256'])
        else:
            resume = modules['public_resume']
            require(callbacks.exclusive() is True and callbacks.deadline()['epoch'] == 1791302350)
            origins = (callbacks.read, callbacks.inventory, callbacks.inspect, callbacks.unit_state,
                callbacks.collect_completed, callbacks.deadline, callbacks.exclusive, callbacks.run,
                callbacks.start_job_state, callbacks.clock)
            captured = resume._inputs(reviewed, callbacks.read, callbacks.inventory, origins)
            resume._container(callbacks.inspect, reviewed['container'], False)
            resume._unit(callbacks.unit_state, captured[resume.UNIT], False)
            resume._completion(callbacks.collect_completed, callbacks.clock, resume._history(reviewed, captured))
            require(callbacks.exclusive() is True and callbacks.clock() < resume.DEADLINE)
            result = dict(status='public-resume-preflight-only', publicStartAttempted=False, financialActionAttempted=False)
        try:
            require(verify() is True)
        except Exception:
            result = late_refusal(callbacks, result, modules['public_resume'])
    finally:
        if root is not None:
            try:
                if result is not None:
                    raw = json.dumps(dict(kind='postcredit-public-only-resume', result=result,
                        financialActionAttempted=False), sort_keys=True, separators=(',', ':')).encode()
                    root.context.owner.write(root.audit/'public-resume-result.json', raw)
            except Exception:
                result = dict(status='public-resume-audit-unconfirmed', publicResult=result, operatorReviewRequired=True)
            finally:
                try:
                    root.close()
                except Exception:
                    result = dict(status='public-resume-cleanup-unconfirmed', publicResult=result, operatorReviewRequired=True)
    return result


def main(arguments=None):
    try:
        arguments = sys.argv[1:] if arguments is None else arguments
        require(os.geteuid() == 0 and sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode
            and not sys.flags.optimize and HERE.parent == Path('/root')
            and len(arguments) in (1, 2) and pin(arguments[0])
            and (len(arguments) == 1 or arguments[1] == '--apply'))
        info = HERE.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o700)
        manifest, captured = capture(arguments[0])
        modules, original = load(captured)

        def verify():
            require(capture(arguments[0]) == (manifest, captured))
            release = modules['continuation_release']
            require(release.capture_release(R2, R2_SEAL) == original)
            for name, module in modules.items():
                directory = HERE if name in LOCAL else R2
                require(sys.modules.get(name) is module and module.__file__ == str(directory/(name+'.py')))
            return True

        result = invoke(modules, original, manifest, verify, len(arguments) == 2)
        print(json.dumps(result))
        return 0 if result['status'] in ('public-resume-preflight-only', 'public-service-resumed') else 1
    except Exception:
        print(json.dumps(dict(status='public-bootstrap-refused', redacted=True, operatorReviewRequired=True)))
        return 1


if __name__ == '__main__':
    sys.exit(main())
