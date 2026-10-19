-- Mixed internal-credit + gateway checkouts must not withhold the full stamped
-- GIGL tariff again on the gateway settlement. Count capped internal credits in
-- v_already_retained before computing remaining retention.

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
  v_internal_credit numeric(12,2) := 0;
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
       AND settlement.merchant_id = p_merchant_id
       AND settlement.status IS DISTINCT FROM 'cancelled';

    IF v_snapshot > 0 THEN
      SELECT GREATEST(
        COALESCE((
          SELECT SUM(GREATEST(COALESCE(t.amount, 0), 0))
          FROM public.transactions AS t
          WHERE t.merchant_id = p_merchant_id
            AND t.order_id = p_source_id
            AND t.status = 'completed'
            AND lower(btrim(COALESCE(t.gateway, ''))) = ANY (
              ARRAY['wallet', 'savings', 'store_credit']::text[]
            )
        ), 0),
        COALESCE((
          SELECT SUM(GREATEST(COALESCE(w.amount, 0), 0))
          FROM public.customer_wallet_transactions AS w
          WHERE w.merchant_id = p_merchant_id
            AND w.source_type = 'order_redemption'
            AND w.source_id = p_source_id
            AND w.status = 'completed'
        ), 0)
        + COALESCE((
          SELECT SUM(GREATEST(COALESCE(s.amount, 0), 0))
          FROM public.customer_savings_redemptions AS s
          WHERE s.merchant_id = p_merchant_id
            AND s.order_id = p_source_id
            AND s.metadata->>'reversed_at' IS NULL
        ), 0)
      )
        INTO v_internal_credit;
      v_already_retained := v_already_retained
        + LEAST(
          GREATEST(v_snapshot - v_already_retained, 0),
          GREATEST(COALESCE(v_internal_credit, 0), 0)
        );
    END IF;
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
