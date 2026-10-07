import json
from pathlib import Path
import re
import stat
import subprocess
from treasury_owner_contract import CONTAINER, ENVIRONMENT, PSQL, SYSTEM, Refused
from treasury_owner_io import private_directory, read_file, write_private


DOCKER = ['/usr/bin/docker', '--host=unix:///var/run/docker.sock']


def readiness_failure(output):
    try:
        report = json.loads(output)
        if (not isinstance(report, dict) or set(report) != {'status', 'redacted', 'cardPaymentsEnabled', 'diagnostic'}
                or report['status'] != 'refused' or report['redacted'] is not True
                or report['cardPaymentsEnabled'] is not False):
            return None
        diagnostic = report['diagnostic']
        if not isinstance(diagnostic, dict) or set(diagnostic) != {'profile', 'phase', 'code'}:
            return None
        allowed = {
            'profile': ('worker', 'authorizer', 'evidence', 'unknown'),
            'phase': ('configuration', 'statement-validation', 'executor-initialization', 'readiness-result',
                      'connect', 'begin', 'identity-query', 'identity-validation', 'session-query',
                      'session-validation', 'operation', 'result-validation', 'commit', 'commit-validation', 'deadline'),
            'code': ('unclassified', '28P01', '28000', '42501', '42803', '42P01', '42883', '42703', '57014',
                     'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET',
                     'ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
                     'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED'),
        }
        if any(diagnostic[key] not in values for key, values in allowed.items()):
            return None
        return 'Runtime readiness refused: ' + ' '.join(f'{key}={diagnostic[key]}' for key in allowed)
    except (ValueError, TypeError):
        return None


def command(arguments, input_text=None, timeout=30):
    result = subprocess.run(arguments, input=input_text, stdin=None if input_text is not None else subprocess.DEVNULL,
                            text=True, capture_output=True, timeout=timeout, env=ENVIRONMENT)
    if result.returncode or len(result.stdout) > 1_000_000:
        if (len(result.stdout) <= 8192 and len(arguments) == 4 and arguments[0] == '/usr/bin/node'
                and Path(arguments[1]).name == 'runtime-readiness-cli.cjs' and arguments[2] == '--connect'):
            diagnostic = readiness_failure(result.stdout)
            if diagnostic:
                raise Refused(diagnostic)
        code = re.search(r'^ERROR:\s+([A-Z0-9]{5})\s*$', result.stderr, re.MULTILINE)
        raise Refused('Runtime command refused' + (': SQLSTATE ' + code[1] if code else ''))
    return result.stdout


def inspect(container):
    value = json.loads(command([*DOCKER, 'inspect', container]))
    if not isinstance(value, list) or len(value) != 1 or value[0].get('State', {}).get('Running') is not True:
        raise Refused('Expected staging container unavailable')
    return value[0]


def database(sql, container=CONTAINER, psql=PSQL, user='postgres'):
    return command([*DOCKER, 'exec', '-i', container, psql, '-XqAt', '-v', 'ON_ERROR_STOP=1',
                    '-v', 'VERBOSITY=sqlstate', '-U', user, '-d', 'postgres'], sql)


def probe(sql):
    return json.loads(database(f"""BEGIN READ ONLY; SET LOCAL statement_timeout='5s';
      DO $$ BEGIN IF (SELECT system_identifier::text FROM pg_control_system())<>'{SYSTEM}'
        THEN RAISE EXCEPTION 'wrong database'; END IF; END $$;
      {sql}
      ROLLBACK;"""))


def save_exact(path, value):
    content = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
    if path.is_symlink():
        raise Refused('Existing private output retained')
    if path.exists():
        if read_file(path, 0, 0o600, 131072) != content:
            raise Refused('Existing private output differs')
    else:
        write_private(path, content)


def legacy_replay_directory(path, owner):
    private_directory(path.parent, owner)
    metadata = path.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != owner or stat.S_IMODE(metadata.st_mode) != 0o755:
        raise Refused('Legacy replay directory metadata refused')


def read_replay_inputs(owner):
    base = Path('/home/bassey/pvb-staging-replay/config')
    receipts = Path('/home/bassey/pvb-staging-receipts')
    legacy_replay_directory(base, owner)
    private_directory(receipts, owner)
    original = json.loads(read_file(base / 'config.json', owner, 0o444, 32768))
    configuration = read_file(receipts / 'postgrest.conf', owner, 0o444, 32768).decode()
    values = {}
    for name in ('jwt-secret', 'jwt-aud'):
        matches = re.findall(r'^\s*' + re.escape(name) + r'\s*=\s*("[^"\n]+")\s*$', configuration, re.MULTILINE)
        if len(matches) != 1:
            raise Refused('Receipt signing configuration refused')
        values[name] = json.loads(matches[0])
    if values['jwt-aud'] != 'pvb-staging-receipts':
        raise Refused('Receipt signing audience refused')
    app = inspect('baci-isolated-savings-rest-1')['Config']
    if app.get('Labels', {}).get('com.docker.compose.project') != 'baci-isolated-savings':
        raise Refused('Staging project identity refused')
    matches = [item.removeprefix('PGRST_JWT_SECRET=') for item in app.get('Env', [])
               if item.startswith('PGRST_JWT_SECRET=')]
    if len(matches) != 1:
        raise Refused('Application signing configuration refused')
    return original, {'receiptToken': values['jwt-secret'], 'appToken': matches[0]}
