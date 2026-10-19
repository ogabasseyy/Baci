import json
from pathlib import Path
import activation_contract as contract


REVOKE = """BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 IF session_user<>'postgres' OR current_database()<>'postgres'
  OR (SELECT system_identifier::text FROM pg_control_system())<>'7685292944002592802'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=
   'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)'::regprocedure)
   IS DISTINCT FROM 'e889259e0d0361ab352e52d06b4ce69d' THEN
  RAISE EXCEPTION 'interest authority rollback refused'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)
 FROM prefunded_treasury_operator;
REVOKE USAGE ON SCHEMA piggyvest_savings_ledger FROM prefunded_treasury_operator;
DO $$ BEGIN IF has_function_privilege('prefunded_treasury_operator',
 'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)','EXECUTE')
 OR has_schema_privilege('prefunded_treasury_operator','piggyvest_savings_ledger','USAGE') THEN
 RAISE EXCEPTION 'authority still present'; END IF; END $$;
COMMIT;"""


def stop_runtime(command, docker):
    failures = []
    for name in (contract.SERVICE,):
        try:
            path = Path('/etc/systemd/system') / name
            if path.exists():
                if path.read_bytes() != contract.unit_files()[name]:
                    raise ValueError('recovery-unit-drift')
                command(['/usr/bin/systemctl', 'stop', name], checked=False)
                result = command(['/usr/bin/systemctl', 'show', name,
                    '--property=ActiveState', '--value'], checked=False)
                if result.stdout.strip() not in ('inactive', 'failed'):
                    raise ValueError('recovery-service-unconfirmed')
        except Exception:
            failures.append('unit-stop-unconfirmed')
    for name in (contract.CONTAINER, contract.CONTAINER+'-check'):
        try:
            value = docker(['inspect', name], checked=False)
            if value.returncode:
                if docker(['ps', '-aq', '--filter', 'name=^/'+name+'$']).stdout.strip():
                    raise ValueError('recovery-container-unconfirmed')
                continue
            observed = json.loads(value.stdout)[0]
            if observed['Name'] != '/'+name or observed['Image'] != contract.IMAGE:
                raise ValueError('recovery-container-drift')
            if observed['State']['Running']:
                docker(['stop', '--time', '10', observed['Id']])
            if json.loads(docker(['inspect', observed['Id']]).stdout)[0]['State']['Running']:
                raise ValueError('recovery-container-running')
        except Exception:
            failures.append('container-stop-unconfirmed')
    return failures


def recover(state, command, docker, database):
    failures = stop_runtime(command, docker) if state.get('targetCreated') else []
    revoked = not state.get('grantAttempted')
    if state.get('grantAttempted'):
        try:
            database(REVOKE)
            revoked = True
        except Exception:
            failures.append('grant-revoke-unconfirmed')
    return dict(newRuntimeStopped=not any('stop-' in failure for failure in failures),
                bridgeGrantRolledBack=revoked, retainedPrivateFiles=bool(state.get('targetCreated')),
                failures=failures)
