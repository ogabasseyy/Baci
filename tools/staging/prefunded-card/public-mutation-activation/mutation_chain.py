import hashlib
import json

from mutation_contract import INTENT
from release_contract import HEX, _require
from source_functions import APP_SYSTEM, GOAL_ID, SEALED

SCHEMAS = "'public','prefunded_card','piggyvest_staging','piggyvest_savings_ledger'"


def sql():
    return f"""BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='3s';
SET LOCAL search_path=pg_catalog; SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN IF session_user<>'postgres' OR current_database()<>'postgres'
 OR inet_client_addr() IS NOT NULL
 OR (SELECT system_identifier::text FROM pg_control_system())<>'{APP_SYSTEM}' THEN
 RAISE EXCEPTION 'public mutation database identity refused'; END IF; END $$;
SELECT jsonb_build_object('systemIdentifier','{APP_SYSTEM}',
 'readOnly',current_setting('transaction_read_only')='on',
 'goal',(SELECT to_jsonb(goal) FROM public.customer_savings_goals goal
   WHERE id='{GOAL_ID}' AND merchant_id='10000000-0000-4000-8000-000000000001'
   AND customer_id='10000000-0000-4000-8000-000000000002'),
 'intent',(SELECT jsonb_build_object('id',id,'phase',phase,'amountKobo',amount_kobo,
   'expiresAt',to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
   FROM prefunded_card.checkout_intents WHERE id='{INTENT}'),
 'operation',(SELECT jsonb_build_object('retired',checkout_retired,'collection',collection_status,
   'transfer',transfer_status,'projection',projection_status)
   FROM prefunded_card.operations WHERE id='{INTENT}'),
 'intentCount',(SELECT count(*) FROM prefunded_card.checkout_intents),
 'operationCount',(SELECT count(*) FROM prefunded_card.operations),
 'retirementCount',(SELECT count(*) FROM prefunded_card.checkout_retirements),
 'companyTotalKobo',(SELECT opening_available_kobo + coalesce((SELECT sum(amount_kobo)
   FROM prefunded_card.treasury_replenishments WHERE treasury_binding_id=identity.treasury_binding_id),0)
   FROM prefunded_card.treasury_identities identity
   WHERE treasury_binding_id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57'),
 'treasury',(SELECT jsonb_build_object('available',verified_available_kobo,
   'reserved',reserved_kobo,'consumed',consumed_kobo,'enabled',enabled)
   FROM prefunded_card.treasury_bindings WHERE id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57'),
 'routines',(SELECT jsonb_object_agg(routine.oid::regprocedure::text,jsonb_build_object(
   'oid',routine.oid,'owner',pg_get_userbyid(proowner),'language',language.lanname,
   'definer',prosecdef,'config',proconfig,'acl',proacl::text,'bodyMd5',md5(prosrc),
   'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(routine.oid),'UTF8')),'hex')))
   FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid=pronamespace
   JOIN pg_language language ON language.oid=prolang
   WHERE namespace.nspname IN ({SCHEMAS}) AND prokind IN ('f','p')),
 'securitySha256',encode(sha256(convert_to(jsonb_build_object(
   'schemas',(SELECT jsonb_agg(to_jsonb(namespace) ORDER BY oid)
     FROM pg_namespace namespace WHERE nspname IN ({SCHEMAS})),
   'relations',(SELECT jsonb_agg(jsonb_build_object('oid',relation.oid,'acl',relacl,'owner',relowner,
     'rls',relrowsecurity,'forceRls',relforcerowsecurity) ORDER BY relation.oid)
     FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relnamespace
     WHERE namespace.nspname IN ({SCHEMAS})),
   'policies',(SELECT jsonb_agg(to_jsonb(policy) ORDER BY policy.oid)
     FROM pg_policy policy JOIN pg_class relation ON relation.oid=polrelid
     JOIN pg_namespace namespace ON namespace.oid=relnamespace WHERE namespace.nspname IN ({SCHEMAS})),
   'triggers',(SELECT jsonb_agg(to_jsonb(trigger_row) ORDER BY trigger_row.oid)
     FROM pg_trigger trigger_row JOIN pg_class relation ON relation.oid=tgrelid
     JOIN pg_namespace namespace ON namespace.oid=relnamespace WHERE namespace.nspname IN ({SCHEMAS})),
   'constraints',(SELECT jsonb_agg(to_jsonb(constraint_row) ORDER BY constraint_row.oid)
     FROM pg_constraint constraint_row JOIN pg_namespace namespace ON namespace.oid=connamespace
     WHERE namespace.nspname IN ({SCHEMAS})),
   'indexes',(SELECT jsonb_agg(jsonb_build_object('row',to_jsonb(index_row),
     'definition',pg_get_indexdef(indexrelid)) ORDER BY indexrelid)
     FROM pg_index index_row JOIN pg_class relation ON relation.oid=indrelid
     JOIN pg_namespace namespace ON namespace.oid=relnamespace WHERE namespace.nspname IN ({SCHEMAS}))
 )::text,'UTF8')),'hex'));
ROLLBACK;
"""


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     allow_nan=False).encode()).hexdigest()


def validate(value):
    _require(value.get('systemIdentifier') == APP_SYSTEM and value.get('readOnly') is True,
             'public_mutation_chain_identity_refused')
    _require(isinstance(value.get('securitySha256'), str)
             and HEX.fullmatch(value['securitySha256']), 'public_mutation_security_chain_missing')
    goal = value.get('goal', {})
    _require(goal.get('id') == GOAL_ID and goal.get('current_amount') == 100
             and goal.get('goal_kind') == 'legacy' and goal.get('source_mode') == 'manual'
             and goal.get('status') == 'active'
             and all(goal.get(name) is None for name in ('completed_at', 'cancelled_at', 'spent_at')),
             'public_mutation_goal_changed')
    _require(value.get('intent') == {'id': INTENT, 'phase': 'retired_unconfirmed',
        'amountKobo': 10000, 'expiresAt': '2026-09-29T15:59:10Z'}
        and value.get('operation') == {'retired': True, 'collection': 'pending',
            'transfer': 'not_started', 'projection': 'unapplied'}
        and all(type(value.get(name)) is int and value[name] == 1
                for name in ('intentCount', 'operationCount', 'retirementCount')),
        'public_mutation_retired_history_changed')
    _require(type(value.get('companyTotalKobo')) is int and value['companyTotalKobo'] == 10000
             and value.get('treasury') == {'available': 10000, 'reserved': 0,
                 'consumed': 0, 'enabled': True}, 'public_mutation_total_budget_changed')
    for signature, expected in SEALED['functions'].items():
        row = value.get('routines', {}).get(signature, {})
        _require(row.get('bodyMd5') == expected['newBodyMd5']
                 and row.get('owner') == expected['owner']
                 and row.get('language') == expected['language']
                 and row.get('definer') is expected['securityDefiner']
                 and row.get('config') == expected['configuration']
                 and row.get('acl') == expected['acl'], 'public_mutation_renewed_routine_drift')
    return digest(value)
