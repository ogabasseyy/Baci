import json
from datetime import datetime, timezone
from pathlib import Path

from clone import reviewed_clone
from contract import digest, require, sha256, timestamp, validate


HERE = Path(__file__).resolve().parent


def _literal(value):
    return "'" + json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False).replace("'", "''") + "'::jsonb"


def _rollback(bundle, reviewed_sha256):
    approval = {key: value for key, value in bundle.items() if key != 'source'}
    approval['manifestSha256'] = reviewed_sha256
    arguments = ','.join(_literal(bundle[key]) for key in ('scope', 'selection', 'collection'))
    delimiter = '$reviewed_' + sha256(arguments) + '$'
    require(delimiter not in arguments, 'call_delimiter')
    parameter_digests = ','.join("'" + key + "',encode(sha256(convert_to((" + _literal(bundle[key])
                                + ")::text,'UTF8')),'hex')" for key in ('scope', 'selection', 'collection'))
    parts = ["BEGIN;\nSET LOCAL search_path=pg_catalog,pg_temp;\nSET LOCAL lock_timeout='5s';\n"
             "SET LOCAL statement_timeout='45s';\nSET LOCAL idle_in_transaction_session_timeout='60s';\n",
             (HERE / 'identity.sql').read_text(), (HERE / 'state.sql').read_text(),
             'CREATE TEMP TABLE reviewed_approval(value jsonb NOT NULL) ON COMMIT DROP;\n'
             'REVOKE ALL ON pg_temp.reviewed_approval FROM PUBLIC,prefunded_authorizer;\n'
             'INSERT INTO pg_temp.reviewed_approval VALUES (' + _literal(approval)
             + "||jsonb_build_object('parameterDigests',jsonb_build_object(" + parameter_digests + ')));\n',
             (HERE / 'guards.sql').read_text(), 'SELECT pg_temp.reviewed_preflight();\n',
             reviewed_clone(bundle['source']) + ';\n',
             (HERE / 'acl.sql').read_text(),
             'GRANT EXECUTE ON FUNCTION pg_temp.reviewed_promote_collection(jsonb,jsonb,jsonb) TO prefunded_authorizer,postgres;\n'
             'SET SESSION AUTHORIZATION prefunded_authorizer;\n'
             'DO ' + delimiter + ' DECLARE result jsonb; BEGIN\n'
             'result:=pg_temp.reviewed_promote_collection(' + arguments + ');\n'
             "IF result->>'phase' IS DISTINCT FROM 'funding_pending' THEN\n"
             "RAISE EXCEPTION 'reviewed promotion refused'; END IF; END " + delimiter + ';\n'
             'RESET SESSION AUTHORIZATION;\n', (HERE / 'postflight.sql').read_text(),
             "SELECT jsonb_build_object('status','reviewed_postflight_passed','intentId',"
             "'ff561046-58e7-428d-9163-f6e60b0dab65','manifestSha256',"
             "(SELECT value->>'manifestSha256' FROM pg_temp.reviewed_approval));\n",
             'DROP FUNCTION pg_temp.reviewed_promote_collection(jsonb,jsonb,jsonb);\n'
             'DROP FUNCTION pg_temp.reviewed_approval_guard(jsonb,jsonb,jsonb);\n'
             'ROLLBACK;\n']
    return ''.join(parts)


def render_transaction(bundle, reviewed_sha256, *, mode='rollback', receipt=None,
                       reviewed_receipt_sha256=None):
    now = datetime.now(timezone.utc)
    validate(bundle, reviewed_sha256)
    require(mode in ('rollback', 'apply'), 'mode')
    rollback = _rollback(bundle, reviewed_sha256)
    if mode == 'rollback':
        require(receipt is None and reviewed_receipt_sha256 is None, 'unexpected_receipt')
        return rollback
    require(isinstance(receipt, dict) and set(receipt) == {
        'manifestSha256', 'rollbackSqlSha256', 'preflightSha256', 'rolledBack',
        'postflightPassed', 'independentlyReviewed', 'reviewedAt'}, 'rollback_receipt_shape')
    require(digest(receipt) == reviewed_receipt_sha256
            and receipt['manifestSha256'] == reviewed_sha256
            and receipt['rollbackSqlSha256'] == sha256(rollback)
            and receipt['preflightSha256'] == digest(bundle['preflight'])
            and receipt['rolledBack'] is True and receipt['postflightPassed'] is True
            and receipt['independentlyReviewed'] is True
            and timestamp(bundle['proof']['verifiedAt']) <= timestamp(receipt['reviewedAt']) <= now,
            'independently_reviewed_rollback_receipt')
    return rollback.removesuffix('ROLLBACK;\n') + 'COMMIT;\n'
