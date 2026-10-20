-- A default SKU is a purchasable variant, not an inventory anchor.
-- product_variants has no is_default column; products.default_variant_id
-- selects a default SKU. Retain the real is_inventory_anchor guards.
DO $repair$
DECLARE
  signature text;
  definition text;
  repaired text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.commerce_cart_require_offer(uuid,uuid,uuid)',
    'public.commerce_cart_build_checkout_snapshot(uuid,uuid)'
  ] LOOP
    definition := pg_get_functiondef(signature::regprocedure);
    repaired := regexp_replace(definition,
      'AND NOT \(coalesce\(p\.has_variants, *false\) AND coalesce\(v\.is_default, *false\)\)',
      '', 'g');
    IF repaired = definition OR position('v.is_default' IN repaired) > 0
      OR position('is_inventory_anchor' IN repaired) = 0 THEN
      RAISE EXCEPTION 'unexpected % definition; default variant repair refused', signature;
    END IF;
    EXECUTE repaired;
  END LOOP;
END $repair$;
