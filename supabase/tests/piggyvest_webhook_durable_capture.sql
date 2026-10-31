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
  v_body bytea := '\x7b2266616d223a317d';
  v_wrong jsonb;
  v_right jsonb;
  v_first jsonb;
  v_second jsonb;
  v_again jsonb;
  v_before bigint := pg_temp.pv_count();
BEGIN
  -- The matched signing family is part of the capture identity: the same
  -- bytes first signed by the wrong family, then redelivered under the
  -- right one, are two immutable rows with their own signatures.
  v_wrong := pg_temp.pv_cmd(v_body, 'evt-family', 'bank-transfer.inflow.success', 'txn-family')
    || jsonb_build_object('keyFamilies', jsonb_build_array('interest'), 'signature', repeat('cd', 64));
  v_right := pg_temp.pv_cmd(v_body, 'evt-family', 'bank-transfer.inflow.success', 'txn-family')
    || jsonb_build_object('keyFamilies', jsonb_build_array('bank'), 'signature', repeat('ef', 64));

  v_first := public.capture_piggyvest_webhook_delivery(v_wrong);
  v_second := public.capture_piggyvest_webhook_delivery(v_right);
  IF v_first->>'outcome' IS DISTINCT FROM 'captured'
    OR v_second->>'outcome' IS DISTINCT FROM 'captured'
    OR v_first->>'id' = v_second->>'id'
    OR pg_temp.pv_count() <> v_before + 2 THEN
    RAISE EXCEPTION 'a corrected-authority delivery must get its own row: % / %', v_first, v_second;
  END IF;
  IF (SELECT signature FROM public.piggyvest_webhook_captures WHERE id = (v_first->>'id')::uuid)
       IS DISTINCT FROM repeat('cd', 64)
    OR (SELECT signature FROM public.piggyvest_webhook_captures WHERE id = (v_second->>'id')::uuid)
       IS DISTINCT FROM repeat('ef', 64)
    OR (SELECT key_families FROM public.piggyvest_webhook_captures WHERE id = (v_second->>'id')::uuid)
       IS DISTINCT FROM ARRAY['bank']::text[] THEN
    RAISE EXCEPTION 'each row must keep its own signature and signing family';
  END IF;

  -- Same family again is still a duplicate, scoped to that family.
  v_again := public.capture_piggyvest_webhook_delivery(v_right);
  IF v_again->>'outcome' IS DISTINCT FROM 'duplicate'
    OR v_again->>'id' IS DISTINCT FROM v_second->>'id'
    OR pg_temp.pv_count() <> v_before + 2 THEN
    RAISE EXCEPTION 'a same-family redelivery must dedupe to its own row: %', v_again;
  END IF;
  IF NOT public.resolve_piggyvest_webhook_capture((v_second->>'id')::uuid, NULL, 'processed', NULL) THEN
    RAISE EXCEPTION 'the corrected row must complete inline';
  END IF;
  v_again := public.capture_piggyvest_webhook_delivery(v_right);
  IF v_again->>'processingState' IS DISTINCT FROM 'processed' THEN
    RAISE EXCEPTION 'the processed short-circuit must apply to the same family: %', v_again;
  END IF;
  v_again := public.capture_piggyvest_webhook_delivery(v_wrong);
  IF v_again->>'outcome' IS DISTINCT FROM 'duplicate'
    OR v_again->>'processingState' IS DISTINCT FROM 'pending'
    OR v_again->>'id' IS DISTINCT FROM v_first->>'id' THEN
    RAISE EXCEPTION 'a processed row of another family must not short-circuit this one: %', v_again;
  END IF;

  -- A key shared by several families is one identity regardless of order.
  v_first := public.capture_piggyvest_webhook_delivery(
    v_right || jsonb_build_object('keyFamilies', jsonb_build_array('legacy', 'bank')));
  v_again := public.capture_piggyvest_webhook_delivery(
    v_right || jsonb_build_object('keyFamilies', jsonb_build_array('bank', 'legacy')));
  IF v_first->>'outcome' IS DISTINCT FROM 'captured'
    OR v_again->>'outcome' IS DISTINCT FROM 'duplicate'
    OR v_again->>'id' IS DISTINCT FROM v_first->>'id' THEN
    RAISE EXCEPTION 'the signing family set must be order independent: % / %', v_first, v_again;
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
  v_before bigint := pg_temp.pv_count();
  v_result jsonb;
BEGIN
  -- Optional metadata is bounded by BYTES (octet_length). These are the
  -- limits the TypeScript capture mirrors: 512 bytes for ids, 200 for the
  -- event type, 8192 bytes for the serialised headers.
  v_result := public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd('\x7b226d62223a317d'::bytea, repeat('é', 256), repeat('é', 100), repeat('é', 256)));
  IF v_result->>'outcome' IS DISTINCT FROM 'captured' THEN
    RAISE EXCEPTION 'identifiers exactly at their byte limits must be accepted: %', v_result;
  END IF;

  -- Headers at the TypeScript budget (8000 bytes of compact JSON plus two
  -- per entry) are comfortably accepted.
  v_result := public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd('\x7b226d62223a327d'::bytea, 'evt-bytes-headers', 'x')
      || jsonb_build_object('headers', jsonb_build_object('x-pvb-a', repeat('é', 3992))));
  IF v_result->>'outcome' IS DISTINCT FROM 'captured' THEN
    RAISE EXCEPTION 'headers at the application budget must be accepted: %', v_result;
  END IF;

  IF pg_temp.pv_count() <> v_before + 2 THEN
    RAISE EXCEPTION 'both within-limit captures must be stored';
  END IF;

  BEGIN
    PERFORM public.capture_piggyvest_webhook_delivery(
      pg_temp.pv_cmd('\x7b226d62223a337d'::bytea, repeat('é', 257), 'x'));
    RAISE EXCEPTION 'a 514-byte event id must be rejected';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    PERFORM public.capture_piggyvest_webhook_delivery(
      pg_temp.pv_cmd('\x7b226d62223a347d'::bytea, 'evt-bytes-type', repeat('é', 101)));
    RAISE EXCEPTION 'a 202-byte event type must be rejected';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    PERFORM public.capture_piggyvest_webhook_delivery(
      pg_temp.pv_cmd('\x7b226d62223a357d'::bytea, 'evt-bytes-big-headers', 'x')
        || jsonb_build_object('headers', jsonb_build_object('x-pvb-a', repeat('é', 4200))));
    RAISE EXCEPTION 'headers over 8192 bytes must be rejected';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  IF pg_temp.pv_count() <> v_before + 2 THEN
    RAISE EXCEPTION 'a rejected over-limit capture must leave no row';
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

-- Configuration-blocked rows must not monopolise the claim. A row the drain
-- cannot verify yet (keys unconfigured, an unreadable archive or family
-- configuration) is released with a bounded backoff: never dead-lettered,
-- without spending the processing attempt budget, and re-entering the queue
-- behind fresher work instead of ahead of it. Plain 'pending' keeps its
-- semantics (immediately claimable, attempt spent).
DO $$
DECLARE
  v_blocked uuid;
  v_healthy uuid;
  v_claim record;
  v_row record;
  v_attempts integer;
BEGIN
  DELETE FROM public.piggyvest_webhook_captures;
  -- received_at is immutable evidence, so "oldest" is simply captured first.
  v_blocked := (public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd('\x7b2262223a317d'::bytea, 'evt-blocked', 'bank-transfer.inflow.success', 'txn-blocked')))->>'id';
  v_healthy := (public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd('\x7b2268223a317d'::bytea, 'evt-healthy', 'bank-transfer.inflow.success', 'txn-healthy')))->>'id';

  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_blocked OR v_claim.attempts <> 1 THEN
    RAISE EXCEPTION 'the oldest row must be claimed first: %', v_claim;
  END IF;

  -- A deferral is fenced by the claim token and needs one.
  IF public.resolve_piggyvest_webhook_capture(v_blocked, gen_random_uuid(), 'deferred', 'KEYS_UNCONFIGURED') THEN
    RAISE EXCEPTION 'a wrong claim token must not defer the row';
  END IF;
  BEGIN
    PERFORM public.resolve_piggyvest_webhook_capture(v_blocked, NULL, 'deferred', 'KEYS_UNCONFIGURED');
    RAISE EXCEPTION 'a deferral without a claim must be rejected';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  IF NOT public.resolve_piggyvest_webhook_capture(v_blocked, v_claim.claim_token, 'deferred', 'KEYS_UNCONFIGURED') THEN
    RAISE EXCEPTION 'the lease holder must be able to defer its row';
  END IF;
  SELECT * INTO v_row FROM public.piggyvest_webhook_captures WHERE id = v_blocked;
  IF v_row.processing_state IS DISTINCT FROM 'pending'
    OR v_row.claim_token IS NOT NULL OR v_row.lease_until IS NOT NULL
    OR v_row.last_error IS DISTINCT FROM 'KEYS_UNCONFIGURED'
    OR v_row.attempts <> 0
    OR v_row.config_deferrals <> 1
    OR v_row.next_attempt_at IS NULL
    OR v_row.next_attempt_at NOT BETWEEN clock_timestamp() + interval '55 seconds'
                                      AND clock_timestamp() + interval '65 seconds' THEN
    RAISE EXCEPTION 'a deferral must release the row to pending, refund its attempt and back off ~60s: %', v_row;
  END IF;

  -- The starvation itself: the next claim moves past the blocked row to the
  -- younger healthy one, instead of re-claiming the same blocked row.
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_healthy THEN
    RAISE EXCEPTION 'a deferred row must not hide younger healthy work: %', v_claim;
  END IF;
  IF NOT public.resolve_piggyvest_webhook_capture(v_healthy, v_claim.claim_token, 'processed', NULL) THEN
    RAISE EXCEPTION 'the healthy row must resolve';
  END IF;
  IF EXISTS (SELECT 1 FROM public.claim_piggyvest_webhook_captures(10, 60, 0)) THEN
    RAISE EXCEPTION 'a deferred row must wait for its retry time';
  END IF;

  -- Once the retry time passes it is claimable again, with a full budget.
  UPDATE public.piggyvest_webhook_captures
    SET next_attempt_at = clock_timestamp() - interval '1 second' WHERE id = v_blocked;
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_blocked OR v_claim.attempts <> 1 THEN
    RAISE EXCEPTION 'a due deferred row must be claimable again without a spent attempt: %', v_claim;
  END IF;

  -- The backoff doubles on the separate configuration counter...
  IF NOT public.resolve_piggyvest_webhook_capture(v_blocked, v_claim.claim_token, 'deferred', 'KEYS_UNCONFIGURED') THEN
    RAISE EXCEPTION 'the second deferral must succeed';
  END IF;
  SELECT * INTO v_row FROM public.piggyvest_webhook_captures WHERE id = v_blocked;
  IF v_row.config_deferrals <> 2
    OR v_row.next_attempt_at NOT BETWEEN clock_timestamp() + interval '115 seconds'
                                      AND clock_timestamp() + interval '125 seconds' THEN
    RAISE EXCEPTION 'the second deferral must back off ~120s: %', v_row;
  END IF;

  -- ...is capped at one hour and the counter saturates, and a spent attempt
  -- budget never dead-letters a configuration-blocked row.
  UPDATE public.piggyvest_webhook_captures
    SET next_attempt_at = clock_timestamp() - interval '1 second',
        config_deferrals = 1000, attempts = 20
    WHERE id = v_blocked;
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF NOT public.resolve_piggyvest_webhook_capture(v_blocked, v_claim.claim_token, 'deferred', 'KEYS_UNCONFIGURED') THEN
    RAISE EXCEPTION 'a saturated deferral must still succeed';
  END IF;
  SELECT * INTO v_row FROM public.piggyvest_webhook_captures WHERE id = v_blocked;
  IF v_row.processing_state IS DISTINCT FROM 'pending'
    OR v_row.config_deferrals <> 1000
    OR v_row.attempts <> 20
    OR v_row.next_attempt_at NOT BETWEEN clock_timestamp() + interval '3590 seconds'
                                      AND clock_timestamp() + interval '3601 seconds' THEN
    RAISE EXCEPTION 'the backoff must cap at one hour and never dead-letter the row: %', v_row;
  END IF;

  -- Plain pending keeps its semantics: immediately claimable, attempt spent,
  -- configuration counter untouched.
  UPDATE public.piggyvest_webhook_captures
    SET next_attempt_at = clock_timestamp() - interval '1 second', attempts = 3
    WHERE id = v_blocked;
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  v_attempts := v_claim.attempts;
  IF v_attempts <> 4 THEN
    RAISE EXCEPTION 'claim must spend an attempt: %', v_claim;
  END IF;
  IF NOT public.resolve_piggyvest_webhook_capture(v_blocked, v_claim.claim_token, 'pending', 'PROCESSING_INCOMPLETE') THEN
    RAISE EXCEPTION 'a plain pending release must succeed';
  END IF;
  SELECT * INTO v_row FROM public.piggyvest_webhook_captures WHERE id = v_blocked;
  IF v_row.processing_state IS DISTINCT FROM 'pending'
    OR v_row.attempts <> v_attempts
    OR v_row.config_deferrals <> 1000
    OR v_row.next_attempt_at > clock_timestamp() THEN
    RAISE EXCEPTION 'a plain pending release must keep its attempt and stay immediately claimable: %', v_row;
  END IF;
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_blocked OR v_claim.attempts <> v_attempts + 1 THEN
    RAISE EXCEPTION 'a plain pending row must be re-claimed at once: %', v_claim;
  END IF;
  IF NOT public.resolve_piggyvest_webhook_capture(v_blocked, v_claim.claim_token, 'processed', NULL) THEN
    RAISE EXCEPTION 'the row must resolve once it can be processed';
  END IF;

  -- A deferred row that is due again re-enters behind work that arrived
  -- before its retry time, not ahead of it.
  DELETE FROM public.piggyvest_webhook_captures;
  v_blocked := (public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd('\x7b2262223a327d'::bytea, 'evt-blocked-2', 'bank-transfer.inflow.success', 'txn-blocked-2')))->>'id';
  v_healthy := (public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd('\x7b2268223a327d'::bytea, 'evt-healthy-2', 'bank-transfer.inflow.success', 'txn-healthy-2')))->>'id';
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_blocked THEN
    RAISE EXCEPTION 'the older row must be claimed first: %', v_claim;
  END IF;
  PERFORM public.resolve_piggyvest_webhook_capture(v_blocked, v_claim.claim_token, 'deferred', 'KEYS_UNCONFIGURED');
  UPDATE public.piggyvest_webhook_captures
    SET next_attempt_at = clock_timestamp() WHERE id = v_blocked;
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_healthy THEN
    RAISE EXCEPTION 'a retry-due row must queue behind work that arrived earlier: %', v_claim;
  END IF;
  PERFORM public.resolve_piggyvest_webhook_capture(v_healthy, v_claim.claim_token, 'processed', NULL);
  SELECT * INTO v_claim FROM public.claim_piggyvest_webhook_captures(1, 60, 0);
  IF v_claim.capture_id IS DISTINCT FROM v_blocked THEN
    RAISE EXCEPTION 'the retry-due row must be claimed once nothing is ahead of it: %', v_claim;
  END IF;

  -- The claim order is index-backed.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_webhook_captures'
      AND indexname = 'piggyvest_webhook_captures_unprocessed_idx'
      AND indexdef LIKE '%next_attempt_at%'
  ) THEN
    RAISE EXCEPTION 'the claim order must be covered by the unprocessed index';
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

-- Denials are asserted through the catalog, never by calling the denied
-- object as an API role: on the pinned replay image a denied function
-- EXECUTE cannot be trapped by an exception handler (see
-- finalize_wallet_order_payment_privileges.sql), so a runtime denial probe
-- aborts the whole statement instead of reporting. The effective-privilege
-- block near the top already covers table, function and PUBLIC
-- grants; the statements below add column-level grants and the diagnostics
-- that name the exact failing precondition through the SQLSTATE: ZACL1 /
-- ZACL2 (anon / authenticated can execute the capture function), ZOWN1
-- (the function is not owned by the role running this suite), ZCOL1
-- (a column-level grant exists), ZRLS1 (RLS or its deny-all policy is off).
DO $$
BEGIN
  IF pg_catalog.has_function_privilege('anon',
    'public.capture_piggyvest_webhook_delivery(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute the capture function'
      USING ERRCODE = 'ZACL1';
  END IF;
END
$$;

DO $$
BEGIN
  IF pg_catalog.has_function_privilege('authenticated',
    'public.capture_piggyvest_webhook_delivery(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute the capture function'
      USING ERRCODE = 'ZACL2';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.capture_piggyvest_webhook_delivery(jsonb)'::pg_catalog.regprocedure
      AND pg_catalog.pg_get_userbyid(p.proowner) = current_user
  ) THEN
    RAISE EXCEPTION 'the capture function is not owned by the role running this suite'
      USING ERRCODE = 'ZOWN1';
  END IF;
END
$$;

DO $$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_any_column_privilege(
      v_role, 'public.piggyvest_webhook_captures'::pg_catalog.regclass,
      'SELECT, INSERT, UPDATE, REFERENCES') THEN
      RAISE EXCEPTION '% holds a column-level grant on piggyvest_webhook_captures', v_role
        USING ERRCODE = 'ZCOL1';
    END IF;
  END LOOP;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.piggyvest_webhook_captures'::pg_catalog.regclass
      AND c.relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_webhook_captures'
      AND policyname = 'piggyvest_webhook_captures_deny_all'
      AND permissive = 'RESTRICTIVE'
      AND qual = 'false'
  ) THEN
    RAISE EXCEPTION 'row level security or its deny-all policy is not in force'
      USING ERRCODE = 'ZRLS1';
  END IF;
END
$$;

-- The one positive runtime role check: service_role captures through the
-- function. The command is built as the owner first and handed over through
-- a transaction-local setting, because the pg_temp helpers are not callable
-- by API roles when default privileges do not grant PUBLIC EXECUTE. Any
-- failure is re-raised with the observed SQLSTATE as its code.
SELECT pg_catalog.set_config('app.pv_cmd_service_role',
  pg_temp.pv_cmd('\x7b2263223a337d'::bytea, 'evt-service', 'x')::text, true);

SET LOCAL ROLE service_role;

DO $$
DECLARE
  v_result jsonb;
  v_state text := 'ALLOWED';
  v_message text;
BEGIN
  BEGIN
    v_result := public.capture_piggyvest_webhook_delivery(
      pg_catalog.current_setting('app.pv_cmd_service_role')::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    RAISE EXCEPTION 'service_role capture failed: % (%)', v_state, v_message
      USING ERRCODE = CASE
        WHEN v_state = 'ALLOWED' THEN 'ZALLW'
        WHEN v_state ~ '^[0-9A-Z]{5}$' THEN v_state
        ELSE 'ZUNKN'
      END;
  END;
  IF v_result->>'outcome' IS DISTINCT FROM 'captured' THEN
    RAISE EXCEPTION 'service_role must capture through the function: %', v_result
      USING ERRCODE = 'ZOUTC';
  END IF;
END
$$;

RESET ROLE;

ROLLBACK;
