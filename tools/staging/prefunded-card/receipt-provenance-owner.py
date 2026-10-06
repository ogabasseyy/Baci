import hashlib
import http.client
import json
import os
from pathlib import Path
import pwd
import re
import subprocess
import time
from receipt_provenance_artifact import replace_intake_artifact
from receipt_provenance_contract import (
    BASELINE, DIRECTORY, SERVER, SYSTEM, parse_json, schema_query,
    validate_container, validate_manifest, validate_schema,
)
from treasury_owner_contract import DEADLINE, DEADLINE_EPOCH, ENVIRONMENT, Refused
from treasury_owner_io import private_directory, read_file, root_ancestors, write_private


SQLSTATE_ERROR = re.compile(r'^ERROR:\s+([0-9A-Z]{5})(?:\s|:|$)', re.MULTILINE)


class CommandFailure(Refused):
    def __init__(self, message='Reviewed receipt command failed', exit_code=None, sqlstate=None):
        super().__init__(message)
        self.exit_code = exit_code
        self.sqlstate = sqlstate


class StageFailure(Refused):
    def __init__(self, stage, message='Receipt owner action incomplete', exit_code=None, sqlstate=None):
        super().__init__(message)
        self.stage = stage
        self.exit_code = exit_code
        self.sqlstate = sqlstate


def command(arguments, content=None):
    try:
        result = subprocess.run(arguments, input=content, stdin=None if content is not None else subprocess.DEVNULL,
                                text=True, capture_output=True, timeout=40, env=ENVIRONMENT)
    except (OSError, subprocess.SubprocessError):
        raise CommandFailure() from None
    if result.returncode or len(result.stdout) > 2_000_000:
        sqlstate = None
        if '-v' in arguments and 'VERBOSITY=sqlstate' in arguments:
            match = SQLSTATE_ERROR.search(result.stderr)
            sqlstate = match.group(1) if match else None
        raise CommandFailure(exit_code=result.returncode, sqlstate=sqlstate)
    return result.stdout


def database(sql):
    return command(['/usr/bin/docker', '--host=unix:///var/run/docker.sock', 'exec', '-i',
                    'pvb-staging-receipts-db', 'psql', '-XqAt', '-U', 'supabase_admin', '-d', 'postgres',
                    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate',
                    '-v', 'expected_system_identifier=' + SYSTEM], sql)


def probe():
    return parse_json(database("BEGIN READ ONLY; SET LOCAL statement_timeout='5s';" + schema_query() + 'ROLLBACK;'))


def lease():
    if time.time() >= DEADLINE_EPOCH:
        raise Refused('Fixed staging deadline expired')


def run_stage(stage, operation):
    try:
        return operation()
    except StageFailure as error:
        raise StageFailure(stage, exit_code=error.exit_code, sqlstate=error.sqlstate) from None
    except Exception as error:
        raise StageFailure(stage, exit_code=getattr(error, 'exit_code', None),
                           sqlstate=getattr(error, 'sqlstate', None)) from None


def activate(deps):
    run_stage('preflight', lease)
    run_stage('preflight', deps.preflight)
    run_stage('schema-apply', deps.apply_schema)
    run_stage('schema-verify', deps.verify_schema)
    run_stage('rpc-check', deps.rpc_check)
    run_stage('backup', lease)
    run_stage('backup', deps.backup)
    try:
        run_stage('install', deps.install)
        run_stage('restart', deps.restart)
        run_stage('health', deps.health)
        run_stage('health', lease)
    except StageFailure as failure:
        if not deps.replacement_started:
            raise StageFailure(failure.stage, 'Receipt activation refused before replacement; current intake retained',
                               failure.exit_code, failure.sqlstate) from None
        try:
            run_stage('rollback', deps.restore)
            run_stage('rollback', deps.restart)
            run_stage('rollback', deps.old_health)
        except StageFailure as rollback_failure:
            raise StageFailure('rollback', 'Receipt activation failed; intake restoration unconfirmed',
                               rollback_failure.exit_code, rollback_failure.sqlstate) from None
        raise StageFailure(failure.stage,
                           'Receipt activation failed; original intake restored; additive schema retained',
                           failure.exit_code, failure.sqlstate) from None
    return dict(status='original-signature-capture-ready', cardPaymentsEnabled=False,
                prefundedReplayEnabled=False, historicalSignaturesRecovered=False, expiresAt=DEADLINE)


def refusal_payload(error):
    stage = getattr(error, 'stage', 'preflight')
    reason = str(error) if isinstance(error, StageFailure) else 'Receipt owner action incomplete'
    payload = dict(status='refused', reason=reason, stage=stage,
                   cardPaymentsEnabled=False, redacted=True)
    exit_code = getattr(error, 'exit_code', None)
    sqlstate = getattr(error, 'sqlstate', None)
    if exit_code is not None or sqlstate is not None:
        payload['command'] = {'exitCode': exit_code}
        if sqlstate is not None:
            payload['command']['sqlstate'] = sqlstate
    return payload


class Installer:
    def __init__(self, directory):
        self.directory = directory
        root_ancestors(directory / 'manifest.json')
        private_directory(directory)
        read = lambda name: read_file(directory / name, 0, 0o600, 12_000_000)
        self.contents = validate_manifest(parse_json(read('manifest.json')), read)
        self.candidate = self.contents['intake-server.mjs']
        self.digest = hashlib.sha256(self.candidate).hexdigest()
        self.source = self.contents['receipt-signature-storage.sql'].decode('utf8')
        self.owner = pwd.getpwnam('bassey').pw_uid
        self.replacement_started = False

    def inspect(self):
        return parse_json(command(['/usr/bin/docker', 'inspect', 'pvb-staging-intake']))[0]

    def preflight(self):
        private_directory(DIRECTORY, self.owner)
        validate_container(self.inspect())
        metadata = Path(SERVER).lstat()
        if metadata.st_uid not in (0, self.owner):
            raise Refused('Unexpected intake source owner')
        self.original = read_file(SERVER, metadata.st_uid, 0o444, 12_000_000)
        self.original_digest = hashlib.sha256(self.original).hexdigest()
        self.original_uid, self.original_gid = metadata.st_uid, metadata.st_gid
        if self.original_digest not in (BASELINE, self.digest):
            raise Refused('Intake source changed; no replacement performed')
        self._health(self.original_digest)
        self.state = probe()
        if self.state.get('system') != SYSTEM:
            raise Refused('Receipt database identity mismatch')
        if self.state.get('table') or self.state.get('functions'):
            validate_schema(self.state, self.source)

    def apply_schema(self):
        lease()
        if not self.state['table']:
            database(self.source)

    def verify_schema(self):
        validate_schema(probe(), self.source)

    def rpc_check(self):
        script = """const fs=require('node:fs');
const config=JSON.parse(fs.readFileSync('/run/pvb-intake/config.json','utf8'));
if(config.environment!=='staging')process.exit(1);
fetch('http://pvb-staging-receipts-rest:3000/rpc/accept_signed_piggyvest_staging_receipt',{
 method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
 headers:{Authorization:'Bearer '+config.restToken,'Content-Type':'application/json'},
 body:JSON.stringify({p_payload_sha256:'a'.repeat(64),p_ciphertext:'YWJj',p_nonce:'AAAAAAAAAAAAAAAA',
 p_auth_tag:'AAAAAAAAAAAAAAAAAAAAAA==',p_key_version:'staging-v1',p_original_signature:''})
}).then(async response=>{const body=await response.json();
 if(response.status!==400||body.code!=='22023')process.exit(1);
 process.stdout.write('RESTRICTED_SIGNED_RPC_READY');}).catch(()=>process.exit(1));"""
        for attempt in range(5):
            try:
                result = command(['/usr/bin/docker', 'exec', 'pvb-staging-intake', 'node', '-e', script])
                if result != 'RESTRICTED_SIGNED_RPC_READY':
                    raise Refused('Restricted signed RPC did not pass')
                return
            except Refused:
                if attempt == 4:
                    raise
                time.sleep(1)

    def backup(self):
        write_private(self.directory / 'intake-before.mjs', self.original)

    def install(self):
        lease()
        metadata = Path(SERVER).lstat()
        if read_file(SERVER, metadata.st_uid, 0o444, 12_000_000) != self.original:
            raise Refused('Intake changed since backup')
        self.replacement_started = True
        replace_intake_artifact(DIRECTORY, self.candidate, (self.original,), 0, 0, self.owner, self.directory)

    def restore(self):
        metadata = Path(SERVER).lstat()
        current = read_file(SERVER, metadata.st_uid, 0o444, 12_000_000)
        if current not in (self.original, self.candidate):
            raise Refused('Foreign intake change retained for owner review')
        replace_intake_artifact(DIRECTORY, self.original, (self.original, self.candidate),
                                self.original_uid, self.original_gid, self.owner, self.directory)

    def restart(self):
        command(['/usr/bin/docker', 'restart', '--time', '15', 'pvb-staging-intake'])

    def _health(self, digest):
        mounted = command(['/usr/bin/docker', 'exec', 'pvb-staging-intake',
                           'sha256sum', '/app/intake-server.mjs']).split()[0]
        if mounted != digest:
            raise Refused('Running intake artifact differs')
        for attempt in range(8):
            try:
                for method, expected in [('GET', 405), ('POST', 401)]:
                    connection = http.client.HTTPConnection('127.0.0.1', 4791, timeout=3)
                    try:
                        connection.request(method, '/piggyvest/intake')
                        response = connection.getresponse()
                        raw = response.read(2049)
                        if response.status != expected or len(raw) > 2048 or 'error' not in parse_json(raw):
                            raise Refused('Intake health response refused')
                    finally:
                        connection.close()
                return
            except (OSError, Refused):
                if attempt == 7:
                    raise Refused('Intake health checks failed') from None
                time.sleep(1)

    def health(self):
        validate_container(self.inspect())
        self._health(self.digest)

    def old_health(self):
        self._health(self.original_digest)


if __name__ == '__main__':
    try:
        if os.getuid() != 0:
            raise Refused('Owner privileges required')
        result = activate(Installer(Path(__file__).resolve().parent))
        print(json.dumps(result, separators=(',', ':')))
    except Exception as error:
        print(json.dumps(refusal_payload(error), separators=(',', ':')))
        raise SystemExit(1) from None
