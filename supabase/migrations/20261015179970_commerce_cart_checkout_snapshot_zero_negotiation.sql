-- Permit accepted zero-price (free / fully discounted) negotiations in
-- checkout snapshots, matching commerce_cart_assemble_state and the
-- client pricing contract. Auto-acceptance in commerce_cart_negotiation_status
-- still requires a positive price within the 2% band, so shopper-submitted
-- zero proposals stay pending and price at catalog, while an accepted
-- zero-price negotiation remains free when checkout is prepared and bound.
DO $repair$
DECLARE
  definition text;
  old text;
  replacement text;
BEGIN
  definition := pg_get_functiondef('public.commerce_cart_build_checkout_snapshot(uuid,uuid)'::regprocedure);
  old := $old$          OR negotiated <= 0
          OR negotiated >= catalog_minor
          OR NOT public.commerce_cart_product_negotiable(p_merchant_id,product_id) OR (catalog_minor-negotiated)::numeric*100>catalog_minor::numeric*2$old$;
  replacement := $new$          OR negotiated < 0
          OR negotiated >= catalog_minor
          OR NOT public.commerce_cart_product_negotiable(p_merchant_id,product_id) OR (negotiated > 0 AND (catalog_minor-negotiated)::numeric*100>catalog_minor::numeric*2)$new$;
  IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'checkout snapshot zero negotiation source mismatch';
  END IF;
  definition := replace(definition, old, replacement);
  EXECUTE definition;
END
$repair$;
