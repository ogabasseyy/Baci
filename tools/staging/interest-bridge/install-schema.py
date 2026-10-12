import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys


PINS = {
    '20260926170000_piggyvest_interest_bridge.sql':
        '9f548fe5e3ef1bd33f654c959a4b87c40d50d37e12fb4894f59fb6b884211e76',
    '20261001140000_piggyvest_interest_existing_authority.sql':
        'f66593aa128e72d4cefb1f58ac726e9c8db09cffcd760e6830593fc3a18e8bac',
}
GUARD_PIN = '2cc893a951ac5ba9304e99c3d4a0932b2ed4e1c051124210a90d7340be6f39b9'
DATABASE = ['docker', 'exec', '-i', 'baci-isolated-savings-db-1',
            'psql', '-XqAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']


def protected_read(file_path):
    descriptor = os.open(file_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o022:
            raise ValueError('Unsafe reviewed input')
        if not 0 < info.st_size <= 65536:
            raise ValueError('Oversized reviewed input')
        with os.fdopen(descriptor, 'rb', closefd=False) as handle:
            return handle.read(65537)
    finally:
        os.close(descriptor)


def render_sql(migrations, template, apply=False):
    if hashlib.sha256(template.encode()).hexdigest() != GUARD_PIN:
        raise ValueError('Reviewed guard pin differs')
    bodies = []
    for name, pin in PINS.items():
        raw = migrations[name]
        if hashlib.sha256(raw).hexdigest() != pin:
            raise ValueError('Reviewed migration pin differs')
        source = raw.decode('utf-8').strip()
        if not source.startswith('BEGIN;') or not source.endswith('COMMIT;'):
            raise ValueError('Reviewed transaction framing differs')
        body = source[len('BEGIN;'):-len('COMMIT;')]
        if 'COMMIT;' in body or 'ROLLBACK;' in body or '\\' in body:
            raise ValueError('Unexpected transaction escape')
        bodies.append(body)
    authority = bodies[-1]
    definition = authority.split('AS $$', 1)[1].split('$$;', 1)[0]
    if any(template.count(marker) != 1 for marker in
           ('__MIGRATIONS__', '__AUTHORITY_MD5__', '__FINISH__')):
        raise ValueError('Reviewed guard markers differ')
    return template.replace('__MIGRATIONS__', '\n'.join(bodies)).replace(
        '__AUTHORITY_MD5__', hashlib.md5(definition.encode()).hexdigest()).replace(
        '__FINISH__', 'COMMIT;' if apply else 'ROLLBACK;')


def main():
    if sys.argv[1:] not in [['--rehearse'], ['--apply']]:
        raise ValueError('Choose an explicit installation mode')
    directory = Path(__file__).absolute().parent
    migrations = {name: protected_read(directory / name) for name in PINS}
    template = protected_read(directory / 'schema-guard.sql').decode('utf-8')
    apply = sys.argv[1] == '--apply'
    candidate = render_sql(migrations, template, apply)
    result = subprocess.run(DATABASE, input=candidate, text=True, capture_output=True, timeout=60,
                            env={'HOME': os.environ['HOME'], 'PATH': '/usr/sbin:/usr/bin:/sbin:/bin',
                                 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'})
    if result.returncode:
        raise ValueError('Database guard refused; transaction not confirmed')
    print(json.dumps(dict(status='schema-installed-inactive' if apply else 'rehearsal-rolled-back',
                         changesMade=apply, workerStarted=False, workerAccessGranted=False,
                         allocationCreated=False, creditApplied=False,
                         principalKobo=10000, treasuryAvailableKobo=10000,
                         sqlSha256=hashlib.sha256(candidate.encode()).hexdigest())))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps(dict(status='refused', reason=str(error) if isinstance(error, ValueError)
                              else 'Reviewed schema installation refused', redacted=True)))
        raise SystemExit(1)
