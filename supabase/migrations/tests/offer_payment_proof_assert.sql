DO $$
BEGIN
 IF (SELECT inventory_confirmed FROM public.get_guest_payment_reference_snapshot('offer-ref','offer-token')) IS DISTINCT FROM true
  OR (SELECT inventory_confirmed FROM public.get_sessionless_payment_reference_snapshot('offer-ref')) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'cleaned legacy offer must not block either payment proof';
 END IF;
 UPDATE public.order_items SET offer_line=false, product_offer_id='00000000-0000-0000-0000-000000000011', offer_labels_snapshotted=false WHERE id='00000000-0000-0000-0000-000000000009';
 IF (SELECT inventory_confirmed FROM public.get_guest_payment_reference_snapshot('offer-ref','offer-token')) IS DISTINCT FROM true
  OR (SELECT inventory_confirmed FROM public.get_sessionless_payment_reference_snapshot('offer-ref')) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'legacy product offer identity must not block either payment proof';
 END IF;
 UPDATE public.order_items SET product_offer_id=NULL, offer_labels_snapshotted=true WHERE id='00000000-0000-0000-0000-000000000009';
 IF (SELECT inventory_confirmed FROM public.get_guest_payment_reference_snapshot('offer-ref','offer-token')) IS DISTINCT FROM true
  OR (SELECT inventory_confirmed FROM public.get_sessionless_payment_reference_snapshot('offer-ref')) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'deleted offer snapshot must not block either payment proof';
 END IF;
 IF (SELECT inventory_confirmed FROM public.get_guest_payment_reference_snapshot('plain-ref','plain-token')) IS DISTINCT FROM false
  OR (SELECT inventory_confirmed FROM public.get_sessionless_payment_reference_snapshot('plain-ref')) IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'plain strict item without durable inventory must still block payment proof';
 END IF;
 INSERT INTO public.variant_inventory VALUES ('00000000-0000-0000-0000-000000000010','reserved',now()+interval '1 hour');
 IF (SELECT inventory_confirmed FROM public.get_guest_payment_reference_snapshot('plain-ref','plain-token')) IS DISTINCT FROM false
  OR (SELECT inventory_confirmed FROM public.get_sessionless_payment_reference_snapshot('plain-ref')) IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'an expiring plain reservation must still block payment proof';
 END IF;
 UPDATE public.variant_inventory SET reservation_expires_at=NULL WHERE order_item_id='00000000-0000-0000-0000-000000000010';
 IF (SELECT inventory_confirmed FROM public.get_guest_payment_reference_snapshot('plain-ref','plain-token')) IS DISTINCT FROM true
  OR (SELECT inventory_confirmed FROM public.get_sessionless_payment_reference_snapshot('plain-ref')) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'a durable plain reservation must satisfy payment proof';
 END IF;
 IF EXISTS (SELECT 1 FROM public.get_guest_payment_reference_snapshot('offer-ref','wrong-token')) THEN
  RAISE EXCEPTION 'invalid guest token disclosed payment';
 END IF;
 PERFORM set_config('test.user_id','00000000-0000-0000-0000-000000000099',false);
 IF EXISTS (SELECT 1 FROM public.get_sessionless_payment_reference_snapshot('offer-ref')) THEN
  RAISE EXCEPTION 'another customer obtained payment proof';
 END IF;
END $$;
