-- Regression coverage for 20261111170000_piggyvest_capture_operator_replay.sql.
-- Run after migrations on the private disposable PostgreSQL database only:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--   -f supabase/tests/piggyvest_webhook_capture_operator_replay.sql
--
-- Denials are asserted through the catalog (has_*_privilege, ACLs); nothing
-- calls a denied statement and catches the error. Everything runs inside one
-- transaction and rolls back. The replay connects as a non-superuser, so the
-- suite cannot become another login: behaviour goes through the internal
-- functions with an explicit actor, session refusals through
-- session_refusal(login) and the public functions refusing this connection.
-- Under a superuser it also runs the public path as a real operator login.
BEGIN;

-- 1. Authority: only the operator group can reach the operator surface.
DO $$
DECLARE
  v_role text;
  v_fn regprocedure;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'piggyvest_webhook_capture_operator'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
      AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
  ) THEN
    RAISE EXCEPTION 'operator role missing or carries an elevated attribute';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[
    'piggyvest_capture_operator.list_review_captures(integer)'::regprocedure,
    'piggyvest_capture_operator.requeue_review_capture(uuid,text)'::regprocedure
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid = v_fn AND p.prosecdef AND p.proconfig = ARRAY['search_path=pg_catalog']
    ) THEN
      RAISE EXCEPTION '% is not SECURITY DEFINER with search_path=pg_catalog', v_fn;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p, LATERAL pg_catalog.aclexplode(
        COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
      WHERE p.oid = v_fn AND acl.grantee = 0
    ) THEN
      RAISE EXCEPTION '% is executable by PUBLIC', v_fn;
    END IF;
    IF NOT pg_catalog.has_function_privilege('piggyvest_webhook_capture_operator', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'operator role cannot execute %', v_fn;
    END IF;
    FOREACH v_role IN ARRAY ARRAY[
      'anon', 'authenticated', 'service_role',
      'piggyvest_webhook_capture_worker', 'piggyvest_webhook_intake'
    ] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role)
        AND pg_catalog.has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION '% can execute %', v_role, v_fn;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH v_role IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role',
    'piggyvest_webhook_capture_worker', 'piggyvest_webhook_intake',
    'piggyvest_webhook_capture_operator'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) AND (
      pg_catalog.has_table_privilege(v_role, 'public.piggyvest_webhook_capture_replay_audit',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR pg_catalog.has_table_privilege(v_role, 'public.piggyvest_webhook_captures',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR pg_catalog.has_sequence_privilege(v_role,
        'public.piggyvest_webhook_capture_replay_audit_id_seq', 'USAGE,SELECT,UPDATE')
    ) THEN
      RAISE EXCEPTION '% holds a privilege on the capture or audit table', v_role;
    END IF;
    IF v_role <> 'piggyvest_webhook_capture_operator'
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role)
      AND pg_catalog.has_schema_privilege(v_role, 'piggyvest_capture_operator', 'USAGE') THEN
      RAISE EXCEPTION '% can use the operator schema', v_role;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = 'public.piggyvest_webhook_capture_replay_audit'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'audit table must have row level security enabled';
  END IF;
END
$$;

-- Separation of duties, the other way round: the operator group cannot run
-- any function the drain worker or the intake role was granted.
DO $$
DECLARE
  v_fn text;
BEGIN
  SELECT p.oid::regprocedure::text INTO v_fn
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) g
  JOIN pg_catalog.pg_roles r ON r.oid = g.grantee
  WHERE r.rolname IN ('piggyvest_webhook_capture_worker', 'piggyvest_webhook_intake')
    AND g.privilege_type = 'EXECUTE'
    AND pg_catalog.has_function_privilege(
      'piggyvest_webhook_capture_operator', p.oid, 'EXECUTE')
  LIMIT 1;
  IF v_fn IS NOT NULL THEN
    RAISE EXCEPTION 'operator role can execute pipeline function %', v_fn;
  END IF;
  -- Also by schema/name, which covers access through PUBLIC's default EXECUTE.
  SELECT p.oid::regprocedure::text INTO v_fn
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE (n.nspname = 'piggyvest_webhook_intake'
      OR (n.nspname = 'public' AND p.proname ~ 'piggyvest_webhook_capture'))
    AND pg_catalog.has_function_privilege(
      'piggyvest_webhook_capture_operator', p.oid, 'EXECUTE')
  LIMIT 1;
  IF v_fn IS NOT NULL THEN
    RAISE EXCEPTION 'operator role can execute pipeline function % (by name)', v_fn;
  END IF;
END
$$;

CREATE FUNCTION pg_temp.pv_operator_row(
  p_key text, p_state text, p_attempts integer,
  p_event_type text DEFAULT 'operator-test.non-credit')
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.piggyvest_webhook_captures (
    event_key, body_digest, raw_body, signature, key_version,
    key_families, signing_families, key_status, event_type
  ) VALUES (
    p_key, repeat('c', 64), convert_to(p_key, 'UTF8'), repeat('d', 128),
    'operator-test', ARRAY['bank'], 'bank', 'current', p_event_type
  ) RETURNING id INTO v_id;
  UPDATE public.piggyvest_webhook_captures
  SET processing_state = p_state, attempts = p_attempts,
      last_error = CASE WHEN p_state = 'needs_review' THEN 'REPLAY_FAILED' END
  WHERE id = v_id;
  RETURN v_id;
END
$$;

-- 2. Behaviour of the internal functions the public ones delegate to. The
-- audit actor is exactly the login passed in (the public function passes
-- SESSION_USER; section 4 proves that end to end under a superuser).
CREATE ROLE pv_operator_probe LOGIN IN ROLE piggyvest_webhook_capture_operator;
DO $$
DECLARE
  v_parked uuid := pg_temp.pv_operator_row('operator-parked', 'needs_review', 20);
  v_done uuid := pg_temp.pv_operator_row('operator-processed', 'processed', 1);
  v_limit uuid := pg_temp.pv_operator_row('operator-limit', 'needs_review', 20);
  v_result jsonb;
  v_list jsonb;
  v_row record;
  v_claim record;
  v_audit record;
  v_i integer;
BEGIN

  v_list := piggyvest_capture_operator.review_captures(50);
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(v_list) e
    WHERE e->>'captureId' = v_parked::text AND e->>'lastError' = 'REPLAY_FAILED'
      AND (e->>'attempts')::integer = 20 AND (e->>'operatorReplays')::integer = 0
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(v_list) e
    WHERE e->>'captureId' = v_done::text
       OR e ? 'raw_body' OR e ? 'rawBody' OR e ? 'signature' OR e ? 'requestHeaders'
  ) THEN
    RAISE EXCEPTION 'review listing is wrong or exposes evidence: %', v_list;
  END IF;

  -- A parked capture is requeued once, with an audit row.
  v_result := piggyvest_capture_operator.requeue_capture('pv_operator_probe',
    v_parked, '  ledger fix #4199 deployed, replay once  ');
  IF v_result->>'outcome' IS DISTINCT FROM 'requeued'
    OR (v_result->>'previousAttempts')::integer IS DISTINCT FROM 20
    OR v_result->>'previousLastError' IS DISTINCT FROM 'REPLAY_FAILED'
    OR (v_result->>'replayLimit')::integer IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'parked capture was not requeued: %', v_result;
  END IF;

  -- A second request for the same row changes nothing and writes no audit.
  v_result := piggyvest_capture_operator.requeue_capture('pv_operator_probe',
    v_parked, 'second click on the same capture');
  IF v_result->>'outcome' IS DISTINCT FROM 'not_in_review'
    OR v_result->>'processingState' IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'second requeue was not a no-op: %', v_result;
  END IF;

  v_result := piggyvest_capture_operator.requeue_capture('pv_operator_probe',
    v_done, 'already processed capture');
  IF v_result->>'outcome' IS DISTINCT FROM 'not_in_review'
    OR v_result->>'processingState' IS DISTINCT FROM 'processed' THEN
    RAISE EXCEPTION 'processed capture was touched: %', v_result;
  END IF;

  v_result := piggyvest_capture_operator.requeue_capture('pv_operator_probe',
    gen_random_uuid(), 'capture id that does not exist');
  IF v_result->>'outcome' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'unknown capture was not reported: %', v_result;
  END IF;

  BEGIN
    PERFORM piggyvest_capture_operator.requeue_capture('pv_operator_probe', v_limit, 'short');
    RAISE EXCEPTION 'a short reason was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  SELECT * INTO v_row FROM public.piggyvest_webhook_captures WHERE id = v_parked;
  IF v_row.processing_state IS DISTINCT FROM 'pending' OR v_row.attempts <> 0
    OR v_row.config_deferrals <> 0 OR v_row.next_attempt_at IS NOT NULL
    OR v_row.claim_token IS NOT NULL OR v_row.lease_until IS NOT NULL
    OR v_row.last_error IS DISTINCT FROM 'OPERATOR_REPLAY_REQUESTED'
    OR v_row.raw_body IS DISTINCT FROM convert_to('operator-parked', 'UTF8')
    OR v_row.signature IS DISTINCT FROM repeat('d', 128) THEN
    RAISE EXCEPTION 'requeued row has the wrong lifecycle or changed evidence';
  END IF;
  IF (SELECT processing_state FROM public.piggyvest_webhook_captures WHERE id = v_done)
    IS DISTINCT FROM 'processed' THEN
    RAISE EXCEPTION 'processed capture changed state';
  END IF;

  SELECT count(*) AS n, min(actor) AS actor, min(reason) AS reason,
    min(previous_state) AS previous_state, min(previous_attempts) AS previous_attempts,
    min(previous_last_error) AS previous_last_error
    INTO v_audit
    FROM public.piggyvest_webhook_capture_replay_audit WHERE capture_id = v_parked;
  IF v_audit.n <> 1 OR v_audit.actor IS DISTINCT FROM 'pv_operator_probe'
    OR v_audit.reason IS DISTINCT FROM 'ledger fix #4199 deployed, replay once'
    OR v_audit.previous_state IS DISTINCT FROM 'needs_review'
    OR v_audit.previous_attempts <> 20
    OR v_audit.previous_last_error IS DISTINCT FROM 'REPLAY_FAILED' THEN
    RAISE EXCEPTION 'audit trail is wrong: %', row_to_json(v_audit);
  END IF;
  IF EXISTS (SELECT 1 FROM public.piggyvest_webhook_capture_replay_audit
    WHERE capture_id IN (v_done, v_limit)) THEN
    RAISE EXCEPTION 'a refused request wrote an audit row';
  END IF;

  -- The regular drain claims the requeued row again with a fresh budget.
  UPDATE public.piggyvest_webhook_captures SET processing_state = 'processed'
    WHERE processing_state IN ('pending', 'claimed') AND id <> v_parked;
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(10, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_parked OR v_claim.attempts <> 1 THEN
    RAISE EXCEPTION 'drain did not reclaim the requeued capture with a fresh budget';
  END IF;

  -- The audit trail is append-only, even for the table owner.
  BEGIN
    UPDATE public.piggyvest_webhook_capture_replay_audit SET reason = 'rewritten reason'
      WHERE capture_id = v_parked;
    RAISE EXCEPTION 'audit row was updated';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    DELETE FROM public.piggyvest_webhook_capture_replay_audit WHERE capture_id = v_parked;
    RAISE EXCEPTION 'audit row was deleted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    TRUNCATE public.piggyvest_webhook_capture_replay_audit;
    RAISE EXCEPTION 'audit table was truncated';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- At most five operator requeues per capture.
  FOR v_i IN 1..5 LOOP
    v_result := piggyvest_capture_operator.requeue_capture('pv_operator_probe',
      v_limit, 'bounded replay attempt ' || v_i);
    IF v_result->>'outcome' IS DISTINCT FROM 'requeued' THEN
      RAISE EXCEPTION 'requeue % was refused: %', v_i, v_result;
    END IF;
    UPDATE public.piggyvest_webhook_captures
      SET processing_state = 'needs_review', last_error = repeat('E', 200)
      WHERE id = v_limit;
  END LOOP;
  v_result := piggyvest_capture_operator.requeue_capture('pv_operator_probe',
    v_limit, 'sixth replay must be refused');
  IF v_result->>'outcome' IS DISTINCT FROM 'replay_limit_reached'
    OR (v_result->>'operatorReplays')::integer <> 5
    OR (v_result->>'replayLimit')::integer IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'replay limit was not enforced: %', v_result;
  END IF;
  IF (SELECT processing_state FROM public.piggyvest_webhook_captures WHERE id = v_limit)
    IS DISTINCT FROM 'needs_review' THEN
    RAISE EXCEPTION 'refused requeue changed the row';
  END IF;
  -- The audit keeps the exact parked error (last_error is capped at 200).
  IF (SELECT count(*) FROM public.piggyvest_webhook_capture_replay_audit
      WHERE capture_id = v_limit AND previous_last_error = repeat('E', 200)) <> 4 THEN
    RAISE EXCEPTION 'audit truncated or lost the parked error';
  END IF;
END
$$;

-- 3. Credit events replay only once both ledgers dedupe on pvb_reference
-- (PR #4199). Start from "not deployed" whatever this database has; every
-- schema change here is rolled back.
DO $$
DECLARE
  v_credit uuid := pg_temp.pv_operator_row(
    'operator-credit-inflow', 'needs_review', 20, 'bank-transfer.inflow.success');
  v_rows uuid[] := ARRAY[
    v_credit,
    pg_temp.pv_operator_row(
      'operator-credit-payout', 'needs_review', 20, 'interest-payout.success'),
    pg_temp.pv_operator_row('operator-credit-untyped', 'needs_review', 20, NULL)];
  v_result jsonb;
  v_id uuid;
BEGIN
  IF pg_catalog.to_regclass('public.piggyvest_inflow_credits') IS NOT NULL THEN
    ALTER TABLE public.piggyvest_inflow_credits
      DROP CONSTRAINT IF EXISTS piggyvest_inflow_credits_pvb_reference_key;
  END IF;
  IF pg_catalog.to_regclass('public.piggyvest_interest_payouts') IS NOT NULL THEN
    ALTER TABLE public.piggyvest_interest_payouts
      DROP CONSTRAINT IF EXISTS piggyvest_interest_payouts_pvb_reference_key;
  END IF;

  FOREACH v_id IN ARRAY v_rows
  LOOP
    v_result := piggyvest_capture_operator.requeue_capture('pv_operator_probe',
      v_id, 'credit replay before dedupe ships');
    IF v_result->>'outcome' IS DISTINCT FROM 'credit_dedupe_missing' THEN
      RAISE EXCEPTION 'credit capture % replayed without pvb_reference dedupe: %', v_id, v_result;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.piggyvest_webhook_captures
      WHERE id = ANY (v_rows) AND processing_state <> 'needs_review')
    OR EXISTS (SELECT 1 FROM public.piggyvest_webhook_capture_replay_audit
      WHERE capture_id = ANY (v_rows)) THEN
    RAISE EXCEPTION 'refused credit replay changed a row or wrote an audit';
  END IF;

  -- With only one ledger protected, a credit still waits.
  IF pg_catalog.to_regclass('public.piggyvest_inflow_credits') IS NULL THEN
    CREATE TABLE public.piggyvest_inflow_credits (pvb_reference text);
  END IF;
  ALTER TABLE public.piggyvest_inflow_credits ADD COLUMN IF NOT EXISTS pvb_reference text;
  ALTER TABLE public.piggyvest_inflow_credits
    ADD CONSTRAINT piggyvest_inflow_credits_pvb_reference_key UNIQUE (pvb_reference);
  v_result := piggyvest_capture_operator.requeue_capture('pv_operator_probe',
    v_credit, 'credit replay with one ledger protected');
  IF v_result->>'outcome' IS DISTINCT FROM 'credit_dedupe_missing' THEN
    RAISE EXCEPTION 'credit replayed with only one ledger protected: %', v_result;
  END IF;

  -- A partial unique index does not dedupe every credit: still refused.
  IF pg_catalog.to_regclass('public.piggyvest_interest_payouts') IS NULL THEN
    CREATE TABLE public.piggyvest_interest_payouts (pvb_reference text);
  END IF;
  ALTER TABLE public.piggyvest_interest_payouts ADD COLUMN IF NOT EXISTS pvb_reference text;
  ALTER TABLE public.piggyvest_interest_payouts
    DROP CONSTRAINT IF EXISTS piggyvest_interest_payouts_pvb_reference_key;
  CREATE UNIQUE INDEX pv_operator_partial_probe
    ON public.piggyvest_interest_payouts (pvb_reference) WHERE pvb_reference <> '';
  v_result := piggyvest_capture_operator.requeue_capture('pv_operator_probe',
    v_credit, 'credit replay with a partial index only');
  IF v_result->>'outcome' IS DISTINCT FROM 'credit_dedupe_missing' THEN
    RAISE EXCEPTION 'a partial unique index opened the credit gate: %', v_result;
  END IF;
  DROP INDEX public.pv_operator_partial_probe;

  -- With both ledgers protected the credit replays: one by a UNIQUE
  -- constraint, the other by a plain CREATE UNIQUE INDEX.
  CREATE UNIQUE INDEX pv_operator_unique_probe
    ON public.piggyvest_interest_payouts (pvb_reference);
  v_result := piggyvest_capture_operator.requeue_capture('pv_operator_probe',
    v_credit, 'credit replay after dedupe ships');
  IF v_result->>'outcome' IS DISTINCT FROM 'requeued' THEN
    RAISE EXCEPTION 'credit was not requeued once both ledgers dedupe: %', v_result;
  END IF;
END
$$;

-- 4. The database enforces the operator session checks itself, so calling
-- the public functions directly cannot skip what the CLI refuses.
CREATE ROLE pv_operator_dual LOGIN
  IN ROLE piggyvest_webhook_capture_operator, piggyvest_webhook_capture_worker;
DO $$
DECLARE
  v_row uuid := pg_temp.pv_operator_row('operator-session-checks', 'needs_review', 20);
  v_refused integer := 0;
  v_fn regprocedure;
  v_role text;
  v_result jsonb;
BEGIN
  -- Clean operator login: no refusal. Others: refused, with the reason.
  IF piggyvest_capture_operator.session_refusal('pv_operator_probe') <> '' THEN
    RAISE EXCEPTION 'a clean operator login was refused: %',
      piggyvest_capture_operator.session_refusal('pv_operator_probe');
  END IF;
  IF piggyvest_capture_operator.session_refusal('pv_operator_dual')
      NOT LIKE '%besides the operator role%' THEN
    RAISE EXCEPTION 'a login holding the worker role was not refused';
  END IF;
  IF piggyvest_capture_operator.session_refusal('piggyvest_webhook_capture_operator') = ''
    OR piggyvest_capture_operator.session_refusal('no_such_login_pv') = ''
    OR piggyvest_capture_operator.session_refusal(SESSION_USER) = '' THEN
    RAISE EXCEPTION 'a group role, an unknown login or this connection was accepted';
  END IF;

  -- This connection is not a clean operator, so both public functions refuse
  -- it before reading or changing anything.
  BEGIN
    PERFORM piggyvest_capture_operator.requeue_review_capture(v_row, 'direct call bypass attempt');
  EXCEPTION WHEN insufficient_privilege THEN
    v_refused := v_refused + 1;
  END;
  BEGIN
    PERFORM piggyvest_capture_operator.list_review_captures(10);
  EXCEPTION WHEN insufficient_privilege THEN
    v_refused := v_refused + 1;
  END;
  IF v_refused <> 2 THEN
    RAISE EXCEPTION 'database did not refuse % of 2 direct calls', 2 - v_refused;
  END IF;
  IF (SELECT processing_state FROM public.piggyvest_webhook_captures WHERE id = v_row)
      IS DISTINCT FROM 'needs_review'
    OR EXISTS (SELECT 1 FROM public.piggyvest_webhook_capture_replay_audit
      WHERE capture_id = v_row) THEN
    RAISE EXCEPTION 'a refused operator session changed the row or wrote an audit';
  END IF;

  -- The internal functions are callable only by their owner, and are not
  -- SECURITY DEFINER.
  FOREACH v_fn IN ARRAY ARRAY[
    'piggyvest_capture_operator.review_captures(integer)'::regprocedure,
    'piggyvest_capture_operator.requeue_capture(text,uuid,text)'::regprocedure,
    'piggyvest_capture_operator.session_refusal(text)'::regprocedure
  ] LOOP
    IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) THEN
      RAISE EXCEPTION '% must not be SECURITY DEFINER', v_fn;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['piggyvest_webhook_capture_operator', 'anon',
      'authenticated', 'service_role', 'pv_operator_probe', 'pv_operator_dual'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role)
        AND pg_catalog.has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION '% can execute internal %', v_role, v_fn;
      END IF;
    END LOOP;
  END LOOP;

  -- End to end through the public functions as real logins, where this
  -- connection may switch login (a superuser; the CI replay cannot).
  IF (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    SET LOCAL SESSION AUTHORIZATION pv_operator_probe;
    v_result := piggyvest_capture_operator.requeue_review_capture(
      v_row, 'end to end operator replay');
    PERFORM piggyvest_capture_operator.list_review_captures(10);
    RESET SESSION AUTHORIZATION;
    IF v_result->>'outcome' IS DISTINCT FROM 'requeued'
      OR (SELECT actor FROM public.piggyvest_webhook_capture_replay_audit
          WHERE capture_id = v_row) IS DISTINCT FROM 'pv_operator_probe' THEN
      RAISE EXCEPTION 'end to end requeue failed or recorded the wrong actor: %', v_result;
    END IF;
    v_refused := 0;
    BEGIN
      SET LOCAL SESSION AUTHORIZATION pv_operator_dual;
      PERFORM piggyvest_capture_operator.list_review_captures(10);
    EXCEPTION WHEN insufficient_privilege THEN
      v_refused := v_refused + 1;
    END;
    RESET SESSION AUTHORIZATION;
    BEGIN
      SET LOCAL ROLE piggyvest_webhook_capture_operator;
      PERFORM piggyvest_capture_operator.list_review_captures(10);
    EXCEPTION WHEN insufficient_privilege THEN
      v_refused := v_refused + 1;
    END;
    RESET ROLE;
    IF v_refused <> 2 THEN
      RAISE EXCEPTION 'a dual-role login or SET ROLE was not refused';
    END IF;
  ELSE
    RAISE NOTICE 'not a superuser: end-to-end login switch skipped';
  END IF;
END
$$;

ROLLBACK;
