-- Preserve pre-feature offer-ID-only checkout behavior until the shared
-- condition-offer eligibility authority enables serialized order creation.
DO $$
DECLARE
 definition text := pg_catalog.pg_get_functiondef(
  'private.create_storefront_order_unchecked(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text)'::regprocedure);
 old text := $old$AND public.get_effective_inventory_tracking_policy(p.inventory_tracking_policy, anchor.inventory_tracking_policy)
                IN ('serialized_strict', 'serialized_then_unlimited')$old$;
 replacement text := $new$AND public.commerce_cart_condition_pool_is_quantity_managed(p_merchant_id, p.id)
              AND public.get_effective_inventory_tracking_policy(p.inventory_tracking_policy, anchor.inventory_tracking_policy)
                IN ('serialized_strict', 'serialized_then_unlimited')$new$;
BEGIN
 IF (length(definition)-length(replace(definition,old,'')))/length(old) <> 1 THEN
  RAISE EXCEPTION 'serialized offer order eligibility source mismatch';
 END IF;
 EXECUTE replace(definition,old,replacement);
END;
$$;
