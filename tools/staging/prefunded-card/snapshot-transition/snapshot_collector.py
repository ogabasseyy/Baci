import hashlib
import json
from pathlib import Path
import sys

from transition_constants import MODULES, SEAL, SYSTEM, TABLES


def _modules(bundle, seal_sha):
    root = Path(bundle)
    if seal_sha != SEAL or not root.is_absolute() or root != root.resolve():
        raise ValueError('snapshot_collector_r8_root_refused')
    raw = (root / 'financial-preparation.json').read_bytes()
    if hashlib.sha256(raw).hexdigest() != seal_sha:
        raise ValueError('snapshot_collector_r8_seal_refused')
    manifest = json.loads(raw)
    modules = {}
    pins = {}
    for name, relative in MODULES.items():
        expected = root / relative
        module = sys.modules.get(name)
        if (getattr(module, '__file__', None) != str(expected) or expected != expected.resolve()
                or hashlib.sha256(expected.read_bytes()).hexdigest() != manifest['files'][relative]):
            raise ValueError('snapshot_collector_executing_source_refused')
        modules[name] = module
        pins[relative] = manifest['files'][relative]
    source = root / 'tooling/card-week-renewal/sealed-source.json'
    if (source != source.resolve() or hashlib.sha256(source.read_bytes()).hexdigest()
            != manifest['files']['tooling/card-week-renewal/sealed-source.json']
            or modules['source_functions'].SEALED != json.loads(source.read_bytes())):
        raise ValueError('snapshot_collector_loaded_source_contract_refused')
    pins['tooling/card-week-renewal/sealed-source.json'] = hashlib.sha256(source.read_bytes()).hexdigest()
    for name, functions in (('database_sql', ('_protected_state_expression',)),
            ('protected_snapshot', ('protected_expression', 'snapshot_sql'))):
        for function_name in functions:
            function = getattr(modules[name], function_name)
            if (function.__globals__.get('__file__') != modules[name].__file__
                    or function.__code__.co_filename != modules[name].__file__):
                raise ValueError('snapshot_collector_function_origin_refused')
    snapshot = modules['protected_snapshot']
    if (tuple(snapshot.TABLES) != TABLES or modules['source_functions'].APP_SYSTEM != SYSTEM
            or snapshot._protected_state_expression is not modules['database_sql']._protected_state_expression):
        raise ValueError('snapshot_collector_protected_contract_refused')
    return modules, pins


def _security():
    schemas = "'public','prefunded_card','piggyvest_savings_ledger','piggyvest_staging'"
    scope = f'namespace.nspname IN ({schemas})'
    relation_scope = ('JOIN pg_class relation ON relation.oid=TABLE_ID '
                      'JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace')
    pieces = [f"""'schemas',(SELECT jsonb_agg(to_jsonb(namespace) ORDER BY oid)
        FROM pg_namespace namespace WHERE {scope}),
      'relations',(SELECT jsonb_agg(jsonb_build_object('oid',relation.oid,'name',relname,
        'kind',relkind,'owner',relowner,'acl',relacl,'rls',relrowsecurity,'forceRls',relforcerowsecurity,
        'persistence',relpersistence,'partition',relispartition,'options',reloptions) ORDER BY relation.oid)
        FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relnamespace WHERE {scope}),
      'routines',(SELECT jsonb_object_agg(routine.oid::regprocedure::text,jsonb_build_object(
        'oid',routine.oid,'owner',pg_get_userbyid(proowner),'language',language.lanname,
        'definer',prosecdef,'configuration',proconfig,'acl',proacl::text,
        'sourceSha256',encode(sha256(convert_to(prosrc,'UTF8')),'hex'),
        'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(routine.oid),'UTF8')),'hex')))
        FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid=pronamespace
        JOIN pg_language language ON language.oid=prolang WHERE {scope} AND prokind IN ('f','p'))"""]
    for name, catalog, alias, identity, column in (
            ('columns', 'pg_attribute', 'column_row', 'attrelid,attnum', 'attrelid'),
            ('policies', 'pg_policy', 'policy', 'policy.oid', 'polrelid'),
            ('triggers', 'pg_trigger', 'trigger_row', 'trigger_row.oid', 'tgrelid'),
            ('rules', 'pg_rewrite', 'rule_row', 'rule_row.oid', 'ev_class'),
            ('indexes', 'pg_index', 'index_row', 'indexrelid', 'indrelid')):
        joins = relation_scope.replace('TABLE_ID', alias + '.' + column)
        pieces.append(f"'{name}',(SELECT coalesce(jsonb_agg(to_jsonb({alias}) ORDER BY {identity}),'[]'::jsonb) "
                      f'FROM {catalog} {alias} {joins} WHERE {scope})')
    pieces.append(f"""'constraints',(SELECT coalesce(jsonb_agg(to_jsonb(constraint_row) ORDER BY constraint_row.oid),'[]'::jsonb)
      FROM pg_constraint constraint_row JOIN pg_namespace namespace ON namespace.oid=connamespace WHERE {scope}),
      'types',(SELECT coalesce(jsonb_agg(to_jsonb(type_row) ORDER BY type_row.oid),'[]'::jsonb)
      FROM pg_type type_row JOIN pg_namespace namespace ON namespace.oid=typnamespace WHERE {scope}),
      'enums',(SELECT coalesce(jsonb_agg(to_jsonb(enum_row) ORDER BY enum_row.oid),'[]'::jsonb)
      FROM pg_enum enum_row JOIN pg_type type_row ON type_row.oid=enumtypid
      JOIN pg_namespace namespace ON namespace.oid=typnamespace WHERE {scope}),
      'ranges',(SELECT coalesce(jsonb_agg(to_jsonb(range_row) ORDER BY rngtypid),'[]'::jsonb)
      FROM pg_range range_row JOIN pg_type type_row ON type_row.oid=rngtypid
      JOIN pg_namespace namespace ON namespace.oid=typnamespace WHERE {scope}),
      'defaultAcls',(SELECT coalesce(jsonb_agg(to_jsonb(default_acl) ORDER BY default_acl.oid),'[]'::jsonb)
      FROM pg_default_acl default_acl WHERE defaclnamespace=0 OR defaclnamespace IN
      (SELECT namespace.oid FROM pg_namespace namespace WHERE {scope}))""")
    pieces.append("""'roles',(SELECT jsonb_agg(to_jsonb(role_row) ORDER BY oid)
      FROM pg_roles role_row),
      'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(membership) ORDER BY roleid,member),'[]'::jsonb)
      FROM pg_auth_members membership)""")
    return 'jsonb_build_object(' + ','.join(pieces) + ')'


def sql(bundle, seal_sha=SEAL):
    modules, pins = _modules(bundle, seal_sha)
    expression = modules['protected_snapshot'].protected_expression()
    provenance = json.dumps({'sealSha256': seal_sha, 'modules': pins}, separators=(',', ':'))
    return f"""BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='3s';
SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path=pg_catalog;
DO $identity$ BEGIN IF session_user<>'postgres' OR current_database()<>'postgres'
 OR inet_client_addr() IS NOT NULL
 OR (SELECT system_identifier::text FROM pg_control_system())<>'{SYSTEM}' THEN
 RAISE EXCEPTION 'snapshot transition identity refused'; END IF; END $identity$;
WITH material AS MATERIALIZED (SELECT ({expression}) AS state),
bindings AS MATERIALIZED (SELECT coalesce(jsonb_agg(to_jsonb(binding) ORDER BY to_jsonb(binding)::text COLLATE "C"),'[]'::jsonb) AS rows,
 coalesce(jsonb_agg(to_jsonb(binding)::text ORDER BY to_jsonb(binding)::text COLLATE "C"),'[]'::jsonb) AS canonical
 FROM prefunded_card.treasury_bindings binding),
snapshots AS MATERIALIZED (SELECT coalesce(jsonb_agg(to_jsonb(snapshot) ORDER BY to_jsonb(snapshot)::text COLLATE "C"),'[]'::jsonb) AS rows,
 coalesce(jsonb_agg(to_jsonb(snapshot)::text ORDER BY to_jsonb(snapshot)::text COLLATE "C"),'[]'::jsonb) AS canonical,
 encode(sha256(convert_to(coalesce(string_agg(to_jsonb(snapshot)::text,E'\\n' ORDER BY to_jsonb(snapshot)::text COLLATE "C"),''),'UTF8')),'hex') AS sha
 FROM prefunded_card.treasury_snapshots snapshot),
security AS MATERIALIZED (SELECT ({_security()}) AS detail)
SELECT jsonb_build_object('version',1,'capturedAt',clock_timestamp(),
 'sources','{provenance}'::jsonb,
 'protected',jsonb_build_object('systemIdentifier','{SYSTEM}',
   'readOnly',current_setting('transaction_read_only')='on',
   'protectedFinancialSha256',encode(sha256(convert_to((state->'financial')::text,'UTF8')),'hex'),
   'tables',state->'tables'),
 'financial',state->'financial','financialCanonical',(state->'financial')::text,
 'bindings',jsonb_build_object('rows',bindings.rows,'canonicalRows',bindings.canonical),
 'snapshots',jsonb_build_object('rows',snapshots.rows,'canonicalRows',snapshots.canonical,'sha256',snapshots.sha),
 'security',jsonb_build_object('detail',security.detail,'canonical',security.detail::text,
   'sha256',encode(sha256(convert_to(security.detail::text,'UTF8')),'hex')))
FROM material CROSS JOIN bindings CROSS JOIN snapshots CROSS JOIN security;
ROLLBACK;
"""
