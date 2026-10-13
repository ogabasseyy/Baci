-- Serialize cumulative GIGL shipping retention per order so concurrent partial
-- settlements cannot both read the same v_already_retained total.

CREATE OR REPLACE FUNCTION public.record_merchant_settlement_gigl_v1(
  p_merchant_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_gateway text,
  p_gateway_reference text,
  p_gross_amount numeric,
  p_gateway_fee numeric,
  p_platform_fee numeric,
  p_description text,
  p_metadata jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot numeric(12,2) := 0;
  v_already_retained numeric(12,2) := 0;
  v_remaining numeric(12,2) := 0;
  v_retained numeric(12,2) := 0;
  v_metadata jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: record_merchant_settlement_gigl_v1 requires service_role';
  END IF;
  IF p_source_type = 'order' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('merchant-shipping-order:' || p_source_id::text, 0)
    );

    SELECT CASE
      WHEN o.shipping_funding_source = 'customer_checkout'
       AND pg_catalog.upper(pg_catalog.btrim(COALESCE(o.shipping_provider, ''))) = 'GIGL'
       AND o.shipping_pricing_version = 'gigl_platform_margin_v1'
      THEN GREATEST(COALESCE(o.shipping_platform_retained_amount, 0), 0)
      ELSE 0
    END
      INTO v_snapshot
      FROM public.orders o
     WHERE o.id = p_source_id
       AND o.merchant_id = p_merchant_id;

    SELECT COALESCE(SUM(
      GREATEST(
        COALESCE((settlement.metadata ->> 'retained_shipping_amount')::numeric, 0),
        0
      )
    ), 0)
      INTO v_already_retained
      FROM public.merchant_settlements AS settlement
     WHERE settlement.source_type = 'order'
       AND settlement.source_id = p_source_id
       AND settlement.merchant_id = p_merchant_id;
  END IF;

  v_remaining := GREATEST(v_snapshot - v_already_retained, 0);
  v_retained := LEAST(
    v_remaining,
    GREATEST(
      COALESCE(p_gross_amount, 0) - COALESCE(p_gateway_fee, 0)
        - COALESCE(p_platform_fee, 0),
      0
    )
  );
  v_metadata := COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'retained_shipping_amount', v_retained
  );
  RETURN public.record_merchant_settlement(
    p_merchant_id, p_source_type, p_source_id, p_gateway,
    p_gateway_reference, p_gross_amount, p_gateway_fee,
    p_platform_fee + v_retained, p_description, v_metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_merchant_settlement_gigl_v1(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_merchant_settlement_gigl_v1(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb
) TO service_role;
