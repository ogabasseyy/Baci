import copy
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path


HERE = Path(__file__).resolve().parent
CANONICAL = Path('/Users/mac/Baci-worktrees/cursor-savings-phase1')
MIGRATION = 'supabase/migrations/20261002160000_prefunded_first_card_claim_boundary.sql'
SOURCE_PIN = '05af1e6f87a118aefe6cf097569daa5dcf7e52922cfb1d1fdbff884b2f5d67ae'
SYSTEM = '7685292944002592802'
DEADLINE = '2026-10-06T15:59:10Z'
SIGNATURES = ('prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid)',
              'prefunded_card.claim_reconciliation(uuid,integer)')
REQUIRED_TABLES = ('prefunded_card.operations', 'prefunded_card.checkout_intents',
    'prefunded_card.dispatch_queue', 'prefunded_card.treasury_bindings',
    'public.customer_savings_goals', 'public.customer_savings_contributions',
    'public.customer_saved_payment_methods', 'piggyvest_savings_ledger.operations')
RUNTIME_FILES = ('installer.py', 'snapshot.sql', 'identity.sql', 'guard.sql', 'materialized-locks.sql')


def _require(condition, code):
    if not condition:
        raise ValueError(code)


def _sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


def _json(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(',', ':'))


def _digest(value):
    return _sha(_json(value))


def _hex(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def _time(value):
    _require(isinstance(value, str) and re.fullmatch(
        r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z', value), 'timestamp')
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def _source(content):
    if content is None:
        filename = CANONICAL / MIGRATION
        _require(filename.resolve() == filename and filename.is_file(), 'canonical_source_path')
        content = filename.read_bytes()
    _require(isinstance(content, bytes) and hashlib.sha256(content).hexdigest() == SOURCE_PIN,
             'migration_source_pin')
    return content.decode('utf-8')


def _closure(source):
    pins = {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest() for name in RUNTIME_FILES}
    pins[MIGRATION] = _sha(source)
    return _digest(pins)


def _patches(source):
    matches = re.findall(r"anchor:='([^']*)';\s+replacement:=\$(due|reconciliation)\$(.*?)\$\2\$;",
                         source, re.DOTALL)
    _require(len(matches) == 2 and [entry[1] for entry in matches] == ['due', 'reconciliation'],
             'pinned_patch_shape')
    return [(entry[0], entry[2]) for entry in matches]


def _after(evidence, source):
    result = copy.deepcopy(evidence['functions'])
    for signature, (anchor, replacement) in zip(SIGNATURES, _patches(source)):
        body = result[signature]['body']
        _require(body.count(anchor) == 1 and body.count(replacement) <= 1, 'exact_body_anchor')
        next_body = body.replace(replacement, anchor).replace(anchor, replacement)
        result[signature].update(body=next_body, bodySha256=_sha(next_body))
    return result


def _validate(evidence, reviewed_pin, source):
    _require(isinstance(evidence, dict) and _hex(reviewed_pin) and _digest(evidence) == reviewed_pin,
             'reviewed_evidence_pin')
    _require(set(evidence) == {'version', 'capturedAt', 'sourceClosureSha256', 'identity',
        'functions', 'tableRows', 'permanentMetadataSha256', 'unsupportedRelations'}, 'evidence_shape')
    now = datetime.now(timezone.utc)
    _require(now < _time(DEADLINE), 'deadline')
    _require(type(evidence['version']) is int and evidence['version'] == 1, 'evidence_version')
    _require(0 <= (now - _time(evidence['capturedAt'])).total_seconds() <= 300, 'fresh_capture')
    _require(evidence['sourceClosureSha256'] == _closure(source), 'source_closure_pin')
    identity = evidence['identity']
    _require(isinstance(identity, dict) and set(identity) == {'systemIdentifier', 'database',
        'databaseOid', 'sessionUser', 'currentUser', 'roleOid', 'superuser', 'localSocket',
        'sessionReplicationRole'}, 'identity_shape')
    _require(identity['systemIdentifier'] == SYSTEM and identity['sessionUser'] == 'postgres'
        and identity['currentUser'] == 'postgres' and identity['superuser'] is True
        and identity['localSocket'] is True and identity['sessionReplicationRole'] == 'origin'
        and isinstance(identity['database'], str) and 1 <= len(identity['database'].encode()) <= 63
        and all(type(identity[key]) is int and identity[key] > 0 for key in ('databaseOid', 'roleOid')),
        'physical_owner_identity')
    functions = evidence['functions']
    _require(isinstance(functions, dict) and set(functions) == set(SIGNATURES), 'exact_functions')
    for routine in functions.values():
        _require(isinstance(routine, dict) and set(routine) == {'oid', 'ownerOid', 'owner', 'acl',
            'configuration', 'language', 'securityDefiner', 'catalogSha256', 'body', 'bodySha256'},
            'routine_shape')
        _require(type(routine['oid']) is int and routine['oid'] > 0
            and type(routine['ownerOid']) is int and routine['ownerOid'] == identity['roleOid']
            and routine['owner'] == 'postgres' and routine['securityDefiner'] is True
            and routine['configuration'] == ['search_path=pg_catalog'] and routine['language'] == 'plpgsql'
            and (routine['acl'] is None or isinstance(routine['acl'], list)
                 and all(isinstance(entry, str) and re.fullmatch(r'[^=\x00]*=X*/[^/\x00]+', entry)
                         for entry in routine['acl'])) and _hex(routine['catalogSha256'])
            and isinstance(routine['body'], str) and '\x00' not in routine['body']
            and _hex(routine['bodySha256']) and _sha(routine['body']) == routine['bodySha256'],
            'routine_controls')
    _require(len({routine['oid'] for routine in functions.values()}) == 2, 'distinct_routines')
    rows = evidence['tableRows']
    _require(isinstance(rows, dict) and set(REQUIRED_TABLES) <= set(rows), 'financial_tables')
    for name, row in rows.items():
        _require(isinstance(name, str) and name and isinstance(row, dict)
            and set(row) in ({'oid', 'count', 'sha256'},
                {'oid', 'count', 'sha256', 'kind', 'populated', 'ownerOid', 'owner'})
            and type(row['oid']) is int and row['oid'] > 0
            and type(row['count']) is int and row['count'] >= 0 and _hex(row['sha256']), 'table_row_pin')
        if 'kind' in row:
            _require(row['kind'] == 'm' and type(row['populated']) is bool
                and type(row['ownerOid']) is int and row['ownerOid'] > 0
                and isinstance(row['owner'], str) and 1 <= len(row['owner'].encode()) <= 63
                and '\x00' not in row['owner'] and (row['populated'] or row['count'] == 0),
                'materialized_row_pin')
    _require(_hex(evidence['permanentMetadataSha256']), 'metadata_pin')
    _require(evidence['unsupportedRelations'] == [], 'unsupported_relations')
    _after(evidence, source)


def _literal(value):
    return "'" + value.replace("'", "''") + "'"


def _sql_asset(name, closure):
    return (HERE / name).read_text().replace('__CLOSURE__', closure)


def _rollback(evidence, source):
    closure = _closure(source)
    expected = copy.deepcopy(evidence)
    expected['functions'] = _after(evidence, source)
    settings = []
    for signature, (anchor, replacement) in zip(SIGNATURES, _patches(source)):
        name = 'claim_due' if signature == SIGNATURES[0] else 'claim_reconciliation'
        previous = evidence['functions'][signature]['body'].replace(replacement, anchor)
        settings.append(f"SET LOCAL prefunded_card.claim_boundary_{name}_sha256={_literal(_sha(previous))};")
    settings.extend([
        'SET LOCAL prefunded_card.claim_boundary_database=' + _literal(evidence['identity']['database']) + ';',
        'SET LOCAL prefunded_card.claim_boundary_system=' + _literal(SYSTEM) + ';'])
    snapshot = _sql_asset('snapshot.sql', closure).rstrip().rstrip(';')
    identity = _sql_asset('identity.sql', closure)
    guard = _sql_asset('guard.sql', closure)
    materialized_locks = _sql_asset('materialized-locks.sql', closure)
    return '\n'.join([
        'BEGIN ISOLATION LEVEL READ COMMITTED;',
        "SET LOCAL standard_conforming_strings=on; SET LOCAL search_path=pg_catalog;",
        "SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; SET LOCAL idle_in_transaction_session_timeout='60s';",
        identity.split('DO $locks$')[0],
        'CREATE TEMP TABLE cb_expected ON COMMIT DROP AS SELECT ' + _literal(_json(evidence)) + '::jsonb evidence;',
        'DO $locks$' + identity.split('DO $locks$')[1],
        'CREATE TEMP TABLE cb_snapshot ON COMMIT DROP AS ' + snapshot + ';', guard,
        materialized_locks,
        'DROP TABLE pg_temp.cb_snapshot;',
        'CREATE TEMP TABLE cb_snapshot ON COMMIT DROP AS ' + snapshot + ';', guard,
        '\n'.join(settings), source,
        'UPDATE pg_temp.cb_expected SET evidence=' + _literal(_json(expected)) + '::jsonb;',
        'DROP TABLE pg_temp.cb_snapshot;',
        'CREATE TEMP TABLE cb_snapshot ON COMMIT DROP AS ' + snapshot + ';', guard,
        "SELECT jsonb_build_object('postflightPassed',true,'evidenceSha256'," + _literal(_digest(evidence))
        + ",'expectedFunctionsSha256'," + _literal(_digest(expected['functions'])) + ");",
        'ROLLBACK;', ''])


def render(evidence=None, *, reviewed_evidence_sha256=None, mode='rollback', migration_source=None,
           receipt=None, reviewed_receipt_sha256=None):
    _require(mode in ('capture', 'rollback', 'apply'), 'mode')
    source = _source(migration_source)
    if mode == 'capture':
        _require(evidence is None and reviewed_evidence_sha256 is None and receipt is None
                 and reviewed_receipt_sha256 is None, 'capture_inputs')
        identity = _sql_asset('identity.sql', _closure(source)).split('DO $locks$')[0]
        identity = identity.replace("current_setting('transaction_isolation')<>'read committed'",
                                    "current_setting('transaction_isolation')<>'repeatable read'")
        return '\n'.join(['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;',
            "SET LOCAL search_path=pg_catalog; SET LOCAL statement_timeout='60s';", identity,
            _sql_asset('snapshot.sql', _closure(source)), 'ROLLBACK;', ''])
    _validate(evidence, reviewed_evidence_sha256, source)
    rollback = _rollback(evidence, source)
    if mode == 'rollback':
        _require(receipt is None and reviewed_receipt_sha256 is None, 'receipt_requires_apply')
        return rollback
    _require(isinstance(receipt, dict), 'rehearsal_receipt')
    _require(_hex(reviewed_receipt_sha256) and _digest(receipt) == reviewed_receipt_sha256,
             'reviewed_receipt_pin')
    expected = dict(version=1, evidenceSha256=_digest(evidence), sourceClosureSha256=_closure(source),
        rollbackSqlSha256=_sha(rollback), expectedFunctionsSha256=_digest(_after(evidence, source)),
        permanentMetadataSha256=evidence['permanentMetadataSha256'], tableRowsSha256=_digest(evidence['tableRows']),
        restoredSnapshotSha256=_digest({key: value for key, value in evidence.items() if key != 'capturedAt'}),
        rolledBack=True, postflightPassed=True, rollbackVerified=True, independentlyReviewed=True,
        reviewedAt=receipt.get('reviewedAt'))
    _require(_json(receipt) == _json(expected) and _time(evidence['capturedAt']) <= _time(receipt['reviewedAt'])
        <= datetime.now(timezone.utc), 'paired_rehearsal_receipt')
    return rollback.removesuffix('ROLLBACK;\n') + 'COMMIT;\n'
