DO $$
DECLARE fixture redvault_private_pilot_case%ROWTYPE; created record; caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  BEGIN
    PERFORM private.configure_uba_redvault_live_pilot(true,fixture.product_id,now()+interval '1 hour');
    PERFORM pg_catalog.set_config('request.jwt.claims',jsonb_build_object(
      'sub','70261bce-d358-45a4-9ede-8b9d71fb3bd9','role','authenticated',
      'storefront_redvault_customer_email',fixture.order_input->>'customer_email',
      'storefront_order_context','route','storefront_order_merchant_id','6b5cb8a4-5575-456c-b936-8cdfae30db74'
    )::text,true);
    SET LOCAL ROLE authenticated;
    SELECT * INTO STRICT created FROM public.create_storefront_redvault_order(fixture.order_input,fixture.quote,
      public.redvault_private_pilot_test_route_proof(fixture.order_input,fixture.quote));
    RESET ROLE;
    IF NOT EXISTS (SELECT 1 FROM private.uba_redvault_applications
      WHERE order_id=created.id AND discount_kobo=500 AND eligible_subtotal_kobo=10000) THEN
      RAISE EXCEPTION 'prepublic_history_fixture_application_missing';
    END IF;
    PERFORM private.configure_uba_redvault_live_pilot(false,NULL,NULL);
    BEGIN
      PERFORM private.configure_uba_redvault_public_product_test(true,fixture.product_id);
    EXCEPTION WHEN raise_exception THEN caught:=SQLERRM;
    END;
    IF caught IS DISTINCT FROM 'redvault_public_test_history_invalid' THEN
      RAISE EXCEPTION 'prepublic_ordinary_redvault_history_accepted:%',COALESCE(caught,'accepted');
    END IF;
    RAISE SQLSTATE 'ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
END $$;
