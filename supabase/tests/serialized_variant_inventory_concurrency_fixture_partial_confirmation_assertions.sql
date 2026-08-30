-- A partially reserved confirmation must not clear expiry metadata after a
-- concurrent sale changes the reserved unit to sold while confirmation waits.

\set ON_ERROR_STOP on

SELECT dblink_connect('serialized_partial_sale_holder', :'DATABASE_URL');
SELECT dblink_connect('serialized_partial_confirm_sale', :'DATABASE_URL');
SELECT dblink_exec('serialized_partial_sale_holder', $$SET statement_timeout = '5000ms'$$);
SELECT dblink_exec('serialized_partial_confirm_sale', $$SET statement_timeout = '5000ms'$$);
SELECT dblink_exec(
  'serialized_partial_confirm_sale',
  $$SET application_name = 'serialized_partial_confirm_sale'$$
);

SELECT dblink_exec('serialized_partial_sale_holder', $$BEGIN$$);
SELECT dblink_exec(
  'serialized_partial_sale_holder',
  $$UPDATE public.variant_inventory
    SET status = 'sold', sold_at = clock_timestamp()
    WHERE id = '00000000-0000-4000-8000-00000000f338'::uuid
      AND status = 'reserved'$$
);
SELECT dblink_send_query(
  'serialized_partial_confirm_sale',
  $$SELECT public.confirm_order_inventory_reservations(
      '00000000-0000-4000-8000-00000000f301'::uuid,
      '00000000-0000-4000-8000-00000000f332'::uuid
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
      WHERE application_name = 'serialized_partial_confirm_sale'
        AND wait_event_type = 'Lock'
        AND query ILIKE '%confirm_order_inventory_reservations%'
    ) INTO v_waiting;
    IF NOT v_waiting THEN
      PERFORM pg_sleep(0.05);
      v_attempt := v_attempt + 1;
    END IF;
  END LOOP;
  IF NOT v_waiting THEN
    RAISE EXCEPTION 'serialized partial confirmation sale race did not reach the row lock';
  END IF;
END;
$$;

SELECT dblink_exec('serialized_partial_sale_holder', $$COMMIT$$);

DO $$
DECLARE
  v_result jsonb;
  v_status text;
  v_expires_at timestamptz;
BEGIN
  SELECT result.value::jsonb INTO v_result
  FROM dblink_get_result('serialized_partial_confirm_sale') AS result(value text);
  SELECT status, reservation_expires_at
  INTO v_status, v_expires_at
  FROM public.variant_inventory
  WHERE id = '00000000-0000-4000-8000-00000000f338'::uuid;
  IF v_status <> 'sold' OR v_expires_at IS NULL THEN
    RAISE EXCEPTION 'serialized partial confirmation sale race changed sale-owned unit: %, %', v_status, v_expires_at;
  END IF;
  IF COALESCE((v_result->>'confirmedUnitCount')::integer, 0) <> 0
     OR COALESCE((v_result->>'reclaimedUnitCount')::integer, 0) <> 0
     OR COALESCE((v_result->>'missingUnitCount')::integer, 0) <> 1 THEN
    RAISE EXCEPTION 'serialized partial confirmation sale race returned invalid result: %', v_result;
  END IF;
END;
$$;

SELECT dblink_disconnect('serialized_partial_sale_holder');
SELECT dblink_disconnect('serialized_partial_confirm_sale');
