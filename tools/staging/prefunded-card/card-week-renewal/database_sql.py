"""Render a transactionally guarded, expiry-only database candidate."""

from __future__ import annotations

import hashlib
import re

from source_functions import (APP_SYSTEM, GOAL_ID, HEX64, SEALED, _require,
                              _sealed_function_bodies, _source_files)


def render_database_sql(baseline: dict, repo_root) -> bytes:
    _require(isinstance(baseline, dict), "invalid_baseline")
    database = baseline.get("database", {})
    _require(database.get("systemIdentifier") == APP_SYSTEM, "app_database_pin_mismatch")
    functions = database.get("routines", {})
    constraint = database.get("expiryConstraint")
    _require(isinstance(constraint, dict) and str(constraint.get("oid", "")).isdecimal()
             and isinstance(constraint.get("definitionSha256"), str)
             and HEX64.fullmatch(constraint["definitionSha256"]), "expiry_constraint_pin_missing")
    checkout = database.get("checkout", {})
    evidence = (checkout.get("intentBeforeSha256"), checkout.get("operationBeforeSha256"))
    _require(all(isinstance(value, str) and HEX64.fullmatch(value) for value in evidence),
             "retirement_evidence_pin_missing")
    generated = _sealed_function_bodies(repo_root, _source_files(repo_root))
    protected_state = _protected_state_expression()
    statements = [
        "BEGIN;",
        "SET LOCAL statement_timeout = '30s';",
        "SET LOCAL lock_timeout = '5s';",
        "SET LOCAL TIME ZONE 'UTC';",
        "SET LOCAL search_path = pg_catalog;",
        "LOCK TABLE prefunded_card.checkout_intents, prefunded_card.operations,",
        "  prefunded_card.checkout_retirements, prefunded_card.treasury_bindings",
        "  IN ACCESS EXCLUSIVE MODE;",
        "LOCK TABLE public.customer_savings_goals, prefunded_card.treasury_identities,",
        "  prefunded_card.treasury_replenishments IN SHARE ROW EXCLUSIVE MODE;",
        "LOCK TABLE pg_catalog.pg_proc, pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE;",
        "LOCK TABLE pg_catalog.pg_auth_members IN SHARE MODE;",
        f"""DO $week_baseline$
DECLARE protected_state jsonb := {protected_state};
BEGIN
  IF clock_timestamp() >= '2026-10-06T15:59:10Z'::timestamptz THEN
    RAISE EXCEPTION 'week renewal approval expired' USING ERRCODE='55000'; END IF;
  IF current_database() IS DISTINCT FROM 'postgres'
    OR session_user IS DISTINCT FROM 'postgres'
    OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '{APP_SYSTEM}'
    OR (SELECT count(*) FROM public.customer_savings_goals
      WHERE id='{GOAL_ID}' AND customer_id='10000000-0000-4000-8000-000000000002'
        AND merchant_id='10000000-0000-4000-8000-000000000001') IS DISTINCT FROM 1::bigint
    OR (SELECT current_amount * 100 FROM public.customer_savings_goals
      WHERE id='{GOAL_ID}' AND customer_id='10000000-0000-4000-8000-000000000002'
        AND merchant_id='10000000-0000-4000-8000-000000000001') IS DISTINCT FROM 10000::numeric
    OR (SELECT count(*) FROM prefunded_card.checkout_intents
      WHERE id='d8bcf921-61b3-4647-90e2-5648e4d6967d') IS DISTINCT FROM 1::bigint
    OR (SELECT phase FROM prefunded_card.checkout_intents
      WHERE id='d8bcf921-61b3-4647-90e2-5648e4d6967d') IS DISTINCT FROM 'retired_unconfirmed'
    OR (SELECT amount_kobo FROM prefunded_card.checkout_intents
      WHERE id='d8bcf921-61b3-4647-90e2-5648e4d6967d') IS DISTINCT FROM 10000::bigint
    OR (SELECT expires_at FROM prefunded_card.checkout_intents
      WHERE id='d8bcf921-61b3-4647-90e2-5648e4d6967d') IS DISTINCT FROM '2026-09-29T15:59:10Z'::timestamptz
    OR (SELECT count(*) FROM prefunded_card.checkout_intents
      WHERE id<>'d8bcf921-61b3-4647-90e2-5648e4d6967d') IS DISTINCT FROM 0::bigint
    OR (SELECT count(*) FROM prefunded_card.operations
      WHERE id<>'d8bcf921-61b3-4647-90e2-5648e4d6967d') IS DISTINCT FROM 0::bigint
    OR (SELECT count(*) FROM prefunded_card.operations
      WHERE id='d8bcf921-61b3-4647-90e2-5648e4d6967d') IS DISTINCT FROM 1::bigint
    OR (SELECT checkout_retired FROM prefunded_card.operations
      WHERE id='d8bcf921-61b3-4647-90e2-5648e4d6967d') IS DISTINCT FROM true
    OR (SELECT collection_status FROM prefunded_card.operations
      WHERE id='d8bcf921-61b3-4647-90e2-5648e4d6967d') IS DISTINCT FROM 'pending'
    OR (SELECT transfer_status FROM prefunded_card.operations
      WHERE id='d8bcf921-61b3-4647-90e2-5648e4d6967d') IS DISTINCT FROM 'not_started'
    OR (SELECT projection_status FROM prefunded_card.operations
      WHERE id='d8bcf921-61b3-4647-90e2-5648e4d6967d') IS DISTINCT FROM 'unapplied'
    OR (SELECT count(*) FROM prefunded_card.checkout_retirements) IS DISTINCT FROM 1::bigint
    OR (SELECT count(*) FROM prefunded_card.checkout_retirements
      WHERE operation_id='d8bcf921-61b3-4647-90e2-5648e4d6967d'
        AND intent_id='d8bcf921-61b3-4647-90e2-5648e4d6967d'
        AND intent_before_sha256='{evidence[0]}'
        AND operation_before_sha256='{evidence[1]}') IS DISTINCT FROM 1::bigint
    OR (SELECT opening_available_kobo + coalesce((SELECT sum(amount_kobo)
        FROM prefunded_card.treasury_replenishments
        WHERE treasury_binding_id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57'),0)
      FROM prefunded_card.treasury_identities
      WHERE treasury_binding_id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57') IS DISTINCT FROM 10000::bigint
    OR (SELECT count(*) FROM prefunded_card.treasury_identities
      WHERE treasury_binding_id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57') IS DISTINCT FROM 1::bigint
    OR (SELECT count(*) FROM prefunded_card.treasury_bindings
      WHERE id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57') IS DISTINCT FROM 1::bigint
    OR (SELECT verified_available_kobo FROM prefunded_card.treasury_bindings
      WHERE id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57') IS DISTINCT FROM 10000::bigint
    OR (SELECT reserved_kobo FROM prefunded_card.treasury_bindings
      WHERE id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57') IS DISTINCT FROM 0::bigint
    OR (SELECT consumed_kobo FROM prefunded_card.treasury_bindings
      WHERE id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57') IS DISTINCT FROM 0::bigint THEN
    RAISE EXCEPTION 'week renewal financial baseline differs' USING ERRCODE='55000';
  END IF;
  IF (SELECT count(*) FROM pg_authid WHERE rolname IN
      ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence')) IS DISTINCT FROM 3::bigint
    OR EXISTS (SELECT 1 FROM pg_authid WHERE rolname IN
      ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence')
      AND (NOT rolcanlogin OR rolpassword IS NULL OR rolsuper OR rolbypassrls OR rolcreaterole
        OR rolcreatedb OR rolreplication OR rolinherit OR rolconnlimit<>-1
        OR rolvaliduntil IS DISTINCT FROM '2026-09-29T15:59:10Z'::timestamptz
          AND rolvaliduntil IS DISTINCT FROM '2026-10-06T15:59:10Z'::timestamptz)) THEN
    RAISE EXCEPTION 'week renewal executor role baseline differs' USING ERRCODE='55000';
  END IF;
  PERFORM set_config('baci.week_renewal.role_passwords_before', encode(sha256(convert_to(
    (SELECT string_agg(rolname||':'||rolpassword,E'\\n' ORDER BY rolname) FROM pg_authid
      WHERE rolname IN ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence')),'UTF8')),'hex'),true);
  PERFORM set_config('baci.week_renewal.protected_before',
    encode(sha256(convert_to(protected_state::text,'UTF8')),'hex'),true);
  PERFORM set_config('baci.week_renewal.roles_before', ({_role_fingerprint()}), true);
END $week_baseline$;""",
    ]

    for signature, pinned in SEALED["functions"].items():
        observed = functions.get(signature)
        _require(isinstance(observed, dict) and observed.get("present") is True
                 and str(observed.get("oid", "")).isdecimal(), "routine_oid_pin_missing")
        _require(observed.get("bodyMd5") in (pinned["oldBodyMd5"], pinned["newBodyMd5"])
                 and observed.get("owner") == pinned["owner"]
                 and observed.get("language") == pinned["language"]
                 and observed.get("securityDefiner") == pinned["securityDefiner"]
                 and observed.get("configuration") == pinned["configuration"]
                 and observed.get("acl") == pinned["acl"], "routine_predecessor_drift")
        ddl, _, new_body_md5 = generated[signature]
        signature_sql = signature.replace("'", "''")
        sql_ddl = ddl.replace("$body$", "$renewed_body$")
        ddl_tag = "$week_definition_" + hashlib.sha256(sql_ddl.encode()).hexdigest() + "$"
        _require(ddl_tag not in sql_ddl, "routine_definition_delimiter_collision")
        statements.append(f"""DO $week_routine$
DECLARE expected_oid oid := {int(observed['oid'])}::oid;
        before_acl aclitem[];
        before_owner oid;
        before_body_md5 text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc routine
    WHERE routine.oid=to_regprocedure('{signature_sql}')
      AND routine.oid=expected_oid
      AND routine.proowner=(SELECT oid FROM pg_roles WHERE rolname='{pinned['owner']}')
      AND routine.prosecdef={str(pinned['securityDefiner']).lower()}
      AND routine.prolang=(SELECT oid FROM pg_language WHERE lanname='{pinned['language']}')
      AND routine.proconfig=ARRAY['search_path=pg_catalog']::text[]
      AND routine.proacl::text='{pinned['acl']}'
      AND md5(routine.prosrc) IN ('{pinned['oldBodyMd5']}','{pinned['newBodyMd5']}')) THEN
    RAISE EXCEPTION 'week renewal routine predecessor differs: {signature}' USING ERRCODE='55000';
  END IF;
  SELECT proacl,proowner,md5(prosrc) INTO before_acl,before_owner,before_body_md5 FROM pg_proc WHERE oid=expected_oid;
  IF before_body_md5 IS DISTINCT FROM '{pinned['newBodyMd5']}' THEN
    EXECUTE {ddl_tag}{sql_ddl}{ddl_tag};
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc routine
    WHERE routine.oid=expected_oid
      AND routine.proowner=before_owner
      AND routine.prosecdef={str(pinned['securityDefiner']).lower()}
      AND routine.prolang=(SELECT oid FROM pg_language WHERE lanname='{pinned['language']}')
      AND routine.proconfig=ARRAY['search_path=pg_catalog']::text[]
      AND routine.proacl IS NOT DISTINCT FROM before_acl
      AND routine.proacl::text='{pinned['acl']}'
      AND md5(routine.prosrc)='{new_body_md5}') THEN
    RAISE EXCEPTION 'week renewal routine postflight differs: {signature}' USING ERRCODE='55000';
  END IF;
END $week_routine$;""")

    statements.extend([
        f"""DO $week_constraint_preflight$
DECLARE target oid; definition text;
BEGIN
  SELECT constraint_row.oid, pg_get_constraintdef(constraint_row.oid)
    INTO target, definition FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid='prefunded_card.checkout_intents'::regclass
      AND constraint_row.conname='checkout_intents_expires_at_check'
      AND constraint_row.contype='c';
  IF target IS DISTINCT FROM {int(constraint['oid'])}::oid OR definition IS NULL
    OR encode(sha256(convert_to(definition,'UTF8')),'hex') IS DISTINCT FROM '{constraint['definitionSha256']}'
    OR definition !~ '^CHECK.*expires_at.*2026-09-29.*15:59:10' THEN
    RAISE EXCEPTION 'week renewal expiry constraint predecessor differs' USING ERRCODE='55000';
  END IF;
END $week_constraint_preflight$;""",
        "ALTER TABLE prefunded_card.checkout_intents DROP CONSTRAINT checkout_intents_expires_at_check;",
        "ALTER TABLE prefunded_card.checkout_intents ADD CONSTRAINT checkout_intents_expires_at_check CHECK (",
        "  expires_at = '2026-10-06T15:59:10Z'::timestamptz OR",
        "  (phase = 'retired_unconfirmed' AND expires_at = '2026-09-29T15:59:10Z'::timestamptz));",
        """DO $expired_roles$
DECLARE role_name name;
BEGIN
  FOR role_name IN SELECT rolname FROM pg_authid WHERE rolname IN
    ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence')
    AND rolvaliduntil='2026-09-29T15:59:10Z'::timestamptz LOOP
    EXECUTE format('ALTER ROLE %I VALID UNTIL %L',role_name,'2026-10-06T15:59:10Z');
  END LOOP;
END $expired_roles$;""",
        f"""DO $week_postflight$
DECLARE protected_after jsonb;
BEGIN
  IF clock_timestamp() >= '2026-10-06T15:59:10Z'::timestamptz
    OR ({_role_fingerprint()}) IS DISTINCT FROM current_setting('baci.week_renewal.roles_before',true) THEN
    RAISE EXCEPTION 'week renewal role metadata or deadline changed' USING ERRCODE='55000'; END IF;
  IF (SELECT count(*) FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid='prefunded_card.checkout_intents'::regclass
        AND constraint_row.conname='checkout_intents_expires_at_check'
        AND constraint_row.contype='c' AND constraint_row.convalidated) IS DISTINCT FROM 1::bigint
    OR NOT EXISTS (SELECT 1 FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid='prefunded_card.checkout_intents'::regclass
        AND constraint_row.conname='checkout_intents_expires_at_check'
        AND pg_get_constraintdef(constraint_row.oid) LIKE '%2026-10-06%'
        AND pg_get_constraintdef(constraint_row.oid) LIKE '%2026-09-29%') THEN
    RAISE EXCEPTION 'week renewal expiry constraint postflight differs' USING ERRCODE='55000';
  END IF;
  protected_after := """ + protected_state + """;
  IF (SELECT encode(sha256(convert_to(string_agg(rolname||':'||rolpassword,E'\\n' ORDER BY rolname),'UTF8')),'hex')
      FROM pg_authid WHERE rolname IN
        ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence'))
      IS DISTINCT FROM current_setting('baci.week_renewal.role_passwords_before',true) THEN
    RAISE EXCEPTION 'week renewal executor passwords changed' USING ERRCODE='55000';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN
      ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence')
      AND rolcanlogin AND rolvaliduntil IS NOT DISTINCT FROM '2026-10-06T15:59:10Z'::timestamptz)
      IS DISTINCT FROM 3::bigint THEN
    RAISE EXCEPTION 'week renewal executor role postflight differs' USING ERRCODE='55000';
  END IF;
  IF encode(sha256(convert_to(protected_after::text,'UTF8')),'hex')
    IS DISTINCT FROM current_setting('baci.week_renewal.protected_before',true) THEN
    RAISE EXCEPTION 'week renewal protected financial state changed' USING ERRCODE='55000';
  END IF;
END $week_postflight$;""",
        "COMMIT;",
    ])
    return ("\n".join(statements) + "\n").encode("utf-8")


def _role_fingerprint() -> str:
    return """SELECT encode(sha256(convert_to(jsonb_build_object(
      'roles', (SELECT jsonb_agg(to_jsonb(role_row)-'rolvaliduntil' ORDER BY rolname)
        FROM pg_authid role_row WHERE rolname IN
        ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence')),
      'memberships', (SELECT coalesce(jsonb_agg(to_jsonb(member_row) ORDER BY roleid,member),'[]'::jsonb)
        FROM pg_auth_members member_row WHERE roleid IN (SELECT oid FROM pg_roles WHERE rolname IN
          ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence'))
        OR member IN (SELECT oid FROM pg_roles WHERE rolname IN
          ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence'))))::text,'UTF8')),'hex')"""


def _protected_state_expression() -> str:
    return """jsonb_build_object(
  'goal', (SELECT to_jsonb(goal_row) FROM public.customer_savings_goals goal_row
    WHERE goal_row.id='430314fd-cd8b-4579-98d4-e9f345713dd6'
      AND goal_row.customer_id='10000000-0000-4000-8000-000000000002'
      AND goal_row.merchant_id='10000000-0000-4000-8000-000000000001'),
  'intent', (SELECT to_jsonb(intent) FROM prefunded_card.checkout_intents intent
    WHERE intent.id='d8bcf921-61b3-4647-90e2-5648e4d6967d'),
  'operation', (SELECT to_jsonb(operation) FROM prefunded_card.operations operation
    WHERE operation.id='d8bcf921-61b3-4647-90e2-5648e4d6967d'),
  'retirementAudits', (SELECT coalesce(jsonb_agg(to_jsonb(audit_row) ORDER BY audit_row.operation_id), '[]'::jsonb)
    FROM prefunded_card.checkout_retirements audit_row),
  'treasuryBinding', (SELECT to_jsonb(binding) FROM prefunded_card.treasury_bindings binding
    WHERE binding.id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57'),
  'treasuryIdentity', (SELECT to_jsonb(identity_row) FROM prefunded_card.treasury_identities identity_row
    WHERE identity_row.treasury_binding_id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57'),
  'replenishments', (SELECT coalesce(jsonb_agg(to_jsonb(replenishment) ORDER BY replenishment.id), '[]'::jsonb)
    FROM prefunded_card.treasury_replenishments replenishment
    WHERE replenishment.treasury_binding_id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57'),
  'otherIntentCount', (SELECT count(*) FROM prefunded_card.checkout_intents
    WHERE id<>'d8bcf921-61b3-4647-90e2-5648e4d6967d'),
  'otherOperationCount', (SELECT count(*) FROM prefunded_card.operations
    WHERE id<>'d8bcf921-61b3-4647-90e2-5648e4d6967d'))"""
