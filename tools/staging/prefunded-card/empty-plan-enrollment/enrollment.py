import hashlib
import json
from pathlib import Path

from contract import DEADLINE, GOAL, ROOT_SCOPE, digest, pinned, require, timestamp, validate


CANONICAL = Path('/Users/mac/Baci-worktrees/cursor-savings-phase1')
HERE = Path(__file__).resolve().parent
SOURCE_PINS = {
    'tools/staging/interest-bridge/test-plan/plan_snapshot.sql':
        'f121fbbba01c3e678a1c4a6f8fdfb5aba9a2ea531692d05903367db33c634cf1',
    'tools/staging/interest-bridge/test-plan/plan_constants.py':
        '3f3cbad10af512215cb8f31d72e78cd31a9b03c17b94d9c6a468b15096b9d69c',
    'tools/staging/interest-bridge/test-plan/plan_binding.sql':
        'cb326c8c519cbd740df73a16d91af555355a1f31cebb06d878b569647a2289f3',
    'tools/staging/prefunded-card/enrollment-owner-candidate.sql':
        '9b5a3fbba0927c655a57f53da10fa778e19b5cbfd1840c3be4f0fe40e9f29475',
    'tools/staging/prefunded-card/checkout-capability.sql':
        '3a1e61aa4456862e104677e1c30f43d237b6be0e8c855094d163a5b65c0da618',
    'tools/staging/prefunded-card/public_database_contract.py':
        'a05844d21f140ff51f1ee5575f1788e36aeb9fc13d8be0e0ec8ba2d464335afd',
    'tools/staging/prefunded-card/public-source.mjs':
        'b2d7348e987f0f98ecc2a9e3377ede41887e1a13f51c0143c6fb6eec7be48ae5',
}


def sources(repository=CANONICAL, *, source_contents=None):
    if source_contents is None:
        require(repository == CANONICAL and repository.resolve() == CANONICAL, 'canonical_repository')
        source_contents = {}
        for name in SOURCE_PINS:
            path = repository / name
            require(not any(part.is_symlink() for part in (path, *path.parents)), 'source_symlink')
            source_contents[name] = path.read_bytes()
    require(type(source_contents) is dict and set(source_contents) == set(SOURCE_PINS), 'parent_source_set')
    source_contents = dict(source_contents)
    content = {}
    for name, expected in SOURCE_PINS.items():
        raw = source_contents[name]
        require(type(raw) is bytes, 'parent_source_content')
        require(hashlib.sha256(raw).hexdigest() == expected, 'parent_source_drift')
        content[name] = raw.decode()
    return content


def setup(repository=CANONICAL, *, source_contents=None):
    parent = sources(repository, source_contents=source_contents)['tools/staging/interest-bridge/test-plan/plan_snapshot.sql']
    parent = parent.split('CREATE FUNCTION pg_temp.plan_state()', 1)[0]
    return parent + '\n' + (HERE / 'state.sql').read_text() + '\n' + (HERE / 'guard.sql').read_text()


def collect_sql(repository=CANONICAL, *, source_contents=None):
    return ("\\set ON_ERROR_STOP on\nBEGIN ISOLATION LEVEL REPEATABLE READ;\n"
            "SET LOCAL statement_timeout='20s'; SET LOCAL TIME ZONE 'UTC';\n"
            "SET LOCAL search_path=pg_catalog;\n" + setup(repository, source_contents=source_contents) +
            "\nSET TRANSACTION READ ONLY; SELECT pg_temp.enrollment_check();\n"
            "SELECT jsonb_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),\n"
            "'databaseName',current_database(),'sessionUser',session_user,'currentUser',current_user,\n"
            "'localSocket',inet_client_addr() IS NULL,'observedAt',\n"
            "to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'),\n"
            "'metadata',pg_temp.enrollment_metadata());\nROLLBACK;\n")


def render(evidence, reviewed_pins, mode='rehearse', rehearsal=None, rehearsal_pin=None,
           now=None, repository=CANONICAL, *, source_contents=None):
    require(mode in ('rehearse', 'apply'), 'mode')
    validate(evidence, reviewed_pins, now)
    meta = json.dumps(evidence['database']['metadata'], sort_keys=True, separators=(',', ':'))
    provider_time = evidence['providerWallet']['retrievedAt']
    observed_time = evidence['database']['observedAt']
    timestamp(provider_time)
    timestamp(observed_time)
    provider_time = provider_time.replace("'", "''")
    observed_time = observed_time.replace("'", "''")
    core = "\\set ON_ERROR_STOP on\nBEGIN ISOLATION LEVEL READ COMMITTED;\n"
    core += "SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s';\n"
    core += "SET LOCAL idle_in_transaction_session_timeout='30s';\n"
    core += "SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path=pg_catalog;\n" + setup(repository, source_contents=source_contents)
    closure = {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest()
               for name in ('contract.py','enrollment.py','state.sql','guard.sql')}
    core += (f"\nSELECT set_config('baci.empty_enrollment.evidence_sha256','{digest(evidence)}',true),\n"
             f"set_config('baci.empty_enrollment.reviewed_pins_sha256','{digest(reviewed_pins)}',true),\n"
             f"set_config('baci.empty_enrollment.source_sha256','{digest(closure)}',true);\n")
    core += """
SELECT pg_temp.enrollment_identity();
SELECT pg_advisory_xact_lock(hashtextextended('prefunded-card-legacy-route:9f01153c-1589-4dde-b9aa-8f644a846832',0));
DO $locks$ DECLARE entry record; BEGIN
  FOR entry IN SELECT namespace,relation FROM pg_temp.plan_tables() LOOP
    EXECUTE format('LOCK TABLE %I.%I IN SHARE ROW EXCLUSIVE MODE',entry.namespace,entry.relation);
  END LOOP;
END $locks$;
LOCK TABLE pg_catalog.pg_proc,pg_catalog.pg_authid,pg_catalog.pg_auth_members,
  pg_catalog.pg_class,pg_catalog.pg_namespace,pg_catalog.pg_database,
  pg_catalog.pg_attribute,pg_catalog.pg_attrdef,pg_catalog.pg_constraint,
  pg_catalog.pg_trigger,pg_catalog.pg_index,pg_catalog.pg_policy IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE enrollment_outcome(outcome text) ON COMMIT DROP;
"""
    core += f"""
CREATE FUNCTION pg_temp.enrollment_pins() RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $pins$
BEGIN
  PERFORM pg_temp.enrollment_check();
  IF pg_temp.enrollment_metadata() IS DISTINCT FROM '{meta}'::jsonb
    OR '{provider_time}'::timestamptz>clock_timestamp()
    OR '{provider_time}'::timestamptz<clock_timestamp()-interval '90 seconds'
    OR '{observed_time}'::timestamptz>clock_timestamp()
    OR '{observed_time}'::timestamptz<clock_timestamp()-interval '300 seconds' THEN
    RAISE EXCEPTION 'empty enrollment reviewed state drift or evidence expired'; END IF;
END $pins$;
SELECT pg_temp.enrollment_pins();
DO $route$ BEGIN
  IF EXISTS(SELECT 1 FROM prefunded_card.credit_routes WHERE goal_id='{GOAL}') THEN
    INSERT INTO enrollment_outcome VALUES ('already_enrolled');
  ELSE
    INSERT INTO prefunded_card.credit_routes(goal_id,integration_id,merchant_id,customer_id,system_identifier)
    VALUES ('{GOAL}','{ROOT_SCOPE['integrationId']}','{ROOT_SCOPE['merchantId']}',
      '{ROOT_SCOPE['customerId']}','{ROOT_SCOPE['systemIdentifier']}');
    INSERT INTO enrollment_outcome VALUES ('enrolled');
  END IF;
END $route$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.enrollment_pins();
DO $postflight$ BEGIN
  IF (SELECT count(*) FROM prefunded_card.credit_routes WHERE goal_id='{GOAL}')<>1 THEN
    RAISE EXCEPTION 'empty enrollment route postflight refused'; END IF;
END $postflight$;
SELECT jsonb_build_object('outcome',outcome,'goalId','{GOAL}','principalKobo',0,
  'newPrefundingKobo',0,'interestPolicyPresent',false,'protectedStateUnchanged',true)
FROM enrollment_outcome;
"""
    candidate_sha = hashlib.sha256(core.encode()).hexdigest()
    if mode == 'apply':
        require(isinstance(rehearsal, dict), 'rollback_rehearsal_required')
        pinned(rehearsal, rehearsal_pin, 'rehearsal_pin')
        require(set(rehearsal) == {'candidateSha256', 'goalId', 'rolledBack',
                                  'protectedStateUnchanged', 'routeAbsentAfterRollback'}
                and rehearsal['candidateSha256'] == candidate_sha and rehearsal['goalId'] == GOAL
                and all(rehearsal[field] is True for field in
                        ('rolledBack', 'protectedStateUnchanged', 'routeAbsentAfterRollback')),
                'rollback_rehearsal_not_verified')
    return {'candidateSha256': candidate_sha, 'sql': core + ('COMMIT;\n' if mode == 'apply' else 'ROLLBACK;\n'),
            'liveProofProduced': False, 'interestPolicyPending': True, 'expiresAt': DEADLINE}
