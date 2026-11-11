-- Regression coverage for 20261111140000_piggyvest_capture_operator_replay.sql.
-- Run after migrations on the private disposable PostgreSQL database only:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--   -f supabase/tests/piggyvest_webhook_capture_operator_replay.sql
--
-- Denials are asserted through the catalog (has_*_privilege, ACLs); nothing
-- calls a denied statement and catches the error. Behaviour runs inside one
-- transaction as a throwaway operator login (SET SESSION AUTHORIZATION) or
-- under SET LOCAL ROLE to the operator group, then rolls back.
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

CREATE FUNCTION pg_temp.pv_operator_row(p_key text, p_state text, p_attempts integer)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.piggyvest_webhook_captures (
    event_key, body_digest, raw_body, signature, key_version,
    key_families, signing_families, key_status
  ) VALUES (
    p_key, repeat('c', 64), convert_to(p_key, 'UTF8'), repeat('d', 128),
    'operator-test', ARRAY['bank'], 'bank', 'current'
  ) RETURNING id INTO v_id;
  UPDATE public.piggyvest_webhook_captures
  SET processing_state = p_state, attempts = p_attempts,
      last_error = CASE WHEN p_state = 'needs_review' THEN 'REPLAY_FAILED' END
  WHERE id = v_id;
  RETURN v_id;
END
$$;

-- 2. Behaviour, called by a login whose only authority is the operator group.
-- The audit actor must be that login, never the group or the function owner.
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
  SET LOCAL SESSION AUTHORIZATION pv_operator_probe;

  v_list := piggyvest_capture_operator.list_review_captures(50);
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
  v_result := piggyvest_capture_operator.requeue_review_capture(
    v_parked, '  ledger fix #4199 deployed, replay once  ');
  IF v_result->>'outcome' IS DISTINCT FROM 'requeued'
    OR (v_result->>'previousAttempts')::integer IS DISTINCT FROM 20
    OR v_result->>'previousLastError' IS DISTINCT FROM 'REPLAY_FAILED'
    OR (v_result->>'replayLimit')::integer IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'parked capture was not requeued: %', v_result;
  END IF;

  -- A second request for the same row changes nothing and writes no audit.
  v_result := piggyvest_capture_operator.requeue_review_capture(
    v_parked, 'second click on the same capture');
  IF v_result->>'outcome' IS DISTINCT FROM 'not_in_review'
    OR v_result->>'processingState' IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'second requeue was not a no-op: %', v_result;
  END IF;

  v_result := piggyvest_capture_operator.requeue_review_capture(
    v_done, 'already processed capture');
  IF v_result->>'outcome' IS DISTINCT FROM 'not_in_review'
    OR v_result->>'processingState' IS DISTINCT FROM 'processed' THEN
    RAISE EXCEPTION 'processed capture was touched: %', v_result;
  END IF;

  v_result := piggyvest_capture_operator.requeue_review_capture(
    gen_random_uuid(), 'capture id that does not exist');
  IF v_result->>'outcome' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'unknown capture was not reported: %', v_result;
  END IF;

  BEGIN
    PERFORM piggyvest_capture_operator.requeue_review_capture(v_limit, 'short');
    RAISE EXCEPTION 'a short reason was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  RESET SESSION AUTHORIZATION;

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
  SET LOCAL ROLE piggyvest_webhook_capture_operator;
  FOR v_i IN 1..5 LOOP
    v_result := piggyvest_capture_operator.requeue_review_capture(
      v_limit, 'bounded replay attempt ' || v_i);
    IF v_result->>'outcome' IS DISTINCT FROM 'requeued' THEN
      RAISE EXCEPTION 'requeue % was refused: %', v_i, v_result;
    END IF;
    RESET ROLE;
    UPDATE public.piggyvest_webhook_captures
      SET processing_state = 'needs_review', last_error = repeat('E', 200)
      WHERE id = v_limit;
    SET LOCAL ROLE piggyvest_webhook_capture_operator;
  END LOOP;
  v_result := piggyvest_capture_operator.requeue_review_capture(
    v_limit, 'sixth replay must be refused');
  IF v_result->>'outcome' IS DISTINCT FROM 'replay_limit_reached'
    OR (v_result->>'operatorReplays')::integer <> 5
    OR (v_result->>'replayLimit')::integer IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'replay limit was not enforced: %', v_result;
  END IF;
  RESET ROLE;
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

ROLLBACK;
