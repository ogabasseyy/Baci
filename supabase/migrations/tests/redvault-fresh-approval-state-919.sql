DO $$
DECLARE status_value text;
BEGIN
  FOREACH status_value IN ARRAY ARRAY['fulfilled', 'out_for_delivery', 'completed', 'unknown', 'shipped', 'delivered', 'canceled', 'cancelled'] LOOP
    INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current()) ON CONFLICT DO NOTHING;
    UPDATE public.orders SET shipping_status = status_value WHERE id = (SELECT id FROM public.test_result);
    DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current();

    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    SET LOCAL ROLE service_role;
    PERFORM public.test_expect_error(
      format(
        'SELECT public.approve_and_complete_uba_redvault_payment(%L::uuid, %L::uuid, (SELECT evidence FROM public.test_verified_completion_914))',
        '33333333-3333-4333-8333-333333333333',
        (SELECT id::text FROM public.test_result)
      ),
      'redvault_verified_completion_order_state_invalid'
    );
    RESET ROLE;

    INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current()) ON CONFLICT DO NOTHING;
    UPDATE public.orders SET shipping_status = 'pending' WHERE id = (SELECT id FROM public.test_result);
    DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current();
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF (SELECT state FROM private.uba_redvault_payment_attempts LIMIT 1) IS DISTINCT FROM 'captured_held'
    OR (SELECT status FROM private.uba_redvault_applications LIMIT 1) IS DISTINCT FROM 'pending'
    OR (SELECT payment_status FROM public.orders WHERE id = (SELECT id FROM public.test_result)) IS DISTINCT FROM 'unpaid'
    OR (SELECT count(*) FROM private.uba_redvault_redemptions) <> 0 THEN
    RAISE EXCEPTION 'fresh approval state whitelist mutated REDVAULT state';
  END IF;
END;
$$;

SELECT 'REDVAULT 919 fresh approval state whitelist checks passed' AS result;
