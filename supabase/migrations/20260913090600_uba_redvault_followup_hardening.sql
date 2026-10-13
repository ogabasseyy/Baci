DROP FUNCTION IF EXISTS public.get_storefront_redvault_variant_pricing(uuid[]);

CREATE FUNCTION public.get_storefront_redvault_variant_pricing(p_variant_ids uuid[])
RETURNS TABLE (id uuid, product_id uuid, price_override numeric, condition text, attributes jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route'
    OR NULLIF(auth.jwt()->>'storefront_order_merchant_id', '') IS NULL THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;
  RETURN QUERY
  SELECT variant.id, variant.product_id, variant.price_override, variant.condition,
    COALESCE(to_jsonb(variant)->'attributes', '{}'::jsonb)
  FROM public.product_variants AS variant
  JOIN public.products AS product ON product.id = variant.product_id
  WHERE COALESCE(array_length(p_variant_ids, 1), 0) <= 10000
    AND variant.id = ANY(COALESCE(p_variant_ids, ARRAY[]::uuid[]))
    AND product.merchant_id::text = auth.jwt()->>'storefront_order_merchant_id';
END;
$$;
ALTER FUNCTION public.get_storefront_redvault_variant_pricing(uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_storefront_redvault_variant_pricing(uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_redvault_variant_pricing(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION private.redvault_approved_completion_durable(p_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.uba_redvault_applications AS application
    JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.application_id = application.id
    WHERE application.order_id = p_order_id AND application.status = 'approved' AND attempt.state = 'approved'
      AND jsonb_typeof(attempt.provider_response->'completion_receipt') = 'object'
      AND jsonb_typeof(attempt.provider_response->'inventory_completion_receipt') = 'object'
      AND attempt.provider_response->'inventory_completion_receipt'->>'inventoryConfirmed' = 'true'
      AND jsonb_typeof(attempt.provider_response->'inventory_completion_receipt'->'inventoryReclaimedUnitCount') = 'number'
      AND attempt.provider_response->'inventory_completion_receipt'->>'inventoryReclaimedUnitCount' ~ '^(0|[1-9][0-9]*)$'
      AND NOT EXISTS (
        SELECT 1 FROM private.uba_redvault_refunds AS refund
        LEFT JOIN private.uba_redvault_refund_lifecycle AS lifecycle ON lifecycle.refund_id = refund.id
        WHERE refund.attempt_id = attempt.id AND (
          refund.state IN ('pending', 'processing', 'needs_reconciliation') OR (refund.state = 'processed' AND (
            refund.refund_type <> 'merchandise_units' OR lifecycle.inventory_state <> 'released'
          ))
        )
      )
  );
$$;
ALTER FUNCTION private.redvault_approved_completion_durable(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.redvault_approved_completion_durable(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.persist_redvault_surviving_shipment_quantity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_payment_method text;
  v_quantity integer;
  v_data jsonb;
BEGIN
  SELECT payment_method INTO v_payment_method FROM public.orders WHERE id = NEW.order_id;
  IF v_payment_method IS DISTINCT FROM 'uba_redvault' THEN RETURN NEW; END IF;
  v_quantity := (SELECT count(*)::integer FROM public.variant_inventory WHERE order_item_id = NEW.id AND status = 'reserved');
  v_data := jsonb_set(COALESCE(NEW.fulfillment_data, '{}'::jsonb), '{fulfillmentQuantity}', to_jsonb(v_quantity), true);
  IF NEW.fulfillment_data IS DISTINCT FROM v_data THEN
    UPDATE public.order_items SET fulfillment_data = v_data WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.persist_redvault_surviving_shipment_quantity() OWNER TO postgres;
DROP TRIGGER IF EXISTS persist_redvault_surviving_shipment_quantity ON public.order_items;
CREATE TRIGGER persist_redvault_surviving_shipment_quantity
AFTER UPDATE OF fulfillment_data ON public.order_items
FOR EACH ROW EXECUTE FUNCTION private.persist_redvault_surviving_shipment_quantity();
