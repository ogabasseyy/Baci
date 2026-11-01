-- Legacy condition offers are fulfilled from offer stock, not serialized
-- inventory; match confirmation's persisted identity in both read proofs.
DO $$
DECLARE
 signature text;
 definition text;
 old text := $old$            WHERE oi.order_id = o.id$old$;
 replacement text := $new$            WHERE oi.order_id = o.id
              AND oi.offer_line IS DISTINCT FROM TRUE
              AND oi.product_offer_id IS NULL
              AND oi.offer_labels_snapshotted IS DISTINCT FROM TRUE$new$;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.get_guest_payment_reference_snapshot(text,text)',
  'public.get_sessionless_payment_reference_snapshot(text)'
 ] LOOP
  definition := pg_catalog.pg_get_functiondef(signature::regprocedure);
  IF (length(definition)-length(replace(definition,old,'')))/length(old) <> 1 THEN
   RAISE EXCEPTION 'legacy offer payment proof source mismatch: %', signature;
  END IF;
  EXECUTE replace(definition,old,replacement);
 END LOOP;
END;
$$;
