-- Block quote rebinding after a booked wallet charge, allow authenticated
-- owners to complete an already-provisioned funding account during recovery,
-- and keep bind_admin_gigl_quote fail-closed for booked charges.

CREATE OR REPLACE FUNCTION private.block_active_shipping_charge_quote_replacement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.selected_quote_id IS NOT DISTINCT FROM OLD.selected_quote_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.merchant_shipping_charges AS c
    WHERE c.order_id = OLD.id
      AND c.status IN (
        'reserved',
        'provider_submitting',
        'needs_reconciliation',
        'booked'
      )
  ) THEN
    RAISE EXCEPTION 'active_shipping_charge_quote_replacement_blocked'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.persist_merchant_wallet_payment_account(
  p_request_id uuid,
  p_merchant_id uuid,
  p_account_number text,
  p_account_name text,
  p_bank_name text,
  p_currency text,
  p_provider_account_id text DEFAULT NULL,
  p_provider_customer_code text DEFAULT NULL
)
RETURNS public.merchant_wallet_payment_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request public.merchant_wallet_funding_account_requests;
  v_row public.merchant_wallet_payment_accounts;
  v_role text := coalesce((SELECT auth.role()), '');
BEGIN
  IF v_role <> 'service_role'
     AND NOT EXISTS (
       SELECT 1
       FROM public.merchants AS merchant
       WHERE merchant.id = p_merchant_id
         AND merchant.user_id = (SELECT auth.uid())
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_currency <> 'NGN' OR p_account_number !~ '^[0-9]{10,20}$' THEN
    RAISE EXCEPTION 'invalid_account' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_request
  FROM public.merchant_wallet_funding_account_requests
  WHERE id = p_request_id AND merchant_id = p_merchant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'funding_request_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_request.status = 'fulfilled' THEN
    SELECT * INTO v_row
    FROM public.merchant_wallet_payment_accounts
    WHERE request_id = p_request_id
    ORDER BY created_at ASC, id ASC
    LIMIT 1;
    IF FOUND
      AND v_row.account_number = p_account_number
      AND v_row.account_name IS NOT DISTINCT FROM p_account_name
      AND v_row.bank_name IS NOT DISTINCT FROM p_bank_name
      AND v_row.currency = p_currency
      AND v_row.provider_account_id IS NOT DISTINCT FROM p_provider_account_id
      AND v_row.provider_customer_code IS NOT DISTINCT FROM p_provider_customer_code THEN
      RETURN v_row;
    END IF;
    RAISE EXCEPTION 'conflicting_assignment_replay' USING ERRCODE = 'P0001';
  END IF;

  IF v_request.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'funding_request_not_pending' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'paystack_order_account:' || trim(p_account_number), 0
    )
  );
  IF EXISTS (
    SELECT 1 FROM public.order_payment_accounts AS account
    WHERE account.provider = 'paystack'
      AND account.account_number = trim(p_account_number)
      AND COALESCE(
        account.expires_at,
        account.assigned_at + interval '90 minutes',
        account.created_at + interval '90 minutes'
      ) > now()
  ) OR EXISTS (
    SELECT 1 FROM public.customer_wallet_payment_accounts AS wallet
    WHERE wallet.provider = 'paystack'
      AND wallet.account_number = trim(p_account_number)
      AND wallet.status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.checkout_sessions AS checkout
    WHERE checkout.virtual_account_number = trim(p_account_number)
      AND checkout.payment_provider = 'paystack'
      AND checkout.status IN ('pending', 'processing')
      AND COALESCE(checkout.virtual_account_expires_at, checkout.expires_at) > now()
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001', MESSAGE = 'PAYSTACK_DVA_ALIAS_CONFLICT';
  END IF;

  INSERT INTO public.merchant_wallet_payment_accounts (
    merchant_id, request_id, account_number, account_name, bank_name, currency,
    status, provider_account_id, provider_customer_code
  ) VALUES (
    p_merchant_id, p_request_id, p_account_number, p_account_name, p_bank_name,
    'NGN', 'active', p_provider_account_id, p_provider_customer_code
  )
  ON CONFLICT (merchant_id, provider) WHERE status IN ('active', 'pending')
  DO UPDATE SET
    request_id = EXCLUDED.request_id,
    account_number = EXCLUDED.account_number,
    account_name = EXCLUDED.account_name,
    bank_name = EXCLUDED.bank_name,
    provider_account_id = EXCLUDED.provider_account_id,
    provider_customer_code = EXCLUDED.provider_customer_code,
    status = 'active',
    updated_at = now()
  RETURNING * INTO v_row;

  UPDATE public.merchant_wallet_funding_account_requests
  SET status = 'fulfilled'
  WHERE id = p_request_id
    AND merchant_id = p_merchant_id
    AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'funding_request_not_pending' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_merchant_wallet_payment_account(
  uuid, uuid, text, text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_merchant_wallet_payment_account(
  uuid, uuid, text, text, text, text, text, text
) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.bind_admin_gigl_quote(
  p_order_id uuid,
  p_merchant_id uuid,
  p_quote_id uuid,
  p_receiver jsonb
)
RETURNS TABLE (quote jsonb, available_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_quote public.shipping_quotes%ROWTYPE;
  v_attestation public.shipping_quote_attestations%ROWTYPE;
  v_balance numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.merchants m WHERE m.id = p_merchant_id AND m.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND merchant_id = p_merchant_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.shipment_id IS NOT NULL OR v_order.tracking_number IS NOT NULL
     OR lower(COALESCE(v_order.shipping_status, '')) IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION 'order_already_shipped_or_booked';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.merchant_shipping_charges AS charge
    WHERE charge.order_id = p_order_id
      AND charge.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'order_already_shipped_or_booked';
  END IF;
  SELECT * INTO v_quote FROM public.shipping_quotes WHERE id = p_quote_id FOR UPDATE;
  SELECT * INTO v_attestation
  FROM public.shipping_quote_attestations
  WHERE quote_id = p_quote_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_quote.merchant_id IS DISTINCT FROM p_merchant_id
     OR v_quote.session_id IS DISTINCT FROM p_order_id::text
     OR v_quote.provider IS DISTINCT FROM 'GIGL'
     OR v_quote.currency IS DISTINCT FROM 'NGN'
     OR v_quote.is_station_pickup
     OR v_quote.expires_at <= now()
     OR v_quote.price <= 0
     OR v_quote.pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'
     OR v_attestation.order_id IS DISTINCT FROM p_order_id
     OR v_attestation.merchant_id IS DISTINCT FROM p_merchant_id
     OR v_attestation.provider_rate_id IS DISTINCT FROM v_quote.provider_rate_id
     OR v_attestation.quote_request IS DISTINCT FROM v_quote.quote_request
     OR v_attestation.price IS DISTINCT FROM v_quote.price
     OR v_attestation.provider_cost IS DISTINCT FROM v_quote.provider_cost
     OR v_attestation.platform_margin IS DISTINCT FROM v_quote.platform_margin
     OR v_attestation.currency IS DISTINCT FROM v_quote.currency
     OR v_attestation.pricing_version IS DISTINCT FROM v_quote.pricing_version
     OR v_attestation.expires_at IS DISTINCT FROM v_quote.expires_at
     OR v_attestation.is_station_pickup IS DISTINCT FROM v_quote.is_station_pickup
     OR v_attestation.quote_request->'receiver' IS DISTINCT FROM p_receiver THEN
    RAISE EXCEPTION 'invalid_quote_attestation';
  END IF;
  SELECT COALESCE(w.available_balance, 0)
  INTO v_balance
  FROM public.merchant_wallets w
  WHERE w.merchant_id = p_merchant_id
  FOR UPDATE;
  UPDATE public.orders
  SET selected_quote_id = p_quote_id,
      shipping_provider = 'GIGL',
      shipping_address = p_receiver,
      shipping_funding_source = 'merchant_wallet'
  WHERE id = p_order_id;
  RETURN QUERY SELECT jsonb_build_object(
    'id', v_quote.id,
    'merchant_id', v_quote.merchant_id,
    'session_id', v_quote.session_id,
    'provider', v_quote.provider,
    'service_tier', v_quote.service_tier,
    'carrier_name', v_quote.carrier_name,
    'price', v_quote.price,
    'currency', v_quote.currency,
    'estimated_days', v_quote.estimated_days,
    'min_days', v_quote.min_days,
    'max_days', v_quote.max_days,
    'pickup_included', v_quote.pickup_included,
    'insurance_included', v_quote.insurance_included,
    'provider_rate_id', v_quote.provider_rate_id,
    'is_station_pickup', v_quote.is_station_pickup,
    'station_name', v_quote.station_name,
    'station_address', v_quote.station_address,
    'quote_request', v_quote.quote_request,
    'used', v_quote.used,
    'expires_at', v_quote.expires_at,
    'created_at', v_quote.created_at
  ), v_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.bind_admin_gigl_quote(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bind_admin_gigl_quote(uuid, uuid, uuid, jsonb)
  TO authenticated;
