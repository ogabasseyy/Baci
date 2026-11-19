-- Part of piggyvest_webhook_durable_capture.sql (\ir): privileges, byte-exact capture and dedupe, signing-family identity.
-- Runs inside the entry file's transaction and session; not a standalone suite.

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
