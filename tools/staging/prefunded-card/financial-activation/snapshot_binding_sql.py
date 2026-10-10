from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'card-week-renewal'))
from release_contract import DEADLINE, HEX, _require
from source_functions import APP_SYSTEM, OLD_DEADLINE
from protected_snapshot import TABLES, protected_expression

ROLE = 'prefunded_snapshot_verifier'
BINDING = 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57'
TABLE = 'prefunded_card.treasury_verifier_bindings'
TRIGGER = 'prefunded_treasury_verifier_immutable'
LOCKED = ('public.customer_savings_goals', *TABLES)


def metadata_expression():
    return f"""jsonb_build_object(
      'bindingHash',(SELECT encode(sha256(convert_to((to_jsonb(binding)-'expires_at')::text,'UTF8')),'hex')
        FROM {TABLE} binding WHERE login_name='{ROLE}'),
      'bindingExpiry',(SELECT to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
        FROM {TABLE} WHERE login_name='{ROLE}'),
      'roleExpiry',(SELECT to_char(rolvaliduntil AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
        FROM pg_authid WHERE rolname='{ROLE}'),
      'rolesHash',(SELECT encode(sha256(convert_to(jsonb_build_object(
        'roles',(SELECT jsonb_agg(to_jsonb(role_row)-CASE WHEN rolname='{ROLE}'
          THEN 'rolvaliduntil' ELSE '__no_removed_field__' END ORDER BY rolname)
          FROM pg_authid role_row WHERE rolname IN ('{ROLE}','prefunded_treasury_verifier')),
        'members',(SELECT coalesce(jsonb_agg(to_jsonb(member_row) ORDER BY roleid,member),'[]'::jsonb)
          FROM pg_auth_members member_row WHERE roleid IN (SELECT oid FROM pg_roles WHERE rolname IN
            ('{ROLE}','prefunded_treasury_verifier')) OR member IN (SELECT oid FROM pg_roles WHERE rolname IN
            ('{ROLE}','prefunded_treasury_verifier'))))::text,'UTF8')),'hex')),
      'tableHash',(SELECT encode(sha256(convert_to(jsonb_build_object(
        'table',to_jsonb(relation),'schema',to_jsonb(namespace),
        'constraints',(SELECT jsonb_agg(to_jsonb(constraint_row) ORDER BY oid)
          FROM pg_constraint constraint_row WHERE conrelid=relation.oid),
        'triggers',(SELECT jsonb_agg(to_jsonb(trigger_row) ORDER BY oid)
          FROM pg_trigger trigger_row WHERE tgrelid=relation.oid),
        'policies',(SELECT jsonb_agg(to_jsonb(policy_row) ORDER BY oid)
          FROM pg_policy policy_row WHERE polrelid=relation.oid),
        'indexes',(SELECT jsonb_agg(to_jsonb(index_row) ORDER BY indexrelid)
          FROM pg_index index_row WHERE indrelid=relation.oid),
        'routines',(SELECT jsonb_agg(to_jsonb(routine) ORDER BY oid) FROM pg_proc routine
          WHERE pronamespace=relation.relnamespace),
        'relationAcls',(SELECT jsonb_agg(jsonb_build_object('oid',oid,'owner',relowner,'acl',relacl) ORDER BY oid)
          FROM pg_class acl_relation WHERE relnamespace=relation.relnamespace),
        'databaseAcl',(SELECT datacl FROM pg_database WHERE datname=current_database()))::text,'UTF8')),'hex')
        FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
        WHERE relation.oid='{TABLE}'::regclass),
      'protectedHash',encode(sha256(convert_to(({protected_expression()})::text,'UTF8')),'hex'))"""


def identity_guard(system=APP_SYSTEM, owner='postgres'):
    fixture = system != APP_SYSTEM
    _require((not fixture and owner == 'postgres') or (fixture and owner == 'harness_admin'
             and isinstance(system, str) and system.isdecimal()), 'snapshot_renewal_identity_refused')
    return f"""IF current_database()<>'postgres' OR current_user<>'{owner}' OR session_user<>'{owner}'
      OR inet_client_addr() IS NOT NULL OR (SELECT system_identifier::text FROM pg_control_system())<>'{system}'
      OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper) THEN
      RAISE EXCEPTION 'snapshot renewal owner identity refused' USING ERRCODE='42501'; END IF;"""


def collect_sql():
    return (f"""BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='10s'; SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path=pg_catalog;
DO $owner$ BEGIN {identity_guard()} END $owner$;
SELECT jsonb_build_object('readOnly',current_setting('transaction_read_only')='on',
  'systemIdentifier','{APP_SYSTEM}','observedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'metadata',{metadata_expression()});
ROLLBACK;
""").encode()


def render(baseline, repository, rehearsal=True, now=None):
    return _render(baseline, repository, rehearsal, now, APP_SYSTEM, 'postgres')


def _render(baseline, repository, rehearsal, now, system, owner):
    _require(type(rehearsal) is bool, 'snapshot_renewal_mode_refused')
    current = datetime.now(timezone.utc) if now is None else now
    try:
        observed = datetime.fromisoformat(baseline['observedAt'].replace('Z', '+00:00'))
        age = (current - observed).total_seconds()
    except (ValueError, TypeError, KeyError):
        raise ValueError('snapshot_renewal_baseline_stale') from None
    _require(0 <= age <= 300 and current.timestamp() < 1791301750,
             'snapshot_renewal_baseline_stale')
    _require(baseline.get('systemIdentifier') == system and baseline.get('readOnly') is True,
             'snapshot_renewal_baseline_identity_refused')
    meta = baseline.get('metadata', {})
    _require(set(meta) == {'bindingHash','bindingExpiry','roleExpiry','rolesHash','tableHash','protectedHash'}
             and all(isinstance(meta.get(key), str) and HEX.fullmatch(meta[key]) for key in
                     ('bindingHash','rolesHash','tableHash','protectedHash'))
             and meta.get('bindingExpiry') in (OLD_DEADLINE, DEADLINE)
             and meta.get('roleExpiry') in (OLD_DEADLINE, DEADLINE), 'snapshot_renewal_baseline_refused')
    source_path = repository / 'tools/staging/prefunded-card/treasury-storage.sql'
    _require(not source_path.is_symlink(), 'snapshot_immutable_source_drift')
    source = source_path.read_bytes()
    _require(hashlib.sha256(source).hexdigest() ==
        'cf590f9bda15df2923822f342ae54090acdabb391a7b1c02ebc839b8c0d46ac0',
        'snapshot_immutable_source_drift')
    import re
    body = re.search(rb'CREATE FUNCTION prefunded_card\.guard_treasury_identity\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;', source)
    _require(body is not None, 'snapshot_immutable_source_missing')
    guard_md5 = hashlib.md5(body[1]).hexdigest()
    guard_acl = f'{{{owner}=X/{owner}}}'
    expected = json.dumps(meta, sort_keys=True, separators=(',', ':'))
    next_meta = {**meta, 'bindingExpiry': DEADLINE, 'roleExpiry': DEADLINE}
    expected_after = json.dumps(next_meta, sort_keys=True, separators=(',', ':'))
    return (f"""\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s';
SET LOCAL idle_in_transaction_session_timeout='30s';
SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path=pg_catalog;
DO $owner$ BEGIN {identity_guard(system, owner)} END $owner$;
LOCK TABLE {TABLE} IN ACCESS EXCLUSIVE MODE;
LOCK TABLE {','.join(LOCKED)} IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE pg_catalog.pg_authid,pg_catalog.pg_auth_members,pg_catalog.pg_proc,
  pg_catalog.pg_namespace,pg_catalog.pg_class,pg_catalog.pg_database IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
BEGIN
  IF clock_timestamp()>='{DEADLINE}'::timestamptz OR ({metadata_expression()}) IS DISTINCT FROM
    $baseline${expected}$baseline$::jsonb THEN
    RAISE EXCEPTION 'snapshot renewal baseline drift or deadline expired' USING ERRCODE='55000'; END IF;
  IF (SELECT count(*) FROM {TABLE})<>1 OR NOT EXISTS(SELECT 1 FROM {TABLE}
    WHERE login_name='{ROLE}' AND treasury_binding_id='{BINDING}' AND system_identifier='{system}')
    OR NOT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='relation'
      AND relation='{TABLE}'::regclass AND mode='AccessExclusiveLock' AND granted)
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='{ROLE}' AND rolcanlogin AND NOT rolinherit
      AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb
      AND NOT rolreplication AND rolconnlimit=-1)
    OR NOT EXISTS(SELECT 1 FROM pg_authid WHERE rolname='{ROLE}' AND rolpassword IS NOT NULL)
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='prefunded_treasury_verifier' AND NOT rolcanlogin
      AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication)
    OR (SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='{ROLE}'))<>1
    OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='{ROLE}')
      AND roleid=(SELECT oid FROM pg_roles WHERE rolname='prefunded_treasury_verifier')
      AND NOT admin_option AND NOT inherit_option AND NOT set_option)
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname='{ROLE}')
      OR member=(SELECT oid FROM pg_roles WHERE rolname='prefunded_treasury_verifier'))
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='{TABLE}'::regclass AND tgname='{TRIGGER}'
      AND NOT tgisinternal AND tgenabled='O' AND tgtype=27
      AND tgfoid='prefunded_card.guard_treasury_identity()'::regprocedure)
    OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='prefunded_card.guard_treasury_identity()'::regprocedure
      AND md5(prosrc)='{guard_md5}' AND NOT prosecdef AND proconfig=ARRAY['search_path=pg_catalog']
      AND proowner=(SELECT oid FROM pg_roles WHERE rolname='{owner}')
      AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
      AND prokind='f' AND prorettype='trigger'::regtype AND proacl::text='{guard_acl}') THEN
    RAISE EXCEPTION 'snapshot renewal protected identity or immutable guard refused' USING ERRCODE='55000'; END IF;
END $preflight$;
ALTER TABLE {TABLE} DISABLE TRIGGER {TRIGGER};
UPDATE {TABLE} SET expires_at='{DEADLINE}'::timestamptz
  WHERE login_name='{ROLE}' AND treasury_binding_id='{BINDING}' AND system_identifier='{system}'
    AND expires_at='{OLD_DEADLINE}'::timestamptz;
ALTER TABLE {TABLE} ENABLE TRIGGER {TRIGGER};
DO $role_expiry$ BEGIN
  IF (SELECT rolvaliduntil FROM pg_authid WHERE rolname='{ROLE}')='{OLD_DEADLINE}'::timestamptz THEN
    ALTER ROLE {ROLE} VALID UNTIL '{DEADLINE}'; END IF;
END $role_expiry$;
DO $postflight$
BEGIN
  IF clock_timestamp()>='{DEADLINE}'::timestamptz OR ({metadata_expression()}) IS DISTINCT FROM
    $baseline${expected_after}$baseline$::jsonb THEN
    RAISE EXCEPTION 'snapshot renewal restoration or protected state refused' USING ERRCODE='55000'; END IF;
END $postflight$;
{'ROLLBACK' if rehearsal else 'COMMIT'};
""").encode()
