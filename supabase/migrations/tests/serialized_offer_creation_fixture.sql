-- Minimal order-creation loop with the production #3813 exclusion shape.
CREATE OR REPLACE FUNCTION private.create_storefront_order_unchecked(
 p_merchant_id uuid, text, text, jsonb, text, numeric, numeric, numeric,
 text, text, text, jsonb, text, text, jsonb, uuid, text, text, uuid,
 text, numeric, numeric, text, text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order_id uuid := '00000000-0000-0000-0000-000000000005';
BEGIN
  DECLARE
    v_item RECORD;
  BEGIN
    FOR v_item IN
      SELECT oi.id, oi.product_id, oi.variant_id
      FROM public.order_items oi
      WHERE oi.order_id = v_order_id
        AND oi.offer_line IS DISTINCT FROM TRUE
        AND oi.product_offer_id IS NULL
      ORDER BY oi.product_id, oi.variant_id, oi.id
    LOOP
      PERFORM private.claim_variant_inventory_units_for_order_item_internal(
        p_merchant_id,
        v_order_id,
        v_item.id
      );
    END LOOP;
  END;
END;
$$;
