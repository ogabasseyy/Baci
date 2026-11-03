-- Part of piggyvest_webhook_durable_capture.sql (\ir): malformed-command rejection and byte limits.
-- Runs inside the entry file's transaction and session; not a standalone suite.

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
