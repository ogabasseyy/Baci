-- Paystack direct-split settlement history, part 2 of 5: recorders.
-- See 20261103084500_paystack_direct_split_settlement_history.sql.

-- The executor calls these only when Paystack's verified transaction names
-- the merchant subaccount that received the split. The row is settlement
-- history ('settled', settlement_notified) and moves no wallet balance.
CREATE OR REPLACE FUNCTION public.record_paystack_direct_split_settlement(
  p_merchant_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_gateway text,
  p_gateway_reference text,
  p_gross_amount numeric,
  p_gateway_fee numeric,
  p_platform_fee numeric,
  p_description text,
  p_metadata jsonb,
  p_paystack_subaccount_code text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallet_id uuid;
  v_share_text text := p_metadata ->> 'paystack_subaccount_share_kobo';
  v_integration_text text := p_metadata ->> 'paystack_integration_share_kobo';
  v_net numeric(12,2);
  v_platform numeric(12,2);
  v_settlement_id uuid;
  v_method text;
  v_shipping_status text;
  v_payment_status text;
  v_registered_subaccount text;
  v_subaccount text := pg_catalog.btrim(COALESCE(p_paystack_subaccount_code, ''));
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: record_paystack_direct_split_settlement requires service_role';
  END IF;
  IF p_gateway IS DISTINCT FROM 'paystack' THEN
    RAISE EXCEPTION 'paystack_direct_settlement_gateway_mismatch';
  END IF;
  IF v_subaccount !~ '^ACCT_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'paystack_direct_settlement_subaccount_missing';
  END IF;
  IF p_source_type IS DISTINCT FROM 'order' OR p_source_id IS NULL
     OR NULLIF(pg_catalog.btrim(COALESCE(p_gateway_reference, '')), '') IS NULL THEN
    RAISE EXCEPTION 'paystack_direct_settlement_source_invalid';
  END IF;
  IF p_gross_amount IS NULL OR p_gross_amount <= 0
     OR p_platform_fee IS NULL OR p_platform_fee < 0
     OR p_gateway_fee IS NULL OR p_gateway_fee < 0
     OR p_platform_fee > p_gross_amount THEN
    RAISE EXCEPTION 'paystack_direct_settlement_amount_invalid';
  END IF;
  -- Record what Paystack actually paid. The verified fees_split.subaccount
  -- share is the merchant's net (a bank-transfer DVA gives Baci nothing; a
  -- checkout from before the GIG-fee fix gave Baci only its fee), and the
  -- verified fees_split.integration share is Baci's platform fee. Paystack's
  -- own fee stays in gateway_fee only. Without a verified Baci share, Baci's
  -- share is the rest. Without a verified merchant share, fall back to gross
  -- minus Baci's charge.
  IF v_share_text ~ '^[0-9]{1,15}$' THEN
    v_net := v_share_text::numeric / 100;
    IF v_net > p_gross_amount THEN
      RAISE EXCEPTION 'paystack_direct_settlement_amount_invalid';
    END IF;
    IF v_integration_text ~ '^[0-9]{1,15}$' THEN
      v_platform := v_integration_text::numeric / 100;
      IF v_net + v_platform > p_gross_amount THEN
        RAISE EXCEPTION 'paystack_direct_settlement_amount_invalid';
      END IF;
    ELSE
      v_platform := p_gross_amount - v_net;
    END IF;
  ELSE
    v_net := p_gross_amount - p_platform_fee;
    v_platform := p_platform_fee;
  END IF;

  SELECT o.payment_method, o.shipping_status, o.payment_status
    INTO v_method, v_shipping_status, v_payment_status
    FROM public.orders AS o
   WHERE o.id = p_source_id AND o.merchant_id = p_merchant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_direct_settlement_order_mismatch';
  END IF;
  -- REDVAULT sales have their own recorder and refund reversal.
  IF v_method = 'uba_redvault' THEN
    RAISE EXCEPTION 'paystack_direct_settlement_order_mismatch';
  END IF;
  IF v_shipping_status IN ('cancelled', 'canceled')
     OR v_payment_status = 'refunded' THEN
    RAISE EXCEPTION 'settlement_order_cancelled';
  END IF;
  -- The history row says this merchant's bank received the money, so the
  -- split must have gone to this merchant's registered subaccount. A stale or
  -- foreign code needs manual review, not a record.
  SELECT pg_catalog.btrim(COALESCE(m.paystack_subaccount_code, ''))
    INTO v_registered_subaccount
    FROM public.merchants AS m
   WHERE m.id = p_merchant_id;
  IF v_registered_subaccount IS DISTINCT FROM v_subaccount THEN
    RAISE EXCEPTION 'paystack_direct_settlement_subaccount_mismatch';
  END IF;

  v_wallet_id := public.get_or_create_merchant_wallet(p_merchant_id);
  INSERT INTO public.merchant_settlements (
    merchant_id, wallet_id, source_type, source_id, gateway,
    gateway_reference, gross_amount, gateway_fee, platform_fee, net_amount,
    payment_date, expected_settlement_date, description, status, metadata,
    settlement_notified
  ) VALUES (
    p_merchant_id, v_wallet_id, p_source_type, p_source_id, p_gateway,
    p_gateway_reference, p_gross_amount, p_gateway_fee, v_platform, v_net,
    pg_catalog.now(), pg_catalog.now()::date,
    'Settled to your bank by Paystack',
    'settled',
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'paystack_direct_split', true,
      'paystack_collection', 'direct_split',
      'paystack_subaccount_code', v_subaccount,
      'requested_platform_fee', p_platform_fee,
      'source_description', p_description
    ),
    true
  )
  ON CONFLICT (source_type, source_id, gateway_reference)
    WHERE gateway_reference IS NOT NULL AND status != 'cancelled'
    DO NOTHING
  RETURNING id INTO v_settlement_id;

  RETURN v_settlement_id;
END;
$$;
ALTER FUNCTION public.record_paystack_direct_split_settlement(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_paystack_direct_split_settlement(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_paystack_direct_split_settlement(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb, text
) TO service_role;

-- GIGL variant: records the customer-paid delivery fee Baci retained, capped
-- like the REDVAULT direct wrapper (gross minus platform fee; the gateway fee
-- is account-borne). retained_shipping_collected_by_split says whether the
-- verified Paystack transaction_charge actually covered fee plus retention:
-- checkouts started before the split fix (and bank-transfer payments) never
-- sent the delivery fee to Baci.
CREATE OR REPLACE FUNCTION public.record_paystack_direct_split_settlement_gigl_v1(
  p_merchant_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_gateway text,
  p_gateway_reference text,
  p_gross_amount numeric,
  p_gateway_fee numeric,
  p_platform_fee numeric,
  p_description text,
  p_metadata jsonb,
  p_paystack_subaccount_code text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_retained numeric(12,2) := 0;
  v_charge_text text := p_metadata ->> 'paystack_transaction_charge_kobo';
  v_collected boolean := false;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: record_paystack_direct_split_settlement_gigl_v1 requires service_role';
  END IF;
  IF p_source_type IS DISTINCT FROM 'order' OR p_source_id IS NULL THEN
    RAISE EXCEPTION 'paystack_direct_settlement_source_invalid';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('merchant-shipping-order:' || p_source_id::text, 0)
  );
  v_retained := LEAST(
    private.gigl_order_remaining_retained_shipping(p_source_id, p_merchant_id),
    GREATEST(COALESCE(p_gross_amount, 0) - COALESCE(p_platform_fee, 0), 0)
  );
  IF v_charge_text ~ '^[0-9]{1,15}$' THEN
    v_collected := v_charge_text::bigint
      >= pg_catalog.round((COALESCE(p_platform_fee, 0) + v_retained) * 100);
  END IF;
  -- retained_shipping_amount is what every prepaid-shipping consumer reads
  -- (loadOrderGiglSettledRetainedAmount, private.order_settled_gigl_retained_amount),
  -- so it holds only a fee Baci's split actually collected. An uncollected
  -- fee is kept apart as retained_shipping_intended_amount: Baci must not
  -- fund a GIG booking with money it never received.
  IF v_retained > 0 AND NOT v_collected THEN
    RETURN public.record_paystack_direct_split_settlement(
      p_merchant_id, p_source_type, p_source_id, p_gateway,
      p_gateway_reference, p_gross_amount, p_gateway_fee,
      COALESCE(p_platform_fee, 0), p_description,
      COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
        'retained_shipping_amount', 0,
        'retained_shipping_intended_amount', v_retained,
        'retained_shipping_collected_by_split', false
      ),
      p_paystack_subaccount_code
    );
  END IF;
  RETURN public.record_paystack_direct_split_settlement(
    p_merchant_id, p_source_type, p_source_id, p_gateway,
    p_gateway_reference, p_gross_amount, p_gateway_fee,
    COALESCE(p_platform_fee, 0) + v_retained, p_description,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'retained_shipping_amount', v_retained,
      'retained_shipping_collected_by_split', true
    ),
    p_paystack_subaccount_code
  );
END;
$$;
ALTER FUNCTION public.record_paystack_direct_split_settlement_gigl_v1(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_paystack_direct_split_settlement_gigl_v1(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_paystack_direct_split_settlement_gigl_v1(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb, text
) TO service_role;

