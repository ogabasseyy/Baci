-- Cart review must use the same per-offer availability authority as the
-- storefront. The order entrypoint gate remains closed in this migration.
CREATE OR REPLACE FUNCTION pg_temp.patch_serialized_offer_cart(old text, replacement text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE definition text := pg_catalog.pg_get_functiondef('public.commerce_cart_build_checkout_snapshot(uuid,uuid)'::regprocedure);
BEGIN
  IF old = '' OR (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'serialized offer cart source mismatch';
  END IF;
  EXECUTE replace(definition, old, replacement);
END;
$$;
SELECT pg_temp.patch_serialized_offer_cart(
  $old$        WHEN offer.id IS NOT NULL THEN greatest(offer.stock_quantity,0)$old$,
  $new$        WHEN offer.id IS NOT NULL THEN greatest(coalesce(offer_resolution.allocatable_stock,0),0)$new$
);
SELECT pg_temp.patch_serialized_offer_cart(
  $old$      CASE WHEN offer.id IS NOT NULL THEN coalesce(p.manage_stock,true) WHEN policy.value='serialized_then_unlimited'$old$,
  $new$      CASE WHEN offer.id IS NOT NULL AND offer_resolution.effective_policy = 'serialized_then_unlimited' AND offer_resolution.allocatable_stock IS NULL THEN false WHEN offer.id IS NOT NULL AND offer_resolution.effective_policy IN ('serialized_strict','serialized_then_unlimited') THEN true WHEN offer.id IS NOT NULL AND offer_resolution.effective_policy IS NULL THEN true WHEN offer.id IS NOT NULL THEN coalesce(p.manage_stock,true) WHEN policy.value='serialized_then_unlimited'$new$
);
SELECT pg_temp.patch_serialized_offer_cart(
  $old$    CROSS JOIN LATERAL (SELECT CASE WHEN to_jsonb(v)->>'inventory_tracking_policy'$old$,
  $new$    LEFT JOIN LATERAL (
      SELECT r.allocatable_stock, r.effective_policy
      FROM public.get_storefront_offer_resolution(p_merchant_id, ARRAY[l.product_id]) AS r
      WHERE r.offer_id = offer.id
    ) offer_resolution ON offer.id IS NOT NULL
    CROSS JOIN LATERAL (SELECT CASE WHEN to_jsonb(v)->>'inventory_tracking_policy'$new$
);
