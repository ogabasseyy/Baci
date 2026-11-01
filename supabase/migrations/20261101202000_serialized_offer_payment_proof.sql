-- Legacy offer lines need no serial proof. Protocol-marked offer lines do.
DO $$
DECLARE
 signature text;
 definition text;
 legacy_filter text := $old$              AND oi.offer_line IS DISTINCT FROM TRUE
              AND oi.product_offer_id IS NULL
              AND oi.offer_labels_snapshotted IS DISTINCT FROM TRUE$old$;
 replacement text := $new$              AND (
                (oi.offer_line IS DISTINCT FROM TRUE
                 AND oi.product_offer_id IS NULL
                 AND oi.offer_labels_snapshotted IS DISTINCT FROM TRUE)
                OR EXISTS (
                  SELECT 1 FROM private.serialized_offer_order_items marker
                  WHERE marker.order_item_id = oi.id
                )
              )$new$;
 proof_old text := $old$              AND (
                (SELECT count(*)::integer$old$;
 proof_new text := $new$              AND (
                EXISTS (
                  SELECT 1 FROM private.serialized_offer_order_items marker
                  WHERE marker.order_item_id = oi.id AND (
                    marker.merchant_id IS DISTINCT FROM o.merchant_id
                    OR (oi.product_offer_id IS NOT NULL AND oi.product_offer_id IS DISTINCT FROM marker.offer_id)
                    OR (oi.offer_id IS NOT NULL AND oi.offer_id IS DISTINCT FROM marker.offer_id)
                    OR (oi.offer_id_snapshot IS NOT NULL AND oi.offer_id_snapshot IS DISTINCT FROM marker.offer_id)
                    OR EXISTS (SELECT 1 FROM public.variant_inventory unit
                      WHERE unit.order_item_id = oi.id
                        AND (unit.condition_offer_id IS DISTINCT FROM marker.offer_id
                          OR unit.merchant_id IS DISTINCT FROM o.merchant_id
                          OR unit.order_id IS DISTINCT FROM o.id))
                  )
                ) OR (SELECT count(*)::integer$new$;
 occurrences integer;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.get_guest_payment_reference_snapshot(text,text)',
  'public.get_sessionless_payment_reference_snapshot(text)'
 ] LOOP
  definition := pg_catalog.pg_get_functiondef(signature::regprocedure);
  occurrences := (length(definition)-length(replace(definition,legacy_filter,'')))/length(legacy_filter);
  IF occurrences <> 1 THEN
   RAISE EXCEPTION 'serialized offer payment proof prerequisite mismatch: %', signature;
  END IF;
  definition := replace(definition,legacy_filter,replacement);
  IF (length(definition)-length(replace(definition,proof_old,'')))/length(proof_old) <> 1 THEN
   RAISE EXCEPTION 'serialized offer payment proof predicate mismatch: %', signature;
  END IF;
  EXECUTE replace(definition,proof_old,proof_new);
 END LOOP;
END;
$$;
