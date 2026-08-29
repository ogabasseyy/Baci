-- Execute the production release function in two independent PostgreSQL
-- sessions. The fixture rows are intentionally interleaved by product, so an
-- unordered selector would deadlock through the product-stock trigger.

\set ON_ERROR_STOP on

SELECT dblink_connect('serialized_release_a', :'DATABASE_URL');
SELECT dblink_connect('serialized_release_b', :'DATABASE_URL');
SELECT dblink_exec('serialized_release_a', $$SET statement_timeout = '5000ms'$$);
SELECT dblink_exec('serialized_release_b', $$SET statement_timeout = '5000ms'$$);

SELECT dblink_send_query(
  'serialized_release_a',
  $$SELECT private.try_release(
      '00000000-0000-4000-8000-00000000f201'::uuid,
      '00000000-0000-4000-8000-00000000f202'::uuid
    )$$
);
SELECT dblink_send_query(
  'serialized_release_b',
  $$SELECT private.try_release(
      '00000000-0000-4000-8000-00000000f201'::uuid,
      '00000000-0000-4000-8000-00000000f203'::uuid
    )$$
);

DO $$
DECLARE
  v_result_a text;
  v_result_b text;
BEGIN
  SELECT result.value INTO v_result_a
  FROM dblink_get_result('serialized_release_a') AS result(value text);
  SELECT result.value INTO v_result_b
  FROM dblink_get_result('serialized_release_b') AS result(value text);
  IF v_result_a <> 'succeeded' OR v_result_b <> 'succeeded' THEN
    RAISE EXCEPTION 'serialized release concurrency failed: %, %', v_result_a, v_result_b;
  END IF;
END;
$$;

DO $$
DECLARE
  v_remaining integer;
BEGIN
  SELECT count(*) INTO v_remaining
  FROM public.variant_inventory
  WHERE status = 'reserved'
    AND order_id IN (
      '00000000-0000-4000-8000-00000000f202'::uuid,
      '00000000-0000-4000-8000-00000000f203'::uuid
    );
  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'serialized release left % reserved units', v_remaining;
  END IF;
END;
$$;

SELECT dblink_disconnect('serialized_release_a');
SELECT dblink_disconnect('serialized_release_b');

-- Run two claims for the same variant at once. Each caller must reserve a
-- different available unit while both exact public and private claim paths
-- execute against PostgreSQL.
SELECT dblink_connect('serialized_claim_a', :'DATABASE_URL');
SELECT dblink_connect('serialized_claim_b', :'DATABASE_URL');
SELECT dblink_exec('serialized_claim_a', $$SET statement_timeout = '5000ms'$$);
SELECT dblink_exec('serialized_claim_b', $$SET statement_timeout = '5000ms'$$);
SELECT dblink_send_query(
  'serialized_claim_a',
  $$SELECT public.claim_variant_inventory_units_for_order_item(
      '00000000-0000-4000-8000-00000000f301'::uuid,
      '00000000-0000-4000-8000-00000000f302'::uuid,
      '00000000-0000-4000-8000-00000000f30c'::uuid
    )$$
);
SELECT dblink_send_query(
  'serialized_claim_b',
  $$SELECT public.claim_variant_inventory_units_for_order_item(
      '00000000-0000-4000-8000-00000000f301'::uuid,
      '00000000-0000-4000-8000-00000000f303'::uuid,
      '00000000-0000-4000-8000-00000000f30d'::uuid
    )$$
);

DO $$
DECLARE
  v_result_a jsonb;
  v_result_b jsonb;
  v_reserved integer;
  v_orders integer;
BEGIN
  SELECT result.value::jsonb INTO v_result_a
  FROM dblink_get_result('serialized_claim_a') AS result(value text);
  SELECT result.value::jsonb INTO v_result_b
  FROM dblink_get_result('serialized_claim_b') AS result(value text);
  IF jsonb_typeof(v_result_a) <> 'object' OR jsonb_typeof(v_result_b) <> 'object' THEN
    RAISE EXCEPTION 'serialized claim concurrency returned invalid payloads: %, %', v_result_a, v_result_b;
  END IF;

  SELECT count(*), count(DISTINCT order_item_id)
  INTO v_reserved, v_orders
  FROM public.variant_inventory
  WHERE variant_id = '00000000-0000-4000-8000-00000000f306'::uuid
    AND status = 'reserved';
  IF v_reserved <> 2 OR v_orders <> 2 THEN
    RAISE EXCEPTION 'serialized claim race reserved % units for % order items', v_reserved, v_orders;
  END IF;
END;
$$;

SELECT dblink_disconnect('serialized_claim_a');
SELECT dblink_disconnect('serialized_claim_b');

-- Confirm two paid orders concurrently while only one reclaimable unit exists.
-- The exact confirmation paths must serialize the unit transition and report
-- the second order's missing unit rather than reserving the same row twice.
SELECT dblink_connect('serialized_confirm_a', :'DATABASE_URL');
SELECT dblink_connect('serialized_confirm_b', :'DATABASE_URL');
SELECT dblink_exec('serialized_confirm_a', $$SET statement_timeout = '5000ms'$$);
SELECT dblink_exec('serialized_confirm_b', $$SET statement_timeout = '5000ms'$$);
SELECT dblink_send_query(
  'serialized_confirm_a',
  $$SELECT public.confirm_order_inventory_reservations(
      '00000000-0000-4000-8000-00000000f301'::uuid,
      '00000000-0000-4000-8000-00000000f312'::uuid
    )$$
);
SELECT dblink_send_query(
  'serialized_confirm_b',
  $$SELECT public.confirm_order_inventory_reservations(
      '00000000-0000-4000-8000-00000000f301'::uuid,
      '00000000-0000-4000-8000-00000000f313'::uuid
    )$$
);

DO $$
DECLARE
  v_result_a jsonb;
  v_result_b jsonb;
  v_reserved integer;
  v_orders integer;
BEGIN
  SELECT result.value::jsonb INTO v_result_a
  FROM dblink_get_result('serialized_confirm_a') AS result(value text);
  SELECT result.value::jsonb INTO v_result_b
  FROM dblink_get_result('serialized_confirm_b') AS result(value text);
  IF jsonb_typeof(v_result_a) <> 'object' OR jsonb_typeof(v_result_b) <> 'object' THEN
    RAISE EXCEPTION 'serialized confirmation concurrency returned invalid payloads: %, %', v_result_a, v_result_b;
  END IF;
  IF COALESCE((v_result_a->>'reclaimedUnitCount')::integer, 0)
       + COALESCE((v_result_b->>'reclaimedUnitCount')::integer, 0) <> 1 THEN
    RAISE EXCEPTION 'serialized confirmation race reclaimed duplicate units: %, %', v_result_a, v_result_b;
  END IF;

  SELECT count(*), count(DISTINCT order_id)
  INTO v_reserved, v_orders
  FROM public.variant_inventory
  WHERE variant_id = '00000000-0000-4000-8000-00000000f316'::uuid
    AND status = 'reserved'
    AND order_id IN (
      '00000000-0000-4000-8000-00000000f312'::uuid,
      '00000000-0000-4000-8000-00000000f313'::uuid
    );
  IF v_reserved <> 1 OR v_orders <> 1 THEN
    RAISE EXCEPTION 'serialized confirmation race reserved % units for % orders', v_reserved, v_orders;
  END IF;
END;
$$;

SELECT dblink_disconnect('serialized_confirm_a');
SELECT dblink_disconnect('serialized_confirm_b');

-- A sale can commit after confirmation has read the reserved-unit snapshot but
-- before that snapshot is cleared. The confirmation update must re-check the
-- reserved status while taking the row lock, otherwise it reports a sold unit
-- as newly confirmed and clears its sale-owned reservation metadata.
SELECT dblink_connect('serialized_sale_holder', :'DATABASE_URL');
SELECT dblink_connect('serialized_confirm_sale', :'DATABASE_URL');
SELECT dblink_exec('serialized_sale_holder', $$SET statement_timeout = '5000ms'$$);
SELECT dblink_exec('serialized_confirm_sale', $$SET statement_timeout = '5000ms'$$);
SELECT dblink_exec('serialized_confirm_sale', $$SET application_name = 'serialized_confirm_sale'$$);
SELECT dblink_exec(
  'serialized_sale_holder',
  $$BEGIN$$
);
SELECT dblink_exec(
  'serialized_sale_holder',
  $$UPDATE public.variant_inventory
    SET status = 'sold', sold_at = clock_timestamp()
    WHERE id = '00000000-0000-4000-8000-00000000f328'::uuid
      AND status = 'reserved'$$
);
SELECT dblink_send_query(
  'serialized_confirm_sale',
  $$SELECT public.confirm_order_inventory_reservations(
      '00000000-0000-4000-8000-00000000f301'::uuid,
      '00000000-0000-4000-8000-00000000f322'::uuid
    )$$
);

DO $$
DECLARE
  v_waiting boolean := false;
  v_attempt integer := 0;
BEGIN
  WHILE v_attempt < 100 AND NOT v_waiting LOOP
    SELECT EXISTS (
      SELECT 1
      FROM pg_stat_activity
      WHERE application_name = 'serialized_confirm_sale'
        AND wait_event_type = 'Lock'
        AND query ILIKE '%confirm_order_inventory_reservations%'
    ) INTO v_waiting;
    IF NOT v_waiting THEN
      PERFORM pg_sleep(0.05);
      v_attempt := v_attempt + 1;
    END IF;
  END LOOP;
  IF NOT v_waiting THEN
    RAISE EXCEPTION 'serialized confirmation sale race did not reach the row lock';
  END IF;
END;
$$;

SELECT dblink_exec('serialized_sale_holder', $$COMMIT$$);

DO $$
DECLARE
  v_result jsonb;
  v_status text;
  v_expires_at timestamptz;
BEGIN
  SELECT result.value::jsonb INTO v_result
  FROM dblink_get_result('serialized_confirm_sale') AS result(value text);
  SELECT status, reservation_expires_at
  INTO v_status, v_expires_at
  FROM public.variant_inventory
  WHERE id = '00000000-0000-4000-8000-00000000f328'::uuid;
  IF v_status <> 'sold' OR v_expires_at IS NULL THEN
    RAISE EXCEPTION 'serialized confirmation sale race changed sale-owned unit: %, %', v_status, v_expires_at;
  END IF;
  IF COALESCE((v_result->>'confirmedUnitCount')::integer, 0) <> 0 THEN
    RAISE EXCEPTION 'serialized confirmation sale race falsely confirmed sold unit: %', v_result;
  END IF;
END;
$$;

SELECT dblink_disconnect('serialized_sale_holder');
SELECT dblink_disconnect('serialized_confirm_sale');
