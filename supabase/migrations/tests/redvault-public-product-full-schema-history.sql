DO $$
DECLARE bound_product uuid; activation_id uuid;
BEGIN
  SELECT product_id,public_product_activation_id INTO STRICT bound_product,activation_id
  FROM private.uba_redvault_live_pilot_policy WHERE singleton;
  IF activation_id IS NULL OR (SELECT count(*) FROM public_test_orders)<>2 THEN
    RAISE EXCEPTION 'public_history_fixture_missing';
  END IF;
  PERFORM private.configure_uba_redvault_public_product_test(true,bound_product);
  IF NOT EXISTS (SELECT 1 FROM private.uba_redvault_live_pilot_policy
    WHERE enabled AND audience='public_product_test' AND expires_at IS NULL
      AND public_product_activation_id=activation_id AND reserved_attempt_id IS NULL) THEN
    RAISE EXCEPTION 'public_history_reenable_failed';
  END IF;
  PERFORM private.configure_uba_redvault_public_product_test(false,NULL);
  BEGIN
    INSERT INTO private.uba_redvault_write_context VALUES(pg_catalog.txid_current()) ON CONFLICT DO NOTHING;
    UPDATE public.orders SET shipping_status='cancelled'
    WHERE id=(SELECT order_id FROM public_test_orders WHERE actor='signed-in');
    PERFORM private.configure_uba_redvault_public_product_test(true,bound_product);
    RAISE SQLSTATE 'ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
END $$;
