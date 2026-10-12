-- MCP guest carts: RPC outcomes, version gate, expiry, retention, line and
-- payload limits. Assertion-specific SQLSTATEs survive replay log
-- sanitization without exposing row data. P1101..P1116, P1122..P1124,
-- P1126, P1130..P1131 identify fixed assertions.

BEGIN;
DO $$
DECLARE
  v_version bigint;
  v_outcome text;
  v_count integer;
  v_items jsonb;
  v_expires timestamptz;
  v_deleted boolean;
  v_cleaned integer;
  bad_items record;
BEGIN
  -- Creation reports ok at version 1.
  SELECT version, outcome INTO v_version, v_outcome
  FROM public.upsert_mcp_guest_cart(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '[]', pg_catalog.now() + interval '7 days', NULL);
  IF v_version <> 1 OR v_outcome <> 'ok'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1101', MESSAGE = 'cart creation failed'; END IF;

  -- Recreating the same token reports conflict, never overwrites.
  SELECT version, outcome INTO v_version, v_outcome
  FROM public.upsert_mcp_guest_cart(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '[]', pg_catalog.now() + interval '7 days', NULL);
  IF v_outcome <> 'conflict'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1102', MESSAGE = 'creation conflict missed'; END IF;

  -- Get returns items, expiry, and version.
  SELECT items, expires_at, version INTO v_items, v_expires, v_version
  FROM public.get_mcp_guest_cart(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  IF NOT FOUND OR v_version <> 1
  THEN RAISE EXCEPTION USING ERRCODE = 'P1103', MESSAGE = 'cart get failed'; END IF;

  -- Get of an unknown token returns zero rows.
  SELECT count(*) INTO v_count FROM public.get_mcp_guest_cart(
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  IF v_count <> 0
  THEN RAISE EXCEPTION USING ERRCODE = 'P1104', MESSAGE = 'unknown token returned rows'; END IF;

  -- Update on the current version reports ok and bumps the version.
  SELECT version, outcome INTO v_version, v_outcome
  FROM public.upsert_mcp_guest_cart(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '[{"product_id":"11111111-1111-4111-8111-111111111111","quantity":1}]', pg_catalog.now() + interval '7 days', 1);
  IF v_version <> 2 OR v_outcome <> 'ok'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1105', MESSAGE = 'versioned update failed'; END IF;

  -- Update on a stale version reports conflict with the current version.
  SELECT version, outcome INTO v_version, v_outcome
  FROM public.upsert_mcp_guest_cart(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '[]', pg_catalog.now() + interval '7 days', 1);
  IF v_version <> 2 OR v_outcome <> 'conflict'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1106', MESSAGE = 'stale update not detected'; END IF;

  -- Update of a missing token reports missing.
  SELECT outcome INTO v_outcome
  FROM public.upsert_mcp_guest_cart(
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '[]', pg_catalog.now() + interval '7 days', 1);
  IF v_outcome <> 'missing'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1107', MESSAGE = 'missing token not reported'; END IF;

  -- An expired row is never resurrected: update reports expired.
  SELECT outcome INTO v_outcome
  FROM public.upsert_mcp_guest_cart(
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    '[]', pg_catalog.now() - interval '1 day', NULL);
  IF v_outcome <> 'ok'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1108', MESSAGE = 'expired fixture not stored'; END IF;
  SELECT outcome INTO v_outcome
  FROM public.upsert_mcp_guest_cart(
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    '[]', pg_catalog.now() + interval '7 days', 1);
  IF v_outcome <> 'expired'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1109', MESSAGE = 'expired row resurrected'; END IF;

  -- Version-gated delete removes once, then reports false.
  SELECT public.delete_mcp_guest_cart(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 2) INTO v_deleted;
  IF v_deleted IS NOT TRUE
  THEN RAISE EXCEPTION USING ERRCODE = 'P1110', MESSAGE = 'versioned delete failed'; END IF;
  SELECT public.delete_mcp_guest_cart(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 2) INTO v_deleted;
  IF v_deleted IS NOT FALSE
  THEN RAISE EXCEPTION USING ERRCODE = 'P1111', MESSAGE = 'repeat delete reported true'; END IF;

  -- Malformed inputs raise 22023 instead of persisting.
  BEGIN
    PERFORM public.upsert_mcp_guest_cart('nope', '[]', pg_catalog.now(), NULL);
    RAISE EXCEPTION USING ERRCODE = 'P1112', MESSAGE = 'bad token accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
  END;
  BEGIN
    PERFORM public.upsert_mcp_guest_cart(
      'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      '{}', pg_catalog.now(), NULL);
    RAISE EXCEPTION USING ERRCODE = 'P1113', MESSAGE = 'non-array items accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
  END;

  -- Retention deletes expired rows only, honoring the batch cap.
  PERFORM public.upsert_mcp_guest_cart(
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    '[]', pg_catalog.now() - interval '1 hour', NULL);
  PERFORM public.upsert_mcp_guest_cart(
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    '[]', pg_catalog.now() + interval '7 days', NULL);
  SELECT public.cleanup_mcp_guest_carts(1) INTO v_cleaned;
  IF v_cleaned <> 1
  THEN RAISE EXCEPTION USING ERRCODE = 'P1114', MESSAGE = 'cleanup cap ignored'; END IF;
  SELECT count(*) INTO v_count FROM public.get_mcp_guest_cart(
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  IF v_count <> 1
  THEN RAISE EXCEPTION USING ERRCODE = 'P1115', MESSAGE = 'cleanup took a live row'; END IF;
  SELECT public.cleanup_mcp_guest_carts(1000) INTO v_cleaned;
  IF v_cleaned <> 1
  THEN RAISE EXCEPTION USING ERRCODE = 'P1116', MESSAGE = 'cleanup residue remains'; END IF;


  -- The store caps carts at 20 lines: the 21st is rejected, the 20th kept.
  BEGIN
    PERFORM public.upsert_mcp_guest_cart(
      '1212121212121212121212121212121212121212121212121212121212121212',
      (SELECT jsonb_agg(jsonb_build_object('n', g)) FROM generate_series(1, 21) g),
      pg_catalog.now() + interval '7 days', NULL);
    RAISE EXCEPTION USING ERRCODE = 'P1122', MESSAGE = 'oversized cart accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
  END;
  SELECT outcome INTO v_outcome
  FROM public.upsert_mcp_guest_cart(
    '1313131313131313131313131313131313131313131313131313131313131313',
    (SELECT jsonb_agg(jsonb_build_object(
      'product_id', '11111111-1111-4111-8111-' || lpad(g::text, 12, '0'),
      'quantity', 1))
     FROM generate_series(1, 20) g),
    pg_catalog.now() + interval '7 days', NULL);
  IF v_outcome <> 'ok'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1123', MESSAGE = '20-line cart rejected'; END IF;

  -- Retention is bounded: far-future expiry is rejected.
  BEGIN
    PERFORM public.upsert_mcp_guest_cart(
      '1414141414141414141414141414141414141414141414141414141414141414',
      '[]', pg_catalog.now() + interval '30 days', NULL);
    RAISE EXCEPTION USING ERRCODE = 'P1124', MESSAGE = 'far-future expiry accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
  END;

  -- A NULL expected version deletes unconditionally for corrupt rows.
  SELECT public.delete_mcp_guest_cart(
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', NULL)
  INTO v_deleted;
  IF v_deleted IS NOT TRUE
  THEN RAISE EXCEPTION USING ERRCODE = 'P1126', MESSAGE = 'unconditional delete failed'; END IF;

  -- Line shape is enforced database-side: a missing or non-UUID
  -- product_id, a non-integer or out-of-range quantity, and a
  -- non-object element are all rejected before the size check.
  FOR bad_items IN
    SELECT * FROM (VALUES
      ('[{"quantity":1}]'),
      ('[{"product_id":"not-a-uuid","quantity":1}]'),
      ('[{"product_id":"11111111-1111-4111-8111-111111111111","quantity":0}]'),
      ('[{"product_id":"11111111-1111-4111-8111-111111111111","quantity":11}]'),
      ('[{"product_id":"11111111-1111-4111-8111-111111111111","quantity":"many"}]'),
      ('[42]')
    ) AS cases(items)
  LOOP
    BEGIN
      PERFORM public.upsert_mcp_guest_cart(
        '1717171717171717171717171717171717171717171717171717171717171717',
        bad_items.items::jsonb, pg_catalog.now() + interval '7 days', NULL);
      RAISE EXCEPTION USING ERRCODE = 'P1130', MESSAGE = 'invalid line shape accepted';
    EXCEPTION WHEN invalid_parameter_value THEN
    END;
  END LOOP;

  -- The payload byte ceiling backstops junk keys the shape allows: one
  -- valid-shaped line carrying 9 KiB of notes exceeds the 8 KiB budget.
  BEGIN
    PERFORM public.upsert_mcp_guest_cart(
      '1818181818181818181818181818181818181818181818181818181818181818',
      jsonb_build_array(jsonb_build_object(
        'product_id', '11111111-1111-4111-8111-111111111111',
        'quantity', 1,
        'note', repeat('x', 9000))),
      pg_catalog.now() + interval '7 days', NULL);
    RAISE EXCEPTION USING ERRCODE = 'P1131', MESSAGE = 'oversized payload accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
  END;

END $$;
ROLLBACK;
