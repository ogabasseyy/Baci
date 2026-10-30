-- Contract test: durable PiggyVest webhook capture (R5).
--
-- Proves, against live PostgreSQL:
--   * effective privileges (table: no direct access for anyone but the
--     owner; functions: service_role only), RLS enabled with deny-all;
--   * byte-exact capture, dedupe on (event key, body digest), no partial
--     row when a command is rejected;
--   * claim/lease/resolve lifecycle and immutable evidence.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_webhook_durable_capture.sql

BEGIN;

CREATE FUNCTION pg_temp.pv_cmd(
  p_body bytea,
  p_event_id text,
  p_event_type text,
  p_txn text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_build_object(
    'rawHex', encode(p_body, 'hex'),
    'bodyDigest', encode(sha256(p_body), 'hex'),
    'signature', repeat('ab', 64),
    'eventId', p_event_id,
    'eventType', p_event_type,
    'providerTransactionId', p_txn,
    'headers', jsonb_build_object('content-type', 'application/json'),
    'keyVersion', 'k-0123456789abcdef',
    'keyFamilies', jsonb_build_array('legacy'),
    'keyStatus', 'current'
  )
$$;

CREATE FUNCTION pg_temp.pv_count() RETURNS bigint
LANGUAGE sql
AS $$ SELECT count(*) FROM public.piggyvest_webhook_captures $$;

DO $$
DECLARE
  v_table regclass := to_regclass('public.piggyvest_webhook_captures');
  v_role text;
  v_privilege text;
  v_fn regprocedure;
  v_public_grants integer;
BEGIN
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'piggyvest_webhook_captures is missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_table) THEN
    RAISE EXCEPTION 'row level security must be enabled on piggyvest_webhook_captures';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_webhook_captures'
      AND policyname = 'piggyvest_webhook_captures_deny_all'
      AND permissive = 'RESTRICTIVE'
      AND qual = 'false'
  ) THEN
    RAISE EXCEPTION 'deny-all restrictive policy is missing';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH v_privilege IN ARRAY
      ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    LOOP
      IF has_table_privilege(v_role, v_table, v_privilege) THEN
        RAISE EXCEPTION '% must not hold % on piggyvest_webhook_captures', v_role, v_privilege;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.capture_piggyvest_webhook_delivery(jsonb)'::regprocedure,
    'public.claim_piggyvest_webhook_captures(integer,integer,integer)'::regprocedure,
    'public.resolve_piggyvest_webhook_capture(uuid,uuid,text,text)'::regprocedure,
    'public.piggyvest_webhook_capture_status()'::regprocedure
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon must not execute %', v_fn;
    END IF;
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated must not execute %', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role must execute %', v_fn;
    END IF;
    SELECT count(*) INTO v_public_grants
      FROM pg_proc p, LATERAL aclexplode(p.proacl) AS acl
      WHERE p.oid = v_fn AND acl.grantee = 0;
    IF v_public_grants > 0 THEN
      RAISE EXCEPTION 'PUBLIC must not execute %', v_fn;
    END IF;
  END LOOP;

  v_fn := 'public.piggyvest_webhook_captures_immutable_evidence()'::regprocedure;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% must not execute the evidence trigger function', v_role;
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  v_exact bytea :=
    convert_to(E' \r\n{"eventId":"evt-exact",  "eventType":"interest-accrued.success"}\t\n', 'UTF8')
    || '\xfffe00'::bytea;
  v_result jsonb;
  v_stored bytea;
  v_before bigint;
BEGIN
  v_before := pg_temp.pv_count();

  v_result := public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd(v_exact, 'evt-exact', 'interest-accrued.success', 'txn-1'));
  IF v_result->>'outcome' IS DISTINCT FROM 'captured'
    OR v_result->>'processingState' IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'first delivery must be captured pending: %', v_result;
  END IF;

  SELECT raw_body INTO v_stored FROM public.piggyvest_webhook_captures
    WHERE id = (v_result->>'id')::uuid;
  IF v_stored IS DISTINCT FROM v_exact THEN
    RAISE EXCEPTION 'raw bytes must be preserved exactly, including whitespace and non-UTF8 bytes';
  END IF;

  v_result := public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd(v_exact, 'evt-exact', 'interest-accrued.success', 'txn-1'));
  IF v_result->>'outcome' IS DISTINCT FROM 'duplicate' THEN
    RAISE EXCEPTION 'identical redelivery must be reported duplicate: %', v_result;
  END IF;
  IF pg_temp.pv_count() <> v_before + 1 THEN
    RAISE EXCEPTION 'duplicate delivery must leave exactly one stored row';
  END IF;

  v_result := public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd(v_exact || '\x20'::bytea, 'evt-exact', 'interest-accrued.success', 'txn-1'));
  IF v_result->>'outcome' IS DISTINCT FROM 'captured'
    OR pg_temp.pv_count() <> v_before + 2 THEN
    RAISE EXCEPTION 'same event id with a different body must be kept as separate evidence';
  END IF;

  v_result := public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd('\x7b7d'::bytea, NULL, NULL));
  IF v_result->>'outcome' IS DISTINCT FROM 'captured' THEN
    RAISE EXCEPTION 'an unparseable-id body must still be captured';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.piggyvest_webhook_captures
    WHERE event_key = 'raw:' || encode(sha256('\x7b7d'::bytea), 'hex')
      AND provider_event_id IS NULL AND event_type IS NULL
  ) THEN
    RAISE EXCEPTION 'unknown events are keyed by their digest';
  END IF;
  v_result := public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd('\x7b7d'::bytea, NULL, NULL));
  IF v_result->>'outcome' IS DISTINCT FROM 'duplicate'
    OR pg_temp.pv_count() <> v_before + 3 THEN
    RAISE EXCEPTION 'digest-keyed redelivery must dedupe';
  END IF;
END
$$;

DO $$
DECLARE
  v_before bigint := pg_temp.pv_count();
  v_valid jsonb := pg_temp.pv_cmd('\x7b7d20'::bytea, 'evt-bad', 'x');
  v_case text;
  v_command jsonb;
  v_rejected integer := 0;
BEGIN
  FOREACH v_case IN ARRAY ARRAY[
    'bad-hex', 'digest-mismatch', 'short-signature', 'bad-family',
    'bad-status', 'headers-not-object', 'not-an-object', 'empty-families'
  ] LOOP
    v_command := CASE v_case
      WHEN 'bad-hex' THEN v_valid || jsonb_build_object('rawHex', 'zz')
      WHEN 'digest-mismatch' THEN v_valid || jsonb_build_object('bodyDigest', repeat('0', 64))
      WHEN 'short-signature' THEN v_valid || jsonb_build_object('signature', 'ab')
      WHEN 'bad-family' THEN v_valid || jsonb_build_object('keyFamilies', jsonb_build_array('other'))
      WHEN 'bad-status' THEN v_valid || jsonb_build_object('keyStatus', 'replay-only')
      WHEN 'headers-not-object' THEN v_valid || jsonb_build_object('headers', jsonb_build_array(1))
      WHEN 'empty-families' THEN v_valid || jsonb_build_object('keyFamilies', '[]'::jsonb)
      ELSE '[]'::jsonb
    END;
    BEGIN
      PERFORM public.capture_piggyvest_webhook_delivery(v_command);
    EXCEPTION WHEN OTHERS THEN
      v_rejected := v_rejected + 1;
    END;
  END LOOP;
  IF v_rejected <> 8 THEN
    RAISE EXCEPTION 'every malformed command must be rejected, rejected %', v_rejected;
  END IF;
  IF pg_temp.pv_count() <> v_before THEN
    RAISE EXCEPTION 'a rejected command must leave no partial row';
  END IF;
END
$$;

DO $$
DECLARE
  v_id uuid;
  v_claim record;
  v_token uuid;
  v_status jsonb;
BEGIN
  DELETE FROM public.piggyvest_webhook_captures;
  v_id := (public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd('\x7b2261223a317d'::bytea, 'evt-claim', 'bank-transfer.inflow.success', 'txn-claim')))->>'id';

  IF EXISTS (SELECT 1 FROM public.claim_piggyvest_webhook_captures(10, 60, 300)) THEN
    RAISE EXCEPTION 'a fresh row must not be claimable before the inline grace period';
  END IF;

  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(10, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_id OR v_claim.attempts <> 1
    OR v_claim.raw_hex IS DISTINCT FROM '7b2261223a317d'
    OR v_claim.provider_transaction_id IS DISTINCT FROM 'txn-claim' THEN
    RAISE EXCEPTION 'claim must lease the row with its exact bytes: %', v_claim;
  END IF;
  v_token := v_claim.claim_token;

  IF EXISTS (SELECT 1 FROM public.claim_piggyvest_webhook_captures(10, 60, 0)) THEN
    RAISE EXCEPTION 'a leased row must not be claimed twice';
  END IF;
  IF public.resolve_piggyvest_webhook_capture(v_id, NULL, 'processed', NULL) THEN
    RAISE EXCEPTION 'inline completion must not overwrite a claimed row';
  END IF;
  IF public.resolve_piggyvest_webhook_capture(v_id, gen_random_uuid(), 'processed', NULL) THEN
    RAISE EXCEPTION 'a wrong claim token must not resolve the row';
  END IF;

  UPDATE public.piggyvest_webhook_captures
    SET lease_until = clock_timestamp() - interval '1 second' WHERE id = v_id;
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(10, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_id OR v_claim.attempts <> 2
    OR v_claim.claim_token = v_token THEN
    RAISE EXCEPTION 'an expired lease must be reclaimed with a fresh token';
  END IF;
  IF public.resolve_piggyvest_webhook_capture(v_id, v_token, 'processed', NULL) THEN
    RAISE EXCEPTION 'the previous lease holder must be fenced out';
  END IF;

  IF NOT public.resolve_piggyvest_webhook_capture(v_id, v_claim.claim_token, 'processed', NULL) THEN
    RAISE EXCEPTION 'the current lease holder must resolve the row';
  END IF;
  IF EXISTS (SELECT 1 FROM public.claim_piggyvest_webhook_captures(10, 60, 0)) THEN
    RAISE EXCEPTION 'a processed row must not be claimed again';
  END IF;

  v_status := public.piggyvest_webhook_capture_status();
  IF (v_status->>'pending')::int <> 0 OR (v_status->>'needsReview')::int <> 0
    OR v_status->>'lastProcessedAt' IS NULL THEN
    RAISE EXCEPTION 'status counters are wrong: %', v_status;
  END IF;
END
$$;

DO $$
DECLARE
  v_id uuid;
BEGIN
  v_id := (public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd('\x7b2262223a327d'::bytea, 'evt-inline', 'bank-transfer.inflow.success')))->>'id';
  IF NOT public.resolve_piggyvest_webhook_capture(v_id, NULL, 'processed', NULL) THEN
    RAISE EXCEPTION 'inline completion of a pending row must succeed';
  END IF;
  BEGIN
    UPDATE public.piggyvest_webhook_captures SET raw_body = '\x00' WHERE id = v_id;
    RAISE EXCEPTION 'captured evidence must be immutable';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;

DO $$
DECLARE
  v_role text;
  v_id uuid;
  v_command jsonb;
  v_service_command jsonb;
BEGIN
  -- Commands are built as the owner, before any role switch: the pg_temp
  -- helpers are not executable by API roles when default privileges revoke
  -- PUBLIC EXECUTE, and a helper denial must never be mistaken for the
  -- denial of the function under test.
  v_service_command := pg_temp.pv_cmd('\x7b2263223a337d'::bytea, 'evt-service', 'x');

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    v_command := pg_temp.pv_cmd('\x7b7d'::bytea, 'evt-' || v_role, 'x');
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    BEGIN
      PERFORM public.capture_piggyvest_webhook_delivery(v_command);
      RAISE EXCEPTION '% must not capture', v_role;
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%capture_piggyvest_webhook_delivery%' THEN
        RAISE EXCEPTION '% was denied for the wrong reason: %', v_role, SQLERRM;
      END IF;
    END;
    BEGIN
      PERFORM 1 FROM public.piggyvest_webhook_captures;
      RAISE EXCEPTION '% must not read captures', v_role;
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%piggyvest_webhook_captures%' THEN
        RAISE EXCEPTION '% was denied for the wrong reason: %', v_role, SQLERRM;
      END IF;
    END;
    RESET ROLE;
  END LOOP;

  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM 1 FROM public.piggyvest_webhook_captures;
    RAISE EXCEPTION 'service_role must not read the table directly';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%piggyvest_webhook_captures%' THEN
      RAISE EXCEPTION 'service_role was denied for the wrong reason: %', SQLERRM;
    END IF;
  END;
  v_id := (public.capture_piggyvest_webhook_delivery(v_service_command))->>'id';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'service_role must capture through the function';
  END IF;
  RESET ROLE;
END
$$;

ROLLBACK;
