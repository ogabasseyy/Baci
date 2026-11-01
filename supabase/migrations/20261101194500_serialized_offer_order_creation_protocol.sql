-- Newly created serialized offer lines enter the private reservation protocol;
-- older unmarked offer lines retain the legacy cleanup behavior.
DO $$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(
    'private.create_storefront_order_unchecked(uuid,text,text,jsonb,text,numeric,numeric,numeric,text,text,text,jsonb,text,text,jsonb,uuid,text,text,uuid,text,numeric,numeric,text,text)'::regprocedure
  );
  old text;
  replacement text;
BEGIN
  old := $old$        AND oi.offer_line IS DISTINCT FROM TRUE
        AND oi.product_offer_id IS NULL$old$;
  replacement := $new$        AND ((oi.offer_line IS DISTINCT FROM TRUE AND oi.product_offer_id IS NULL)
          OR EXISTS (
            SELECT 1 FROM public.products p
            LEFT JOIN public.product_variants anchor ON anchor.id = p.inventory_anchor_variant_id
              AND anchor.product_id = p.id AND anchor.merchant_id = p.merchant_id
            WHERE p.id = oi.product_id AND p.merchant_id = p_merchant_id
              AND public.get_effective_inventory_tracking_policy(p.inventory_tracking_policy, anchor.inventory_tracking_policy)
                IN ('serialized_strict', 'serialized_then_unlimited')
          ))$new$;
  IF (length(definition)-length(replace(definition,old,''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'serialized offer order selection source mismatch';
  END IF;
  definition := replace(definition,old,replacement);
  old := $old$    LOOP
      PERFORM private.claim_variant_inventory_units_for_order_item_internal($old$;
  replacement := $new$    LOOP
      INSERT INTO private.serialized_offer_order_items (order_item_id, merchant_id, offer_id)
      SELECT oi.id, p_merchant_id, coalesce(oi.product_offer_id, oi.offer_id, oi.offer_id_snapshot)
      FROM public.order_items oi
      JOIN public.products p ON p.id = oi.product_id AND p.merchant_id = p_merchant_id
      LEFT JOIN public.product_variants anchor ON anchor.id = p.inventory_anchor_variant_id
        AND anchor.product_id = p.id AND anchor.merchant_id = p.merchant_id
      WHERE oi.id = v_item.id AND oi.order_id = v_order_id
        AND (oi.offer_line IS TRUE OR oi.product_offer_id IS NOT NULL)
        AND public.get_effective_inventory_tracking_policy(p.inventory_tracking_policy, anchor.inventory_tracking_policy)
          IN ('serialized_strict', 'serialized_then_unlimited');
      PERFORM private.claim_variant_inventory_units_for_order_item_internal($new$;
  IF (length(definition)-length(replace(definition,old,''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'serialized offer order claim source mismatch';
  END IF;
  EXECUTE replace(definition,old,replacement);
END;
$$;
