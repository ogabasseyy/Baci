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

-- A sale and cancellation can race on the same multi-product order. Both
-- paths must serialize on the parent order instead of acquiring product rows
-- in opposing orders and deadlocking through the stock-sync trigger.
SELECT dblink_connect('serialized_cross_release', :'DATABASE_URL');
SELECT dblink_connect('serialized_cross_sale', :'DATABASE_URL');
SELECT dblink_exec('serialized_cross_release', $$SET statement_timeout = '5000ms'$$);
SELECT dblink_exec('serialized_cross_sale', $$SET statement_timeout = '5000ms'$$);
SELECT dblink_send_query(
  'serialized_cross_release',
  $$SELECT private.try_release(
      '00000000-0000-4000-8000-00000000f301'::uuid,
      '00000000-0000-4000-8000-00000000f342'::uuid
    )$$
);
SELECT dblink_send_query(
  'serialized_cross_sale',
  $$SELECT public.mark_order_inventory_units_sold(
      '00000000-0000-4000-8000-00000000f301'::uuid,
      '00000000-0000-4000-8000-00000000f342'::uuid
    )$$
);

DO $$
DECLARE
  v_release_result text;
  v_sale_result jsonb;
  v_reserved integer;
BEGIN
  SELECT result.value INTO v_release_result
  FROM dblink_get_result('serialized_cross_release') AS result(value text);
  SELECT result.value::jsonb INTO v_sale_result
  FROM dblink_get_result('serialized_cross_sale') AS result(value text);
  IF v_release_result <> 'succeeded'
     OR COALESCE((v_sale_result->>'success')::boolean, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'serialized sale/release race failed: %, %', v_release_result, v_sale_result;
  END IF;

  SELECT count(*) INTO v_reserved
  FROM public.variant_inventory
  WHERE order_id = '00000000-0000-4000-8000-00000000f342'::uuid
    AND status = 'reserved';
  IF v_reserved <> 0 THEN
    RAISE EXCEPTION 'serialized sale/release race left % reserved units', v_reserved;
  END IF;
END;
$$;

SELECT dblink_disconnect('serialized_cross_release');
SELECT dblink_disconnect('serialized_cross_sale');

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
  IF COALESCE((v_result_a->>'missingUnitCount')::integer, 0)
       + COALESCE((v_result_b->>'missingUnitCount')::integer, 0) <> 1 THEN
    RAISE EXCEPTION 'serialized confirmation race reported invalid missing-unit count: %, %', v_result_a, v_result_b;
  END IF;
  IF COALESCE(jsonb_array_length(v_result_a->'exceptionCodes'), 0)
     + COALESCE(jsonb_array_length(v_result_b->'exceptionCodes'), 0) <> 1
     OR NOT (
       COALESCE(
         (v_result_a->'exceptionCodes') @> '[{"code":"late_payment_reservation_lost"}]'::jsonb,
         false
       )
       OR COALESCE(
         (v_result_b->'exceptionCodes') @> '[{"code":"late_payment_reservation_lost"}]'::jsonb,
         false
       )
     ) THEN
    RAISE EXCEPTION 'serialized confirmation race reported invalid payment-loss exceptions: %, %', v_result_a, v_result_b;
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
