DO $$
DECLARE mutation text; caught text; bound_product uuid;
BEGIN
  SELECT product_id INTO STRICT bound_product FROM private.uba_redvault_live_pilot_policy WHERE singleton;
  FOREACH mutation IN ARRAY ARRAY[
    'UPDATE private.uba_redvault_live_pilot_policy SET audience=''private_user''',
    'UPDATE private.uba_redvault_live_pilot_policy SET public_product_activation_id=NULL',
    'DELETE FROM private.uba_redvault_applications',
    'DELETE FROM private.uba_redvault_line_allocations',
    'UPDATE private.uba_redvault_line_allocations SET order_item_id=''11111111-1111-4111-8111-111111111111''',
    'UPDATE private.uba_redvault_line_allocations SET order_item_id=(SELECT id FROM public.order_items ORDER BY id LIMIT 1)',
    'UPDATE private.uba_redvault_line_allocations SET application_id=(SELECT id FROM private.uba_redvault_applications ORDER BY id LIMIT 1)',
    'UPDATE private.uba_redvault_line_allocations SET product_id=''11111111-1111-4111-8111-111111111111''',
    'UPDATE private.uba_redvault_line_allocations SET allocation_kobo=499',
    'UPDATE private.uba_redvault_line_allocations SET unit_price_kobo=9999',
    'UPDATE private.uba_redvault_line_allocations SET unit_ordinal=2',
    'INSERT INTO private.uba_redvault_line_allocations SELECT * FROM private.uba_redvault_line_allocations LIMIT 1',
    'INSERT INTO public.order_items(order_id,product_id,quantity,price) SELECT order_id,product_id,1,100 FROM public.order_items LIMIT 1',
    'UPDATE private.uba_redvault_applications SET discount_kobo=499',
    'UPDATE private.uba_redvault_applications SET eligible_subtotal_kobo=9999',
    'UPDATE private.uba_redvault_applications SET merchant_id=''11111111-1111-4111-8111-111111111111''',
    'UPDATE public.orders SET currency=''USD''',
    'UPDATE public.orders SET merchant_id=''11111111-1111-4111-8111-111111111111''',
    'UPDATE public.orders SET shipping_fee=1',
    'UPDATE public.orders SET shipping_status=''shipped''',
    'UPDATE public.orders SET total=94',
    'UPDATE public.order_items SET quantity=2'
  ] LOOP
    BEGIN
      EXECUTE mutation;
      caught:=NULL;
      BEGIN
        PERFORM private.configure_uba_redvault_public_product_test(true,bound_product);
      EXCEPTION WHEN raise_exception THEN caught:=SQLERRM;
      END;
      IF caught IS DISTINCT FROM 'redvault_public_test_history_invalid' THEN
        RAISE EXCEPTION 'unsafe_history_accepted:%:%',mutation,COALESCE(caught,'accepted');
      END IF;
      RAISE SQLSTATE 'ZX001';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
    END;
  END LOOP;
  PERFORM private.configure_uba_redvault_public_product_test(true,bound_product);
  PERFORM private.configure_uba_redvault_public_product_test(false,NULL);
  BEGIN
    UPDATE public.orders SET payment_status='refunded',shipping_status='cancelled';
    PERFORM private.configure_uba_redvault_public_product_test(true,bound_product);
    RAISE SQLSTATE 'ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
END $$;
