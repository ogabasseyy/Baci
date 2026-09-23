-- Finalize the GIGL wallet/checkout economics boundary.
--
-- This migration intentionally supersedes the earlier definitions rather than
-- editing them.  Provider callbacks and wallet reservations are guarded by
-- row locks, and customer-checkout shipping retention is an order snapshot,
-- never a value re-read from a mutable quote binding.

-- A delayed Paystack callback may only fulfill the request it locks while the
-- request is pending.  The only terminal replay accepted is an exact replay
-- of the already persisted fulfilled assignment.
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
BEGIN
  IF coalesce((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
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
       AND v_row.merchant_id = p_merchant_id
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

  -- This check is inside the request row lock.  Failed, expired, and any
  -- future terminal states cannot be resurrected by a stale provider callback.
  IF v_request.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'funding_request_not_pending' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'paystack_order_account:' || pg_catalog.btrim(p_account_number), 0
    )
  );
  IF EXISTS (
    SELECT 1 FROM public.order_payment_accounts account
    WHERE account.provider = 'paystack'
      AND account.account_number = pg_catalog.btrim(p_account_number)
      AND COALESCE(
        account.expires_at,
        account.assigned_at + interval '90 minutes',
        account.created_at + interval '90 minutes'
      ) > now()
  ) OR EXISTS (
    SELECT 1 FROM public.customer_wallet_payment_accounts wallet
    WHERE wallet.provider = 'paystack'
      AND wallet.account_number = pg_catalog.btrim(p_account_number)
      AND wallet.status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.checkout_sessions checkout
    WHERE checkout.virtual_account_number = pg_catalog.btrim(p_account_number)
      AND checkout.payment_provider = 'paystack'
      AND checkout.status IN ('pending', 'processing')
      AND COALESCE(checkout.virtual_account_expires_at, checkout.expires_at) > now()
  ) THEN
    RAISE EXCEPTION 'PAYSTACK_DVA_ALIAS_CONFLICT' USING ERRCODE = 'P0001';
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
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_merchant_wallet_payment_account(
  uuid, uuid, text, text, text, text, text, text
) TO service_role;

-- Reserve only a live, non-cancelled processing order.  The order mutex and
-- FOR UPDATE are deliberately before this state check so cancellation and a
-- debit cannot observe different lifecycle states.
CREATE OR REPLACE FUNCTION public.reserve_merchant_shipping_charge(
  p_order_id uuid,
  p_quote_id uuid,
  p_attempt_token text
)
RETURNS TABLE(charge_id uuid, charged_amount numeric, balance_after numeric, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_quote public.shipping_quotes%ROWTYPE;
  v_attestation public.shipping_quote_attestations%ROWTYPE;
  v_wallet public.merchant_wallets%ROWTYPE;
  v_existing public.merchant_shipping_charges%ROWTYPE;
  v_tx uuid;
  v_charge_id uuid;
  v_charge_status text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('merchant-shipping-order:' || p_order_id, 0)
  );
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF NOT FOUND
     OR NOT (
       public.check_staff_permission((SELECT auth.uid()), v_order.merchant_id, 'orders', 'fulfill')
       OR public.check_staff_permission((SELECT auth.uid()), v_order.merchant_id, 'orders', 'edit')
     )
     OR v_order.shipping_funding_source IS DISTINCT FROM 'merchant_wallet'
     OR lower(COALESCE(v_order.shipping_status, '')) IS DISTINCT FROM 'processing'
     OR v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'order_not_owned' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM public.merchant_shipping_charges
  WHERE order_id = p_order_id AND shipping_quote_id = p_quote_id
  FOR UPDATE;
  SELECT * INTO v_quote
  FROM public.shipping_quotes
  WHERE id = p_quote_id
    AND merchant_id = v_order.merchant_id
    AND provider = 'GIGL'
    AND currency = 'NGN'
  FOR SHARE;
  SELECT * INTO v_attestation
  FROM public.shipping_quote_attestations
  WHERE quote_id = p_quote_id
  FOR SHARE;
  IF v_quote.id IS NULL OR v_attestation.quote_id IS NULL
     OR v_order.selected_quote_id IS DISTINCT FROM p_quote_id
     OR v_order.shipping_provider IS DISTINCT FROM 'GIGL'
     OR v_order.shipping_provider_cost IS DISTINCT FROM v_quote.provider_cost
     OR v_order.shipping_platform_margin IS DISTINCT FROM v_quote.platform_margin
     OR v_order.shipping_pricing_version IS DISTINCT FROM v_quote.pricing_version
     OR v_quote.session_id IS DISTINCT FROM p_order_id::text
     OR v_quote.pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'
     OR v_quote.is_station_pickup
     OR (v_existing.id IS NULL AND v_quote.expires_at <= now())
     OR v_attestation.order_id IS DISTINCT FROM p_order_id
     OR v_attestation.merchant_id IS DISTINCT FROM v_order.merchant_id
     OR v_attestation.price IS DISTINCT FROM v_quote.price
     OR v_attestation.provider_cost IS DISTINCT FROM v_quote.provider_cost
     OR v_attestation.platform_margin IS DISTINCT FROM v_quote.platform_margin
     OR v_attestation.currency IS DISTINCT FROM v_quote.currency
     OR v_attestation.pricing_version IS DISTINCT FROM v_quote.pricing_version
     OR v_attestation.expires_at IS DISTINCT FROM v_quote.expires_at
     OR v_attestation.is_station_pickup IS DISTINCT FROM v_quote.is_station_pickup
     OR v_attestation.provider_rate_id IS DISTINCT FROM v_quote.provider_rate_id
     OR v_attestation.quote_request IS DISTINCT FROM v_quote.quote_request THEN
    RAISE EXCEPTION 'quote_not_eligible' USING ERRCODE = '22023';
  END IF;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status = 'reserved' THEN
      UPDATE public.merchant_shipping_charges
      SET attempt_token_digest = pg_catalog.encode(extensions.digest(p_attempt_token, 'sha256'), 'hex'),
          updated_at = now()
      WHERE id = v_existing.id;
    END IF;
    SELECT available_balance INTO balance_after
    FROM public.merchant_wallets
    WHERE merchant_id = v_order.merchant_id;
    RETURN QUERY SELECT v_existing.id, v_existing.charged_amount, balance_after, v_existing.status;
    RETURN;
  END IF;

  SELECT * INTO v_wallet
  FROM public.merchant_wallets
  WHERE merchant_id = v_order.merchant_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_wallet.available_balance, 0) < v_quote.price THEN
    RAISE EXCEPTION 'MERCHANT_WALLET_INSUFFICIENT' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.merchant_wallets
  SET available_balance = available_balance - v_quote.price, updated_at = now()
  WHERE id = v_wallet.id
  RETURNING available_balance INTO balance_after;
  INSERT INTO public.wallet_transactions(
    wallet_id, merchant_id, type, amount, balance_after, source_type, source_id,
    description, status
  ) VALUES (
    v_wallet.id, v_order.merchant_id, 'debit', v_quote.price, balance_after,
    'gigl_shipping', p_order_id, 'GIGL shipping reservation', 'completed'
  ) RETURNING id INTO v_tx;
  INSERT INTO public.merchant_shipping_charges AS charge(
    merchant_id, order_id, shipping_quote_id, currency, charged_amount,
    provider_cost, platform_margin, attempt_token_digest, debit_transaction_id
  ) VALUES (
    v_order.merchant_id, p_order_id, p_quote_id, v_quote.currency, v_quote.price,
    v_quote.provider_cost, v_quote.platform_margin,
    pg_catalog.encode(extensions.digest(p_attempt_token, 'sha256'), 'hex'), v_tx
  ) RETURNING charge.id, charge.status INTO v_charge_id, v_charge_status;
  RETURN QUERY SELECT v_charge_id, v_quote.price, balance_after, v_charge_status;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_merchant_shipping_charge(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_merchant_shipping_charge(uuid, uuid, text)
  TO authenticated;

-- Stamp checkout retention once and preserve it for every later quote/address
-- mutation.  A payment-status update is included for legacy orders that were
-- still unpaid when the original economics columns were deployed.
CREATE OR REPLACE FUNCTION private.stamp_gigl_order_economics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider text;
  v_provider_cost numeric;
  v_platform_margin numeric;
  v_pricing_version text;
  v_price numeric;
  v_legacy_checkout boolean := false;
BEGIN
  IF NEW.shipping_funding_source IS NOT NULL
     AND NEW.shipping_funding_source NOT IN ('customer_checkout', 'merchant_wallet') THEN
    RAISE EXCEPTION 'Invalid shipping funding source' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.shipping_funding_source = 'customer_checkout'
     AND OLD.shipping_platform_retained_amount IS NOT NULL THEN
    NEW.shipping_funding_source := 'customer_checkout';
    NEW.shipping_provider := 'GIGL';
    NEW.shipping_provider_cost := OLD.shipping_provider_cost;
    NEW.shipping_platform_margin := OLD.shipping_platform_margin;
    NEW.shipping_pricing_version := OLD.shipping_pricing_version;
    NEW.shipping_platform_retained_amount := OLD.shipping_platform_retained_amount;
    RETURN NEW;
  END IF;

  IF NEW.selected_quote_id IS NULL THEN
    NEW.shipping_funding_source := NULL;
    NEW.shipping_provider_cost := NULL;
    NEW.shipping_platform_margin := NULL;
    NEW.shipping_pricing_version := NULL;
    NEW.shipping_platform_retained_amount := 0;
    RETURN NEW;
  END IF;

  SELECT sq.provider, sq.provider_cost, sq.platform_margin,
         sq.pricing_version, sq.price
    INTO v_provider, v_provider_cost, v_platform_margin, v_pricing_version, v_price
    FROM public.shipping_quotes sq
   WHERE sq.id = NEW.selected_quote_id
     AND sq.merchant_id = NEW.merchant_id
   LIMIT 1;
  v_legacy_checkout := TG_OP = 'UPDATE'
    AND NEW.payment_status = 'paid'
    AND OLD.payment_status IS DISTINCT FROM 'paid'
    AND NEW.shipping_funding_source IS NULL
    AND NEW.shipping_platform_retained_amount IS NULL
    AND v_pricing_version IS NULL;
  IF NOT FOUND
     OR pg_catalog.upper(pg_catalog.btrim(COALESCE(v_provider, ''))) <> 'GIGL'
     OR (v_pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'
         AND NOT v_legacy_checkout) THEN
    NEW.shipping_funding_source := NULL;
    NEW.shipping_provider_cost := NULL;
    NEW.shipping_platform_margin := NULL;
    NEW.shipping_pricing_version := NULL;
    NEW.shipping_platform_retained_amount := 0;
    RETURN NEW;
  END IF;
  IF NEW.shipping_funding_source IS NULL THEN
    NEW.shipping_funding_source := 'customer_checkout';
  END IF;
  NEW.shipping_provider_cost := v_provider_cost;
  NEW.shipping_platform_margin := v_platform_margin;
  NEW.shipping_pricing_version := COALESCE(v_pricing_version, 'gigl_platform_margin_v1');
  NEW.shipping_platform_retained_amount := CASE
    WHEN NEW.shipping_funding_source = 'customer_checkout' THEN
      CASE WHEN v_legacy_checkout
        THEN GREATEST(COALESCE(NEW.shipping_fee, v_price, 0), 0)
        ELSE v_price
      END
    ELSE 0
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_gigl_order_economics ON public.orders;
CREATE TRIGGER stamp_gigl_order_economics
  BEFORE INSERT OR UPDATE OF selected_quote_id, shipping_funding_source,
    shipping_provider_cost, shipping_platform_margin,
    shipping_platform_retained_amount, shipping_pricing_version, shipping_provider,
    payment_status
  ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.stamp_gigl_order_economics();
REVOKE ALL ON FUNCTION private.stamp_gigl_order_economics() FROM PUBLIC;

-- Legacy checkout rows may predate quote economics columns.  Backfill every
-- still-settleable order without any settlement row, including unpaid orders
-- that may be paid later.  Terminal/cancelled orders are excluded, as are
-- merchant-wallet orders and rows that already carry a snapshot.  Disabling
-- this one trigger for the migration statement avoids re-reading a legacy
-- quote with NULL pricing data.
ALTER TABLE public.orders DISABLE TRIGGER stamp_gigl_order_economics;
UPDATE public.orders AS o
SET shipping_provider = 'GIGL',
    shipping_funding_source = 'customer_checkout',
    shipping_provider_cost = sq.provider_cost,
    shipping_platform_margin = sq.platform_margin,
    shipping_pricing_version = 'gigl_platform_margin_v1',
    shipping_platform_retained_amount = GREATEST(
      COALESCE(o.shipping_fee, sq.price, 0), 0
    )
FROM public.shipping_quotes AS sq
WHERE o.selected_quote_id = sq.id
  AND sq.provider = 'GIGL'
  AND o.payment_status NOT IN ('cancelled', 'refunded', 'failed')
  AND o.cancelled_at IS NULL
  AND lower(COALESCE(o.shipping_status, '')) NOT IN ('cancelled', 'canceled')
  AND o.shipping_funding_source IS DISTINCT FROM 'merchant_wallet'
  AND (
    o.shipping_funding_source IS NULL
    OR o.shipping_platform_retained_amount IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.merchant_settlements AS settlement
    WHERE settlement.source_type = 'order'
      AND settlement.source_id = o.id
  );
ALTER TABLE public.orders ENABLE TRIGGER stamp_gigl_order_economics;

-- The settlement wrapper trusts only the immutable order snapshot.  The live
-- quote relation is intentionally absent: selected_quote_id may be cleared or
-- rebound after checkout.
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
  END IF;
  v_retained := LEAST(
    v_snapshot,
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
