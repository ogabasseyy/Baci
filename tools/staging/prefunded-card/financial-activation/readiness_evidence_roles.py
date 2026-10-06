import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time

from readiness_evidence_io import DEADLINE, HEX, check_output, decode, pinned, require, save, window
from runtime_owner_support import database
from treasury_owner_contract import SYSTEM, TREASURY

ROLES = ('prefunded_treasury_operator', 'prefunded_authorizer', 'prefunded_evidence', 'prefunded_snapshot_verifier')
HASHES = ('passwordSha256', 'attributesSha256', 'privilegesSha256', 'membershipSha256')
GUARD_MD5 = 'a01c66eb91554ee2febc54d79f791df0'
OLD = '2026-09-29T15:59:10Z'


def sql():
    names = ','.join("'" + role + "'" for role in ROLES)
    return f"""BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='3s';
SET LOCAL search_path=pg_catalog; SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN IF session_user<>'postgres' OR current_database()<>'postgres' OR inet_client_addr() IS NOT NULL
 OR (SELECT system_identifier::text FROM pg_control_system())<>'{SYSTEM}' THEN
 RAISE EXCEPTION 'identity refused'; END IF; END $$;
SELECT jsonb_build_object('systemIdentifier','{SYSTEM}','readOnly',current_setting('transaction_read_only')='on',
 'roles',(SELECT jsonb_object_agg(role.rolname,jsonb_build_object(
 'expiresAt',to_char(role.rolvaliduntil AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'unsafe',NOT role.rolcanlogin OR role.rolinherit OR role.rolsuper OR role.rolbypassrls OR role.rolcreaterole
   OR role.rolcreatedb OR role.rolreplication OR role.rolpassword IS NULL,
 'passwordSha256',encode(sha256(convert_to(coalesce(role.rolpassword,''),'UTF8')),'hex'),
 'attributesSha256',encode(sha256(convert_to((to_jsonb(role)-'rolvaliduntil'-'rolpassword')::text,'UTF8')),'hex'),
 'membershipSha256',encode(sha256(convert_to((SELECT coalesce(jsonb_agg(to_jsonb(membership)
   ORDER BY roleid,member),'[]'::jsonb) FROM pg_auth_members membership
   WHERE roleid=role.oid OR member=role.oid)::text,'UTF8')),'hex'),
 'privilegesSha256',encode(sha256(convert_to(jsonb_build_object(
   'schemas',(SELECT jsonb_agg(jsonb_build_object('oid',oid,'owner',nspowner,'acl',nspacl,
     'usage',has_schema_privilege(role.oid,oid,'USAGE'),'create',has_schema_privilege(role.oid,oid,'CREATE'))
     ORDER BY oid) FROM pg_namespace WHERE nspname IN ('public','prefunded_card','piggyvest_staging','piggyvest_savings_ledger')),
   'routines',(SELECT jsonb_agg(jsonb_build_object('oid',routine.oid,'owner',proowner,'acl',proacl,
     'definer',prosecdef,'config',proconfig,'language',prolang,
     'execute',has_function_privilege(role.oid,routine.oid,'EXECUTE')) ORDER BY routine.oid)
     FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid=pronamespace
     WHERE namespace.nspname IN ('public','prefunded_card','piggyvest_staging','piggyvest_savings_ledger')),
   'relations',(SELECT jsonb_agg(jsonb_build_object('oid',relation.oid,'owner',relowner,'acl',relacl,
     'rls',relrowsecurity,'forceRls',relforcerowsecurity,
     'select',has_table_privilege(role.oid,relation.oid,'SELECT'),
     'insert',has_table_privilege(role.oid,relation.oid,'INSERT'),
     'update',has_table_privilege(role.oid,relation.oid,'UPDATE'),
     'delete',has_table_privilege(role.oid,relation.oid,'DELETE'),
     'truncate',has_table_privilege(role.oid,relation.oid,'TRUNCATE')) ORDER BY relation.oid)
     FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relnamespace
     WHERE relkind IN ('r','p','v','m','f') AND namespace.nspname IN
       ('public','prefunded_card','piggyvest_staging','piggyvest_savings_ledger')),
   'database',(SELECT jsonb_build_object('acl',datacl,'owner',datdba) FROM pg_database
     WHERE datname=current_database()))::text,'UTF8')),'hex')))
   FROM pg_authid role WHERE rolname IN ({names})),
 'binding',(SELECT jsonb_build_object('identitySha256',encode(sha256(convert_to(
   (to_jsonb(binding)-'expires_at')::text,'UTF8')),'hex'),
   'expiresAt',to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
   FROM prefunded_card.treasury_verifier_bindings binding
   WHERE login_name='prefunded_snapshot_verifier' AND treasury_binding_id='{TREASURY}' AND system_identifier='{SYSTEM}'),
 'immutableGuardVerified',(SELECT count(*)=1 FROM pg_proc WHERE oid='prefunded_card.guard_treasury_identity()'::regprocedure
   AND md5(prosrc)='{GUARD_MD5}' AND NOT prosecdef AND proconfig=ARRAY['search_path=pg_catalog']
   AND proowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
   AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND prokind='f'
   AND prorettype='trigger'::regtype AND proacl::text='{{postgres=X/postgres}}')
   AND (SELECT count(*)=2 FROM pg_trigger WHERE tgrelid='prefunded_card.treasury_verifier_bindings'::regclass
     AND NOT tgisinternal AND tgenabled='O' AND tgfoid='prefunded_card.guard_treasury_identity()'::regprocedure
     AND ((tgname='prefunded_treasury_verifier_immutable' AND tgtype=27)
       OR (tgname='prefunded_treasury_verifier_no_truncate' AND tgtype=34)))
   AND (SELECT count(*)=1 FROM prefunded_card.treasury_verifier_bindings));
ROLLBACK;
"""


def collect(seal_sha, query=database, now=time.time):
    require(os.geteuid() == 0, 'root_required')
    window(now())
    require(isinstance(seal_sha, str) and HEX.fullmatch(seal_sha), 'seal_pin_refused')
    result = decode(query(sql()))
    result.update(sealSha256=seal_sha, observedAt=datetime.fromtimestamp(window(now()), timezone.utc).isoformat())
    validate(result)
    return result


def validate(value):
    require(isinstance(value, dict) and value.get('systemIdentifier') == SYSTEM
            and value.get('readOnly') is True and value.get('immutableGuardVerified') is True
            and isinstance(value.get('sealSha256'), str) and HEX.fullmatch(value['sealSha256'])
            and isinstance(value.get('roles'), dict) and set(value['roles']) == set(ROLES),
            'role_baseline_refused')
    for row in value['roles'].values():
        require(isinstance(row, dict) and set(row) == {'expiresAt', 'unsafe', *HASHES}
                and row['unsafe'] is False and row['expiresAt'] in (OLD, DEADLINE)
                and all(isinstance(row[name], str) and HEX.fullmatch(row[name]) for name in HASHES),
                'role_metadata_refused')
    require(isinstance(value.get('binding'), dict) and set(value['binding']) == {'identitySha256', 'expiresAt'}
            and isinstance(value['binding']['identitySha256'], str) and HEX.fullmatch(value['binding']['identitySha256'])
            and value['binding']['expiresAt'] in (OLD, DEADLINE), 'binding_metadata_refused')


def compare(before, after, now=None):
    current = window(now)
    for value in (before, after):
        validate(value)
        observed = datetime.fromisoformat(value['observedAt'].replace('Z', '+00:00'))
        require(observed.tzinfo is not None and 0 <= current - observed.timestamp() <= 300,
                'role_baseline_stale')
    require(before['sealSha256'] == after['sealSha256'], 'role_baseline_seal_mismatch')
    require(before['observedAt'] <= after['observedAt'], 'role_baseline_order_refused')
    for name in ROLES:
        previous, renewed = before['roles'][name], after['roles'][name]
        require(renewed['expiresAt'] == DEADLINE
                and all(previous[field] == renewed[field] for field in HASHES), 'role_fence_changed')
    require(after['binding']['expiresAt'] == DEADLINE and before['binding']['identitySha256'] ==
            after['binding']['identitySha256'], 'binding_fence_changed')
    return {'roles': {name: {'expiresAt': DEADLINE, 'passwordUnchanged': True, 'privilegesUnchanged': True,
        'membershipUnchanged': True, 'unsafe': False} for name in ROLES}, 'snapshotBinding': {
        'expiresAt': DEADLINE, 'identityUnchanged': True, 'immutableTriggerRestored': True}}


def main(argv=None):
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    collector = sub.add_parser('collect')
    collector.add_argument('--seal-sha256', required=True)
    comparator = sub.add_parser('compare')
    for name in ('before', 'after'):
        comparator.add_argument('--' + name, type=Path, required=True)
        comparator.add_argument('--' + name + '-sha256', required=True)
    for entry in (collector, comparator):
        entry.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        require(os.geteuid() == 0, 'root_required')
        check_output(args.output)
        if args.command == 'collect':
            report = collect(args.seal_sha256)
        else:
            values = [decode(pinned({'path': str(getattr(args, name)), 'sha256': getattr(args, name + '_sha256'),
                'owner': 0, 'mode': 0o600}, True)) for name in ('before', 'after')]
            report = compare(*values)
        evidence_sha = save(args.output, report)
        print(json.dumps({'status': 'role-evidence-collected', 'evidenceSha256': evidence_sha, 'readOnly': True}))
        return 0
    except Exception:
        print('{"status":"refused","reason":"readiness_evidence_roles_refused","redacted":true}')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
