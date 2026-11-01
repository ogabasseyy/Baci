-- Assignment changes alter both offer and ordinary availability without a
-- stock-status update. Invalidate the product and its storefront atomically.
CREATE OR REPLACE FUNCTION private.invalidate_serialized_offer_assignment_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_slug text;
BEGIN
  SELECT p.slug INTO v_slug
  FROM public.product_variants AS v
  JOIN public.products AS p ON p.id = v.product_id AND p.merchant_id = v.merchant_id
  WHERE v.id = NEW.variant_id AND v.merchant_id = NEW.merchant_id;

  PERFORM public.enqueue_storefront_cache_targets(
    NEW.merchant_id, NULL, NULL,
    CASE WHEN v_slug IS NULL THEN '{}'::text[] ELSE ARRAY[v_slug] END
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.invalidate_serialized_offer_assignment_cache()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS serialized_offer_assignment_cache_invalidation ON public.variant_inventory;
CREATE TRIGGER serialized_offer_assignment_cache_invalidation
AFTER UPDATE ON public.variant_inventory
FOR EACH ROW
WHEN (OLD.condition_offer_id IS DISTINCT FROM NEW.condition_offer_id)
EXECUTE FUNCTION private.invalidate_serialized_offer_assignment_cache();
