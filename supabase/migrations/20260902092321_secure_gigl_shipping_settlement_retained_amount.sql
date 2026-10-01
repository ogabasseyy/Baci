-- Recompute customer-paid GIGL shipping retention inside the settlement
-- boundary. The order snapshot is convenient for the application, but it is
-- not the authority for money: this wrapper derives the retained amount from
-- the immutable selected quote and funding source before delegating to the
-- existing idempotent settlement recorder.
CREATE OR REPLACE FUNCTION public.record_merchant_settlement_gigl_v1(
  p_merchant_id       uuid,
  p_source_type       text,
  p_source_id         uuid,
  p_gateway           text,
  p_gateway_reference text,
  p_gross_amount      numeric,
  p_gateway_fee       numeric,
  p_platform_fee      numeric,
  p_description       text,
  p_metadata          jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retained_shipping_amount numeric(12,2) := 0;
  v_metadata jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: record_merchant_settlement_gigl_v1 requires service_role';
  END IF;

  IF p_source_type = 'order' THEN
    SELECT COALESCE(
      CASE
        WHEN o.shipping_funding_source = 'customer_checkout'
         AND sq.provider = 'GIGL'
         AND sq.pricing_version = 'gigl_platform_margin_v1'
        THEN sq.price
        ELSE 0
      END,
      0
    )
      INTO v_retained_shipping_amount
      FROM public.orders AS o
      LEFT JOIN public.shipping_quotes AS sq
        ON sq.id = o.selected_quote_id
       AND sq.merchant_id = o.merchant_id
      WHERE o.id = p_source_id
        AND o.merchant_id = p_merchant_id;
  END IF;

  v_metadata := COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'retained_shipping_amount', v_retained_shipping_amount
  );

  RETURN public.record_merchant_settlement(
    p_merchant_id,
    p_source_type,
    p_source_id,
    p_gateway,
    p_gateway_reference,
    p_gross_amount,
    p_gateway_fee,
    p_platform_fee + v_retained_shipping_amount,
    p_description,
    v_metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_merchant_settlement_gigl_v1(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_merchant_settlement_gigl_v1(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.record_merchant_settlement_gigl_v1(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb
) IS
  'Service-role-only GIGL settlement wrapper. Recomputes customer-checkout shipping retention from the order''s selected GIGL quote, overwriting any caller snapshot before delegating to record_merchant_settlement.';
