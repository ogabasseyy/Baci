import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys


SYSTEM_ID = '7685292944002592802'
CONTAINER = 'baci-isolated-savings-db-1'
SQL_SHA256 = 'ff3332f1b0902b9aa6fcc0f18788bd9a6af081f81d7f153a7ed4e18c8634e165'
ENVIRONMENT = {'HOME': '/root', 'PATH': '/usr/sbin:/usr/bin:/sbin:/bin',
               'LANG': 'C', 'LC_ALL': 'C'}


class Refused(RuntimeError):
    pass


def read_query(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as handle:
        metadata = os.fstat(handle.fileno())
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0
                or metadata.st_nlink != 1 or stat.S_IMODE(metadata.st_mode) != 0o400
                or not 0 < metadata.st_size <= 16384):
            raise Refused('unsafe_sql_file')
        content = handle.read(16385)
    if hashlib.sha256(content).hexdigest() != SQL_SHA256:
        raise Refused('sql_checksum_mismatch')
    return content.decode('utf-8')


def query_database(statement, run=subprocess.run):
    result = run([
        '/usr/bin/docker', 'exec', '-i', CONTAINER, '/usr/bin/psql', '-X',
        '--set=ON_ERROR_STOP=1', '--quiet', '--tuples-only', '--no-align',
        '-U', 'postgres', '-d', 'postgres',
    ], input=statement, text=True, capture_output=True, timeout=20,
        check=False, env=ENVIRONMENT)
    if result.returncode:
        raise Refused('database_read_refused')
    try:
        payload = json.loads(result.stdout)
    except (ValueError, TypeError):
        raise Refused('database_result_refused') from None
    if (not isinstance(payload, dict) or payload.get('systemIdentifier') != SYSTEM_ID
            or payload.get('readOnly') is not True):
        raise Refused('database_identity_refused')
    return payload


def container_network(run=subprocess.run):
    result = run([
        '/usr/bin/docker', 'inspect', '--format',
        '{{json .NetworkSettings.Networks}}', CONTAINER,
    ], text=True, capture_output=True, timeout=10, check=False, env=ENVIRONMENT)
    if result.returncode:
        raise Refused('container_network_refused')
    try:
        networks = json.loads(result.stdout)
        return [{'network': name, 'address': value['IPAddress']}
                for name, value in sorted(networks.items())]
    except (ValueError, KeyError, AttributeError, TypeError):
        raise Refused('container_network_refused') from None


def inspect(directory, run=subprocess.run):
    if os.geteuid() != 0:
        raise Refused('root_required')
    metadata = directory.lstat()
    if (not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0
            or stat.S_IMODE(metadata.st_mode) != 0o700
            or directory.parent != Path('/root')):
        raise Refused('root_directory_required')
    query = read_query(directory / 'activation-readiness.sql')
    database = query_database(query, run)
    return {'stage': 'activation-readiness', 'readOnly': True,
            'database': database, 'networks': container_network(run),
            'changesMade': False}


def main():
    try:
        if len(sys.argv) != 1:
            raise Refused('arguments_refused')
        print(json.dumps(inspect(Path(__file__).resolve().parent), separators=(',', ':')))
        return 0
    except Refused as error:
        print(json.dumps({'stage': 'activation-readiness', 'status': 'refused',
                          'reason': str(error), 'changesMade': False}))
        return 1
    except Exception:
        print(json.dumps({'stage': 'activation-readiness', 'status': 'refused',
                          'reason': 'inspection_unavailable', 'changesMade': False}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
