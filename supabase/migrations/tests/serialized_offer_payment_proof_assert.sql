-- Protocol-marked offers require durable serialized inventory proof.
DO $$ BEGIN
 IF (SELECT inventory_confirmed FROM public.get_guest_payment_reference_snapshot('offer-ref','offer-token')) IS DISTINCT FROM true
 OR (SELECT inventory_confirmed FROM public.get_sessionless_payment_reference_snapshot('offer-ref')) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'unmarked legacy offer should retain quantity-managed proof';
 END IF;
END $$;
INSERT INTO private.serialized_offer_order_items VALUES (
 '00000000-0000-0000-0000-000000000009',
 '00000000-0000-0000-0000-000000000004',
 '00000000-0000-0000-0000-000000000011'
);
DO $$ BEGIN
 IF (SELECT inventory_confirmed FROM public.get_guest_payment_reference_snapshot('offer-ref','offer-token')) IS DISTINCT FROM false
 OR (SELECT inventory_confirmed FROM public.get_sessionless_payment_reference_snapshot('offer-ref')) IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'serialized offer without a durable unit must not satisfy payment proof';
 END IF;
 UPDATE private.serialized_offer_order_items SET merchant_id='00000000-0000-0000-0000-000000000099';
 IF (SELECT inventory_confirmed FROM public.get_guest_payment_reference_snapshot('offer-ref','offer-token')) IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'mismatched marker must not bypass serialized proof';
 END IF;
 INSERT INTO public.variant_inventory (order_item_id,status,reservation_expires_at,condition_offer_id,merchant_id,order_id) VALUES ('00000000-0000-0000-0000-000000000009','reserved',now()+interval '1 hour','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003');
 IF (SELECT inventory_confirmed FROM public.get_guest_payment_reference_snapshot('offer-ref','offer-token')) IS DISTINCT FROM false
 OR (SELECT inventory_confirmed FROM public.get_sessionless_payment_reference_snapshot('offer-ref')) IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'expiring serialized offer reservation must not satisfy payment proof';
 END IF;
 UPDATE public.variant_inventory SET reservation_expires_at=NULL WHERE order_item_id='00000000-0000-0000-0000-000000000009';
 IF (SELECT inventory_confirmed FROM public.get_guest_payment_reference_snapshot('offer-ref','offer-token')) IS DISTINCT FROM false
 OR (SELECT inventory_confirmed FROM public.get_sessionless_payment_reference_snapshot('offer-ref')) IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'mismatched marker must not satisfy proof even with a durable unit';
 END IF;
 UPDATE private.serialized_offer_order_items SET merchant_id='00000000-0000-0000-0000-000000000004';
 UPDATE public.variant_inventory SET condition_offer_id='00000000-0000-0000-0000-000000000099';
 IF (SELECT inventory_confirmed FROM public.get_guest_payment_reference_snapshot('offer-ref','offer-token')) IS DISTINCT FROM false
 OR (SELECT inventory_confirmed FROM public.get_sessionless_payment_reference_snapshot('offer-ref')) IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'unit from a different offer must not satisfy payment proof';
 END IF;
 UPDATE public.variant_inventory SET condition_offer_id='00000000-0000-0000-0000-000000000011';
 UPDATE public.order_items SET offer_id='00000000-0000-0000-0000-000000000099' WHERE id='00000000-0000-0000-0000-000000000009';
 IF (SELECT inventory_confirmed FROM public.get_guest_payment_reference_snapshot('offer-ref','offer-token')) IS DISTINCT FROM false
 OR (SELECT inventory_confirmed FROM public.get_sessionless_payment_reference_snapshot('offer-ref')) IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'conflicting line offer identities must not satisfy payment proof';
 END IF;
 UPDATE public.order_items SET offer_id=NULL WHERE id='00000000-0000-0000-0000-000000000009';
 UPDATE public.variant_inventory SET order_id='00000000-0000-0000-0000-000000000099';
 IF (SELECT inventory_confirmed FROM public.get_guest_payment_reference_snapshot('offer-ref','offer-token')) IS DISTINCT FROM false
 OR (SELECT inventory_confirmed FROM public.get_sessionless_payment_reference_snapshot('offer-ref')) IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'unit attached to a different order must not satisfy payment proof';
 END IF;
 UPDATE public.variant_inventory SET order_id='00000000-0000-0000-0000-000000000003';
 UPDATE public.variant_inventory SET merchant_id='00000000-0000-0000-0000-000000000099';
 IF (SELECT inventory_confirmed FROM public.get_guest_payment_reference_snapshot('offer-ref','offer-token')) IS DISTINCT FROM false
 OR (SELECT inventory_confirmed FROM public.get_sessionless_payment_reference_snapshot('offer-ref')) IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'unit from another merchant must not satisfy payment proof';
 END IF;
 UPDATE public.variant_inventory SET merchant_id='00000000-0000-0000-0000-000000000004';
 IF (SELECT inventory_confirmed FROM public.get_guest_payment_reference_snapshot('offer-ref','offer-token')) IS DISTINCT FROM true
 OR (SELECT inventory_confirmed FROM public.get_sessionless_payment_reference_snapshot('offer-ref')) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'serialized offer with a durable unit must satisfy payment proof';
 END IF;
 -- Sold inventory remains durable, but ownership still gates the read.
 UPDATE public.variant_inventory SET status='sold' WHERE order_item_id='00000000-0000-0000-0000-000000000009';
 IF (SELECT inventory_confirmed FROM public.get_guest_payment_reference_snapshot('offer-ref','offer-token')) IS DISTINCT FROM true
 OR (SELECT inventory_confirmed FROM public.get_sessionless_payment_reference_snapshot('offer-ref')) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'sold serialized offer unit must satisfy payment proof';
 END IF;
 PERFORM set_config('test.user_id','00000000-0000-0000-0000-000000000099',true);
 IF EXISTS (SELECT 1 FROM public.get_sessionless_payment_reference_snapshot('offer-ref')) THEN
  RAISE EXCEPTION 'another buyer must not see serialized offer payment proof';
 END IF;
 PERFORM set_config('test.user_id','00000000-0000-0000-0000-000000000002',true);
 -- A condition-only order can lose its live offer FK after catalog deletion;
 -- its private marker and attached unit retain the purchased identity.
 UPDATE public.order_items SET product_offer_id=NULL WHERE id='00000000-0000-0000-0000-000000000009';
 IF (SELECT inventory_confirmed FROM public.get_guest_payment_reference_snapshot('offer-ref','offer-token')) IS DISTINCT FROM true
 OR (SELECT inventory_confirmed FROM public.get_sessionless_payment_reference_snapshot('offer-ref')) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'deleted condition-only offer must retain durable payment proof';
 END IF;
END $$;
