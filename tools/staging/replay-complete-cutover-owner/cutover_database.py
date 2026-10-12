"""Parent-owned receipt DB adapter; no subprocess, HTTP, token minting or runtime start.

query(sql) returns one decoded snapshot object from a separate read-only transaction.
execute(sql) returns the server-acknowledged final command tag: ROLLBACK or COMMIT.
An exception/unknown acknowledgement never authorizes recovery SQL or a runtime start.
The parent supplies genuine financial proof, exclusive quiescence and reviewed receipts.
Keep all claimants stopped after every result or exception; this module cannot stop them.
Package the unchanged, pinned replay-claim-fence directory beside this directory.
"""

from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re


FENCE = Path(__file__).resolve().parent.parent / 'replay-claim-fence'
FENCE_PIN = '0a2f0610b68ec0565788bf4ad06a4e5f90c2eda63406e9639ef2418f8fcd5e29'
SYSTEM = '7686901100561231906'
GENERATION = '1a420a7b-0c17-4312-84dc-d276a32f19f4'
DEADLINE = '2026-10-06T15:59:10Z'
EARLIEST_PROOF = '2026-10-03T07:45:26.302325Z'
BODY = '3e60a019e83ae140dd6d35fc6f378292e8f672d8b2d209fee18b22c8be671cdc'
DEFINITION = '650e050f359e295abc9bcb306f33a05afa3ffa14bc128f4a7b3b93faaaa5b824'
FENCED_BODY = '560ca6e2881f5c6b1b51ef554a7c2abb9dcc1c5fb74f70a32b528fb1144819e3'
FENCED_DEFINITION = '240bae3d3af17758fe0600a441d97a642174b3029f9c352c8f3177c3ea20f1f1'
ACL = ['pvb_staging_replay_executor=X/pvb_staging_replay_executor',
       'pvb_staging_worker=X/pvb_staging_replay_executor']
METADATA_FIELDS = set(('oid proname pronamespace proowner prolang procost prorows provariadic prosupport '
    'prokind prosecdef proleakproof proisstrict proretset provolatile proparallel pronargs pronargdefaults '
    'prorettype proargtypes proallargtypes proargmodes proargnames proargdefaults protrftypes probin '
    'prosqlbody proconfig proacl').split())
SNAPSHOT_SQL = """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='3s';
SET LOCAL search_path=pg_catalog;
SET LOCAL TIME ZONE 'UTC';
DO $identity$ BEGIN
  IF session_user<>'supabase_admin' OR current_user<>session_user
    OR (SELECT usename FROM pg_stat_activity WHERE pid=pg_backend_pid())<>'supabase_admin'
    OR current_database()<>'postgres' OR inet_client_addr() IS NOT NULL
    OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=session_user AND rolsuper)
    OR (SELECT system_identifier::text FROM pg_control_system())<>'7686901100561231906'
    OR clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz THEN
    RAISE EXCEPTION 'receipt snapshot refused' USING ERRCODE='42501'; END IF;
END $identity$;
SELECT jsonb_build_object(
 'observedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'identity',jsonb_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
   'sessionUser',session_user,'currentUser',current_user,'database',current_database(),
   'authenticatedUser',(SELECT usename FROM pg_stat_activity WHERE pid=pg_backend_pid()),
   'localUnix',inet_client_addr() IS NULL,'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=session_user),
   'readOnly',current_setting('transaction_read_only')='on'),
 'drain',jsonb_build_object('transactions',(SELECT count(*) FROM pg_stat_activity
   WHERE datname=current_database() AND pid<>pg_backend_pid() AND xact_start IS NOT NULL
     AND backend_type='client backend'),
   'preparedTransactions',(SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database()),
   'processingReceipts',(SELECT count(*) FROM public.piggyvest_staging_receipts WHERE status='processing')),
 'routine',(SELECT jsonb_build_object('oid',routine.oid::bigint,'owner',pg_get_userbyid(routine.proowner),
   'acl',to_jsonb(routine.proacl::text[]),'securityDefiner',routine.prosecdef,'volatility',routine.provolatile,
   'language',language.lanname,'config',routine.proconfig,'metadata',
   (to_jsonb(routine)-'prosrc')||jsonb_build_object('oid',routine.oid::bigint),
   'bodySha256',encode(sha256(convert_to(routine.prosrc,'UTF8')),'hex'),
   'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(routine.oid),'UTF8')),'hex'))
   FROM pg_proc routine JOIN pg_language language ON language.oid=routine.prolang
   WHERE routine.oid=to_regprocedure('public.claim_piggyvest_staging_receipts(integer,integer)')),
 'otherRoutinesSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(routine)
   ORDER BY oid),'[]'::jsonb)::text,'UTF8')),'hex') FROM pg_proc routine WHERE oid<>16487),
 'receipts',jsonb_build_object(
   'receipts',(SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(
     coalesce(jsonb_agg(to_jsonb(entry) ORDER BY id),'[]'::jsonb)::text,'UTF8')),'hex'))
     FROM public.piggyvest_staging_receipts entry),
   'quarantine',(SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(
     coalesce(jsonb_agg(to_jsonb(entry) ORDER BY receipt_id),'[]'::jsonb)::text,'UTF8')),'hex'))
     FROM public.piggyvest_staging_replay_quarantine entry),
   'signatures',(SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(
     coalesce(jsonb_agg(to_jsonb(entry) ORDER BY receipt_id),'[]'::jsonb)::text,'UTF8')),'hex'))
     FROM public.piggyvest_staging_receipt_signatures entry)));
ROLLBACK;
"""


def require(condition, code):
    if not condition:
        raise ValueError(code)


def _sha(source):
    return hashlib.sha256(source.encode()).hexdigest()


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def _hex(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def _timestamp(value):
    require(isinstance(value, str) and value.endswith('Z'), 'timestamp_refused')
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def _now():
    now = datetime.now(timezone.utc)
    require(now < datetime.fromisoformat(DEADLINE.replace('Z', '+00:00')), 'fixed_deadline_expired')
    return now


def _financial(proof):
    try:
        require(isinstance(proof, dict) and set(proof) == {
            'financialProofPassed', 'financialProofSha256', 'financialProofObservedAt'}
            and proof['financialProofPassed'] is True and _hex(proof['financialProofSha256'])
            and _timestamp(EARLIEST_PROOF) <= _timestamp(proof['financialProofObservedAt']) <= _now(),
            'financial_proof_refused')
    except Exception:
        raise ValueError('financial_proof_refused') from None


def _load_renderer():
    try:
        inventory = (FENCE / 'SOURCE-INVENTORY.sha256').read_bytes()
        require(hashlib.sha256(inventory).hexdigest() == FENCE_PIN, 'renderer_source_refused')
        for line in inventory.decode().splitlines():
            pin, name = line.split('  ')
            require(_hex(pin) and re.fullmatch('[a-zA-Z0-9_.-]+', name)
                    and hashlib.sha256((FENCE / name).read_bytes()).hexdigest() == pin,
                    'renderer_source_refused')
        specification = importlib.util.spec_from_file_location('cutover_pinned_renderer', FENCE / 'renderer.py')
        module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(module)
        return module
    except Exception:
        raise ValueError('renderer_source_refused') from None


def capture_snapshot(query):
    _now()
    try:
        value = json.loads(_json(query(SNAPSHOT_SQL)))
        now = _now()
        require(isinstance(value, dict) and set(value) == {
            'observedAt', 'identity', 'drain', 'routine', 'receipts', 'otherRoutinesSha256'}, 'snapshot_refused')
        require(0 <= (now - _timestamp(value['observedAt'])).total_seconds() <= 60, 'snapshot_refused')
        expected = dict(systemIdentifier=SYSTEM, sessionUser='supabase_admin', currentUser='supabase_admin',
                        authenticatedUser='supabase_admin', database='postgres', localUnix=True,
                        superuser=True, readOnly=True)
        identity = value['identity']
        require(isinstance(identity, dict) and set(identity) == set(expected)
                and all(type(identity[name]) is type(item) and identity[name] == item
                        for name, item in expected.items()), 'snapshot_refused')
        drain = value['drain']
        require(isinstance(drain, dict) and set(drain) == {
            'transactions', 'preparedTransactions', 'processingReceipts'}
            and all(type(count) is int and count == 0 for count in drain.values()), 'snapshot_refused')
        routine = value['routine']
        expected = dict(oid=16487, owner='pvb_staging_replay_executor', acl=ACL,
                        securityDefiner=True, volatility='v', language='plpgsql', config=['search_path=pg_catalog'])
        require(isinstance(routine, dict) and set(routine) == set(expected) | {
            'bodySha256', 'definitionSha256', 'metadata'}
            and all(type(routine[name]) is type(item) and routine[name] == item for name, item in expected.items())
            and all(_hex(routine[name]) for name in ('bodySha256', 'definitionSha256')),
            'snapshot_refused')
        metadata = routine['metadata']
        require(isinstance(metadata, dict) and METADATA_FIELDS <= set(metadata) and 'prosrc' not in metadata
                and all(type(metadata.get(name)) is type(item) and metadata[name] == item for name, item in dict(
                    oid=16487, prosecdef=True, provolatile='v', proconfig=expected['config'], proacl=ACL).items()),
                'snapshot_refused')
        tables = value['receipts']
        require(isinstance(tables, dict) and set(tables) == {'receipts', 'quarantine', 'signatures'}
                and all(isinstance(row, dict) and set(row) == {'count', 'sha256'}
                        and type(row['count']) is int and row['count'] >= 0 and _hex(row['sha256'])
                        for row in tables.values()) and _hex(value['otherRoutinesSha256']), 'snapshot_refused')
        _now()
        return value
    except Exception:
        raise ValueError('snapshot_refused') from None


def _state(snapshot, *, preserve_body=True):
    state = json.loads(_json(snapshot))
    del state['observedAt']
    if not preserve_body:
        del state['routine']['bodySha256'], state['routine']['definitionSha256']
    return state


def run_fence(query, execute, original_definition, financial_proof, reviewed_sql_sha256, *,
              mode='rollback', rehearsal_receipt=None, reviewed_rehearsal_sha256=None):
    _financial(financial_proof)
    require(mode in ('rollback', 'commit') and callable(query) and callable(execute), 'phase_refused')
    try:
        renderer = _load_renderer()
        rollback = renderer.render_transaction(original_definition)
        commit = renderer.render_transaction(original_definition, mode='commit')
        require(rollback.endswith('ROLLBACK;\n') and commit.endswith('COMMIT;\n')
                and rollback[:-len('ROLLBACK;\n')] == commit[:-len('COMMIT;\n')], 'renderer_sql_refused')
        definition = commit.split('$baci_fenced_definition$')
        require(len(definition) == 3 and definition[1].count('$function$') == 2
                and _sha(definition[1].split('$function$')[1]) == FENCED_BODY, 'renderer_sql_refused')
        fenced_definition = _sha(definition[1])
        require(fenced_definition == FENCED_DEFINITION, 'renderer_sql_refused')
    except Exception:
        raise ValueError('renderer_sql_refused') from None
    sql = rollback if mode == 'rollback' else commit
    require(_hex(reviewed_sql_sha256) and _sha(sql) == reviewed_sql_sha256, 'reviewed_sql_pin_refused')
    before = capture_snapshot(query)
    require(before['routine']['bodySha256'] == BODY and before['routine']['definitionSha256'] == DEFINITION,
            'original_routine_refused')
    receipt = dict(schemaVersion=1, status='rollback_rehearsed', systemIdentifier=SYSTEM, generation=GENERATION,
                   fenceManifestSha256=FENCE_PIN, originalDefinitionSha256=DEFINITION, fencedBodySha256=FENCED_BODY,
                   fencedDefinitionSha256=fenced_definition, rollbackSqlSha256=_sha(rollback),
                   commitSqlSha256=_sha(commit), baselineStateSha256=_sha(_json(_state(before))),
                   restoredStateSha256=_sha(_json(_state(before))),
                   financialProofSha256=financial_proof['financialProofSha256'],
                   financialProofObservedAt=financial_proof['financialProofObservedAt'])
    if mode == 'commit':
        try:
            require(isinstance(rehearsal_receipt, dict) and _hex(reviewed_rehearsal_sha256)
                    and _sha(_json(rehearsal_receipt)) == reviewed_rehearsal_sha256
                    and set(rehearsal_receipt) == set(receipt) | {'observedAt'}
                    and _timestamp(financial_proof['financialProofObservedAt'])
                    <= _timestamp(rehearsal_receipt['observedAt']) <= _now(), 'rehearsal_review_refused')
            require(all(type(rehearsal_receipt[name]) is type(item) and rehearsal_receipt[name] == item
                        for name, item in receipt.items()), 'rehearsal_baseline_refused')
        except ValueError as error:
            code = 'rehearsal_baseline_refused' if str(error) == 'rehearsal_baseline_refused' else 'rehearsal_review_refused'
            raise ValueError(code) from None
        except Exception:
            raise ValueError('rehearsal_review_refused') from None
    _financial(financial_proof)
    try:
        require(execute(sql) == mode.upper(), 'transaction_ack_refused')
    except Exception:
        raise ValueError(mode + '_outcome_unknown_keep_stopped') from None
    try:
        after = capture_snapshot(query)
        require(_state(before, preserve_body=mode == 'rollback') == _state(after, preserve_body=mode == 'rollback'),
                'postflight_refused_keep_stopped')
        expected_body, expected_definition = (BODY, DEFINITION) if mode == 'rollback' else (FENCED_BODY, fenced_definition)
        require(after['routine']['bodySha256'] == expected_body
                and after['routine']['definitionSha256'] == expected_definition, 'postflight_refused_keep_stopped')
        receipt['observedAt'] = _now().isoformat().replace('+00:00', 'Z')
    except Exception:
        raise ValueError('postflight_refused_keep_stopped') from None
    status = 'rollback_verified_keep_stopped' if mode == 'rollback' else 'fence_committed_keep_stopped'
    if mode == 'commit':
        receipt['status'] = 'fence_committed'
        del receipt['restoredStateSha256']
        receipt['committedStateSha256'] = _sha(_json(_state(after)))
        receipt['rehearsalReceiptSha256'] = reviewed_rehearsal_sha256
    return dict(status=status, receipt=receipt, receiptSha256=_sha(_json(receipt)), before=before, after=after)
