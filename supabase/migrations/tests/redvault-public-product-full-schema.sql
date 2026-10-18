UPDATE public.products SET taxable=true,vat_rate=7.5,vat_category_code='S',inventory_tracking_policy='off',has_variants=false
WHERE id=(SELECT product_id FROM redvault_private_pilot_case);
UPDATE redvault_private_pilot_case SET
  order_input=jsonb_set(jsonb_set(order_input,'{tax_amount}','7.5'),'{expected_total}','102.5'),
  quote=jsonb_set(jsonb_set(quote,'{lines,0,vatRateBp}','750'),'{groups,0,vatRateBp}','750');
SELECT private.configure_uba_redvault_public_product_test(true,(SELECT product_id FROM redvault_private_pilot_case));
CREATE TEMP TABLE public_test_orders(actor text,order_id uuid,attempt_id uuid) ON COMMIT DROP;
GRANT SELECT,INSERT,UPDATE ON public_test_orders TO authenticated;
SELECT pg_catalog.set_config('request.jwt.claims',jsonb_build_object(
  'role','authenticated','storefront_redvault_customer_email','public-guest@example.invalid',
  'storefront_order_context','route','storefront_order_merchant_id','6b5cb8a4-5575-456c-b936-8cdfae30db74'
)::text,true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE fixture redvault_private_pilot_case%ROWTYPE; payload jsonb; created record; reserved record; claimed record; replayed record;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  payload:=fixture.order_input||jsonb_build_object('user_id',NULL,'customer_email','public-guest@example.invalid',
    'checkout_idempotency_key','public-guest-fixture');
  SELECT * INTO STRICT created FROM public.create_storefront_redvault_order(payload,fixture.quote,
    public.redvault_private_pilot_test_route_proof(payload,fixture.quote));
  SELECT * INTO STRICT reserved FROM public.reserve_storefront_redvault_payment_attempt_v3(created.id);
  IF reserved.amount_kobo<>10250 OR reserved.currency<>'NGN' THEN
    RAISE EXCEPTION 'public_guest_wrong_amount';
  END IF;
  SELECT * INTO STRICT replayed FROM public.reserve_storefront_redvault_payment_attempt_v3(created.id);
  IF replayed.attempt_id IS DISTINCT FROM reserved.attempt_id OR replayed.reference IS DISTINCT FROM reserved.reference THEN
    RAISE EXCEPTION 'public_guest_attempt_not_idempotent';
  END IF;
  SELECT * INTO STRICT claimed FROM public.claim_storefront_redvault_payment_attempt_initialization_v3(reserved.attempt_id);
  IF claimed.initialization_claimed IS NOT TRUE THEN RAISE EXCEPTION 'public_guest_claim_failed'; END IF;
  INSERT INTO public_test_orders VALUES ('guest',created.id,reserved.attempt_id);
END;
$$;
RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claims',jsonb_build_object(
  'sub','15151515-1515-4515-8515-151515151515','role','authenticated',
  'storefront_redvault_customer_email','public-signed-in@example.invalid',
  'storefront_order_context','route','storefront_order_merchant_id','6b5cb8a4-5575-456c-b936-8cdfae30db74'
)::text,true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE fixture redvault_private_pilot_case%ROWTYPE; payload jsonb; created record; reserved record;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  payload:=fixture.order_input||jsonb_build_object('user_id','15151515-1515-4515-8515-151515151515',
    'customer_email','public-signed-in@example.invalid','checkout_idempotency_key','public-user-fixture');
  SELECT * INTO STRICT created FROM public.create_storefront_redvault_order(payload,fixture.quote,
    public.redvault_private_pilot_test_route_proof(payload,fixture.quote));
  SELECT * INTO STRICT reserved FROM public.reserve_storefront_redvault_payment_attempt_v3(created.id);
  IF reserved.amount_kobo<>10250 THEN RAISE EXCEPTION 'public_signed_in_wrong_amount'; END IF;
  INSERT INTO public_test_orders VALUES ('signed-in',created.id,reserved.attempt_id);
END;
$$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(DISTINCT attempt_id) FROM public_test_orders)<>2
    OR EXISTS (SELECT 1 FROM private.uba_redvault_live_pilot_policy WHERE reserved_attempt_id IS NOT NULL) THEN
    RAISE EXCEPTION 'public_test_global_cap_or_identity_restriction';
  END IF;
END $$;
SELECT private.configure_uba_redvault_public_product_test(false,NULL);
SET LOCAL ROLE authenticated;
DO $$
DECLARE caught text;
BEGIN
  BEGIN
    PERFORM public.claim_storefront_redvault_payment_attempt_initialization_v3(
      (SELECT attempt_id FROM public_test_orders WHERE actor='signed-in'));
  EXCEPTION WHEN OTHERS THEN caught:=SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_public_test_disabled' THEN
    RAISE EXCEPTION 'public_disable_before_claim_wrong_result:%',COALESCE(caught,'accepted');
  END IF;
END;
$$;
RESET ROLE;
DO $$
DECLARE target uuid; caught text;
BEGIN
  SELECT order_id INTO STRICT target FROM public_test_orders WHERE actor='guest';
  INSERT INTO private.uba_redvault_write_context VALUES(pg_catalog.txid_current()) ON CONFLICT DO NOTHING;
  BEGIN
    UPDATE public.orders SET shipping_status='shipped' WHERE id=target;
  EXCEPTION WHEN OTHERS THEN caught:=SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_physical_fulfillment_blocked' THEN
    RAISE EXCEPTION 'public_guest_fulfillment_wrong_result:%',COALESCE(caught,'accepted');
  END IF;
  caught:=NULL;
  BEGIN
    UPDATE public.order_items SET fulfillment_data='{"fulfilled_quantity":1}'::jsonb WHERE order_id=target;
  EXCEPTION WHEN OTHERS THEN caught:=SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_order_snapshot_immutable' THEN
    RAISE EXCEPTION 'public_guest_item_fulfillment_wrong_result:%',COALESCE(caught,'accepted');
  END IF;
  DELETE FROM private.uba_redvault_write_context WHERE transaction_id=pg_catalog.txid_current();
END;
$$;
