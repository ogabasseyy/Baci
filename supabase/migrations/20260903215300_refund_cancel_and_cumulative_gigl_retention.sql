-- Refund abandoned reserved wallet charges during cancellation, undo guessed
-- legacy economics backfills, and retain GIGL shipping across partial settlements.

CREATE OR REPLACE FUNCTION private.prevent_active_gigl_shipping_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_charge public.merchant_shipping_charges%ROWTYPE;
  v_balance numeric;
  v_transaction uuid;
BEGIN
  IF NEW.shipping_status IN ('cancelled', 'canceled')
     AND OLD.shipping_status NOT IN ('cancelled', 'canceled')
     AND NEW.shipment_id IS NULL THEN
    IF NEW.shipment_booking_lock_token IS NOT NULL
       AND NEW.shipment_booking_started_at IS NOT NULL
       AND NEW.shipment_booking_started_at > now() - interval '15 minutes' THEN
      RAISE EXCEPTION 'active_shipment_booking_lock' USING ERRCODE = '55P03';
    END IF;

    FOR v_charge IN
      SELECT charge.*
      FROM public.merchant_shipping_charges AS charge
      WHERE charge.order_id = NEW.id
        AND charge.status = 'reserved'
        AND charge.shipment_id IS NULL
      FOR UPDATE
    LOOP
      UPDATE public.merchant_wallets
      SET available_balance = available_balance + v_charge.charged_amount,
          updated_at = now()
      WHERE merchant_id = v_charge.merchant_id
      RETURNING available_balance INTO v_balance;

      INSERT INTO public.wallet_transactions(
        wallet_id, merchant_id, type, amount, balance_after, source_type,
        source_id, description, status
      )
      SELECT id, v_charge.merchant_id, 'refund', v_charge.charged_amount,
        v_balance, 'gigl_shipping', v_charge.order_id,
        'GIGL shipping reservation refund on cancel', 'completed'
      FROM public.merchant_wallets
      WHERE merchant_id = v_charge.merchant_id
      RETURNING id INTO v_transaction;

      UPDATE public.merchant_shipping_charges
      SET status = 'refunded',
          refund_transaction_id = v_transaction,
          failure_code = 'ORDER_CANCELLED_BEFORE_SUBMISSION',
          refunded_at = now(),
          updated_at = now()
      WHERE id = v_charge.id;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM public.merchant_shipping_charges charge
      WHERE charge.order_id = NEW.id
        AND (
          (
            charge.shipment_id IS NULL
            AND charge.status IN ('provider_submitting')
          )
          OR charge.status IN ('booked', 'needs_reconciliation')
        )
    ) THEN
      RAISE EXCEPTION 'active_merchant_shipping_charge' USING ERRCODE = '55P03';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Undo economics stamps that were inferred only from an old selected GIGL quote
-- without authoritative gigl_platform_margin_v1 quote evidence.
ALTER TABLE public.orders DISABLE TRIGGER stamp_gigl_order_economics;
UPDATE public.orders AS o
SET shipping_funding_source = NULL,
    shipping_provider_cost = NULL,
    shipping_platform_margin = NULL,
    shipping_pricing_version = NULL,
    shipping_platform_retained_amount = 0
FROM public.shipping_quotes AS sq
WHERE o.selected_quote_id = sq.id
  AND o.shipping_funding_source = 'customer_checkout'
  AND o.shipping_pricing_version = 'gigl_platform_margin_v1'
  AND sq.provider = 'GIGL'
  AND sq.pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'
  AND NOT EXISTS (
    SELECT 1
    FROM public.merchant_settlements AS settlement
    WHERE settlement.source_type = 'order'
      AND settlement.source_id = o.id
  );
ALTER TABLE public.orders ENABLE TRIGGER stamp_gigl_order_economics;

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
