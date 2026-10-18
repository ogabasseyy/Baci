INSERT INTO public.products VALUES (
  'f6f4261f-8cc8-42c4-941c-e8d3483c6628',
  '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'UBA Test', NULL, 'active', 100, false, 'off'
);
SELECT private.configure_uba_redvault_public_product_test(true,'f6f4261f-8cc8-42c4-941c-e8d3483c6628');
INSERT INTO public.product_variants(id,product_id,is_inventory_anchor)
VALUES ('99999999-9999-4999-8999-999999999999','f6f4261f-8cc8-42c4-941c-e8d3483c6628',true);
SELECT private.configure_uba_redvault_public_product_test(true,'f6f4261f-8cc8-42c4-941c-e8d3483c6628');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.uba_redvault_live_pilot_policy
    WHERE enabled AND audience='public_product_test' AND expires_at IS NULL) THEN
    RAISE EXCEPTION 'public_policy_not_enabled';
  END IF;
  IF has_function_privilege('authenticated', 'private.configure_uba_redvault_public_product_test(boolean,uuid)','EXECUTE')
    OR has_function_privilege('anon','private.assert_uba_redvault_public_product_test_order(uuid,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'public_policy_grants_leaked';
  END IF;
  IF NOT has_function_privilege('anon','public.get_storefront_redvault_live_pilot_policy()','EXECUTE')
    OR has_function_privilege('service_role','public.get_storefront_redvault_live_pilot_policy()','EXECUTE') THEN
    RAISE EXCEPTION 'public_policy_projection_grants_invalid';
  END IF;
END $$;
SET ROLE anon;
SELECT enabled,audience,product_id FROM public.get_storefront_redvault_live_pilot_policy();
RESET ROLE;
INSERT INTO public.orders(id,merchant_id,currency,payment_method,subtotal,discount_amount,total)
SELECT ('00000000-0000-4000-8000-'||lpad(sequence::text,12,'0'))::uuid,
  '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'NGN', 'uba_redvault',100,5,95
FROM generate_series(1,3) sequence;
INSERT INTO public.orders(id,merchant_id,currency,payment_method,subtotal,discount_amount,tax_amount,total)
VALUES ('00000000-0000-4000-8000-000000000004','6b5cb8a4-5575-456c-b936-8cdfae30db74',
  'NGN','uba_redvault',100,5,7.50,102.50);
INSERT INTO public.order_items(order_id,product_id,quantity,price)
SELECT id,'f6f4261f-8cc8-42c4-941c-e8d3483c6628',1,100 FROM public.orders;
INSERT INTO private.uba_redvault_applications(id,order_id,merchant_id,user_id,discount_kobo,eligible_subtotal_kobo)
SELECT id,id,merchant_id,CASE WHEN id::text LIKE '%001' THEN NULL ELSE '15151515-1515-4515-8515-151515151515'::uuid END,500,10000
FROM public.orders;
INSERT INTO private.uba_redvault_payment_attempts(id,order_id,application_id,merchant_id,amount_kobo,currency)
SELECT id,id,id,merchant_id,round(total*100)::bigint,'NGN' FROM public.orders;
INSERT INTO private.uba_redvault_line_allocations
SELECT id,'f6f4261f-8cc8-42c4-941c-e8d3483c6628' FROM private.uba_redvault_applications;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM private.uba_redvault_live_pilot_policy WHERE reserved_attempt_id IS NOT NULL) THEN
    RAISE EXCEPTION 'public_mode_consumed_global_attempt';
  END IF;
END $$;
SELECT private.assert_uba_redvault_private_pilot_active('00000000-0000-4000-8000-000000000001');
SELECT private.assert_uba_redvault_private_pilot_active('00000000-0000-4000-8000-000000000004');
DO $$
DECLARE mutation text; rejected boolean;
BEGIN
  FOREACH mutation IN ARRAY ARRAY[
    'UPDATE public.orders SET currency=''USD''',
    'UPDATE public.orders SET merchant_id=''11111111-1111-4111-8111-111111111111''',
    'UPDATE public.orders SET discount_amount=4',
    'UPDATE public.orders SET tax_amount=7.50',
    'UPDATE public.orders SET shipping_fee=1',
    'UPDATE public.orders SET wallet_amount_used=1',
    'UPDATE public.orders SET gift_wrapping_fee=1',
    'UPDATE public.orders SET payment_method=''paystack''',
    'UPDATE public.orders SET tracking_number=''not-allowed''',
    'UPDATE public.products SET status=''archived''',
    'UPDATE public.products SET has_variants=true',
    'UPDATE public.products SET price=99',
    'UPDATE public.products SET brand=''Vivo''',
    'UPDATE public.product_variants SET is_inventory_anchor=false',
    'UPDATE public.order_items SET quantity=2',
    'UPDATE public.order_items SET assurance_fee=1',
    'UPDATE public.order_items SET variant_id=''11111111-1111-4111-8111-111111111111'''
  ] LOOP
    BEGIN
      EXECUTE mutation;
      rejected:=false;
      BEGIN
        PERFORM private.assert_uba_redvault_private_pilot_active('00000000-0000-4000-8000-000000000001');
      EXCEPTION WHEN raise_exception THEN rejected:=true;
      END;
      IF NOT rejected THEN RAISE EXCEPTION 'unsafe_public_test_mutation_accepted:%',mutation; END IF;
      RAISE SQLSTATE 'ZX001';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
    END;
  END LOOP;
END $$;
DO $$
DECLARE rejected boolean := false;
BEGIN
  UPDATE public.orders SET total=94 WHERE id='00000000-0000-4000-8000-000000000001';
  BEGIN
    PERFORM private.assert_uba_redvault_private_pilot_active('00000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN raise_exception THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'tampered_total_accepted'; END IF;
  UPDATE public.orders SET total=95 WHERE id='00000000-0000-4000-8000-000000000001';
END $$;
DO $$ DECLARE rejected boolean:=false; BEGIN
  BEGIN
    INSERT INTO public.shipments(order_id) VALUES ('00000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN raise_exception THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'enabled_public_test_shipment_accepted'; END IF;
END $$;
SELECT private.configure_uba_redvault_public_product_test(false,NULL);
DO $$
DECLARE rejected boolean := false;
BEGIN
  BEGIN
    PERFORM private.assert_uba_redvault_private_pilot_active('00000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN raise_exception THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'disabled_public_test_accepted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.uba_redvault_live_pilot_policy WHERE product_id IS NOT NULL) THEN
    RAISE EXCEPTION 'disabled_product_binding_lost';
  END IF;
END $$;
DO $$
DECLARE rejected boolean:=false;
BEGIN
  BEGIN
    INSERT INTO public.shipments(order_id) VALUES ('00000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN raise_exception THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'disabled_public_test_shipment_accepted'; END IF;
END $$;
