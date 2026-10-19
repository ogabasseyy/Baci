"""Offline flat package producer; no root execution, credentials or subprocesses."""

import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tarfile

import notification_cli as cli


DEPENDENCIES = {'continuation_release.py', 'public_resume.py', 'owned_public_stop.py',
    'public_resume_runtime.py', 'public_resume_adapter.py'}


def validate_spec(spec):
    cli.require(type(spec) is dict and set(spec) == {'targetRoot', 'approvedSnapshotPath',
        'approvedSnapshotSha256', 'public', 'publicRunning', 'expectedEvents', 'authRows'})
    target = Path(spec['targetRoot'])
    cli.require(target.parent == Path('/root') and re.fullmatch(r'baci-notification-[a-zA-Z0-9_.-]+', target.name)
        and Path(spec['approvedSnapshotPath']).is_absolute()
        and re.fullmatch('[a-f0-9]{64}', spec['approvedSnapshotSha256'])
        and type(spec['public']) is dict and type(spec['publicRunning']) is bool
        and type(spec['expectedEvents']) is list)
    cli.validate_auth_rows(spec['authRows'])


def source_files(source, dependencies):
    files = {}
    for name in cli.FILES-{'approved-scope.json', 'approved-snapshot.json'}:
        directory = dependencies if name in DEPENDENCIES else source
        path = directory/name
        cli.require(path.is_file() and not path.is_symlink())
        files[name] = path.read_bytes()
        if name in cli.PINS:
            cli.require(hashlib.sha256(files[name]).hexdigest() == cli.PINS[name])
    return files


def produce(spec, dependencies, approved_scope, output):
    validate_spec(spec)
    cli.require(not output.exists() and output.is_absolute())
    files = source_files(Path(__file__).resolve().parent, dependencies)
    files['approved-snapshot.json'] = Path(spec['approvedSnapshotPath']).read_bytes()
    files['approved-scope.json'] = approved_scope.read_bytes()
    cli.require(hashlib.sha256(files['approved-snapshot.json']).hexdigest() == spec['approvedSnapshotSha256'])
    approved = cli.decode(files['approved-snapshot.json'])
    cli.require(type(approved) is dict and approved.get('readOnly') is True
        and approved.get('financialSnapshotVersion') == 1)
    cli.check_files(files)
    reviewed = {key: spec[key] for key in ('public', 'publicRunning', 'expectedEvents', 'authRows')}
    manifest = dict(kind=cli.KIND, files={name: hashlib.sha256(raw).hexdigest() for name, raw in files.items()},
        reviewed=reviewed)
    raw = cli.encode(manifest)
    output.mkdir(mode=0o700)
    for name, content in {**files, 'notification-release.json': raw}.items():
        descriptor = os.open(output/name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
            os.fchmod(handle.fileno(), 0o600)
    with tarfile.open(output/'notification-resume.tar', 'w', format=tarfile.USTAR_FORMAT) as archive:
        for name in sorted(files | {'notification-release.json': raw}):
            info = archive.gettarinfo(output/name, arcname=name)
            info.uid, info.gid, info.uname, info.gname, info.mode, info.mtime = 0, 0, 'root', 'root', 0o600, 0
            with (output/name).open('rb') as handle:
                archive.addfile(info, handle)
    seal = hashlib.sha256(raw).hexdigest()
    target = spec['targetRoot']
    return dict(status='notification-package-produced-source-only', fileCount=len(files), manifestSha256=seal,
        archiveSha256=hashlib.sha256((output/'notification-resume.tar').read_bytes()).hexdigest(),
        preflightCommand=f'/usr/bin/python3 -I -S -B {target}/notification_cli.py {seal}',
        applyCommand=f'/usr/bin/python3 -I -S -B {target}/notification_cli.py {seal} --apply',
        liveExecuted=False)


def main(arguments=None):
    try:
        arguments = sys.argv[1:] if arguments is None else arguments
        cli.require(len(arguments) == 4)
        spec = cli.decode(Path(arguments[0]).read_bytes())
        result = produce(spec, Path(arguments[1]).resolve(), Path(arguments[2]).resolve(), Path(arguments[3]).resolve())
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception:
        print(json.dumps(dict(status='notification-producer-refused', redacted=True, liveExecuted=False)))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
