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
  WHERE status = 'reserved';
  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'serialized release left % reserved units', v_remaining;
  END IF;
END;
$$;

SELECT dblink_disconnect('serialized_release_a');
SELECT dblink_disconnect('serialized_release_b');
