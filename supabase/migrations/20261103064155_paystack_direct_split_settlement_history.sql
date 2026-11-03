-- Paystack direct-split sales are settlement history, never Baci-held money.
--
-- Standard storefront Paystack checkouts split each payment to the merchant's
-- Paystack subaccount (bearer 'account'): Paystack pays the merchant's share
-- straight into the merchant's bank. record_merchant_settlement nevertheless
-- credited that share to merchant_wallets (upcoming, then available through
-- process_due_settlements), where it could be spent on GIG bookings and paid
-- out a second time by the weekly auto-payout. Baci has no licence to hold
-- merchant money, so direct-split sales must never look like Baci balance.
--
-- This change ships as three migrations (this file and 20261103064156 /
-- 20261103064157). This one:
--   1. adds private.is_direct_split_settlement, recognising both the REDVAULT
--      marker and the new paystack_direct_split marker;
--   2. adds private.gigl_order_remaining_retained_shipping (the customer-paid
--      GIGL delivery fee still to be retained for an order, the same rule the
--      settlement wrappers use) and the service-role read
--      get_order_paystack_split_retained_shipping_kobo that the checkout uses
--      to put that fee in Baci's Paystack split;
--   3. adds record_paystack_direct_split_settlement(_gigl_v1): settled history
--      rows with no wallet movement, mirroring the REDVAULT direct recorders;
--   4. adds private.merchant_wallet_direct_settled_exposure: wallet credits
--      that came from Paystack order settlements recorded before this change
--      (or without proof that Baci's own Paystack balance received them).
--      Until the owner reconciles them, they are not spendable;
--   5. (20261103064156) guards the two wallet spend primitives
--      (debit_merchant_wallet for payouts, reserve_merchant_shipping_charge
--      for GIG bookings) so they can only spend available_balance minus that
--      exposure;
--   6. (20261103064157) teaches finalize_refunded_cancellation_order_v1 the
--      new marker, so a refund never debits a wallet that a direct-split sale
--      never credited.
--
-- No existing row is changed. The one live wallet with a balance is left as
-- it is; its reconciliation is a separate, owner-approved step documented in
-- docs/payments/paystack-direct-settlement-wallet-ledger.md.

-- 1. Direct-split marker ----------------------------------------------------
CREATE OR REPLACE FUNCTION private.is_direct_split_settlement(p_metadata jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(p_metadata ->> 'redvault_direct_split', 'false') = 'true'
      OR COALESCE(p_metadata ->> 'paystack_direct_split', 'false') = 'true'
$$;
ALTER FUNCTION private.is_direct_split_settlement(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.is_direct_split_settlement(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- 2. Remaining customer-paid GIGL retention ---------------------------------
-- Same rule as record_uba_redvault_direct_settlement_gigl_v1 (20260915102000)
-- and record_merchant_settlement_gigl_v1 (20260905113100): the frozen order
-- snapshot, minus retention already recorded on live settlements, minus
-- internal credit (wallet, savings, store credit) that already covered it.
-- Callers that record retention must hold the merchant-shipping-order lock.
CREATE OR REPLACE FUNCTION private.gigl_order_remaining_retained_shipping(
  p_order_id uuid,
  p_merchant_id uuid
) RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_snapshot numeric(12,2) := 0;
  v_already_retained numeric(12,2) := 0;
  v_internal_credit numeric(12,2) := 0;
BEGIN
  SELECT CASE
    WHEN o.shipping_funding_source = 'customer_checkout'
     AND pg_catalog.upper(pg_catalog.btrim(COALESCE(o.shipping_provider, ''))) = 'GIGL'
     AND o.shipping_pricing_version = 'gigl_platform_margin_v1'
    THEN GREATEST(COALESCE(o.shipping_platform_retained_amount, 0), 0)
    ELSE 0
  END
    INTO v_snapshot
    FROM public.orders AS o
   WHERE o.id = p_order_id
     AND o.merchant_id = p_merchant_id;
  v_snapshot := COALESCE(v_snapshot, 0);
  IF v_snapshot = 0 THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(
    GREATEST(
      COALESCE((settlement.metadata ->> 'retained_shipping_amount')::numeric, 0),
      0
    )
  ), 0)
    INTO v_already_retained
    FROM public.merchant_settlements AS settlement
   WHERE settlement.source_type = 'order'
     AND settlement.source_id = p_order_id
     AND settlement.merchant_id = p_merchant_id
     AND settlement.status IS DISTINCT FROM 'cancelled';

  SELECT GREATEST(
    COALESCE((
      SELECT SUM(GREATEST(COALESCE(t.amount, 0), 0))
      FROM public.transactions AS t
      WHERE t.merchant_id = p_merchant_id
        AND t.order_id = p_order_id
        AND t.status = 'completed'
        AND pg_catalog.lower(pg_catalog.btrim(COALESCE(t.gateway, ''))) = ANY (
          ARRAY['wallet', 'savings', 'store_credit']::text[]
        )
    ), 0),
    COALESCE((
      SELECT SUM(GREATEST(COALESCE(w.amount, 0), 0))
      FROM public.customer_wallet_transactions AS w
      WHERE w.merchant_id = p_merchant_id
        AND w.source_type = 'order_redemption'
        AND w.source_id = p_order_id
        AND w.status = 'completed'
    ), 0)
    + COALESCE((
      SELECT SUM(GREATEST(COALESCE(s.amount, 0), 0))
      FROM public.customer_savings_redemptions AS s
      WHERE s.merchant_id = p_merchant_id
        AND s.order_id = p_order_id
        AND s.metadata ->> 'reversed_at' IS NULL
    ), 0)
  )
    INTO v_internal_credit;

  v_already_retained := v_already_retained
    + LEAST(
      GREATEST(v_snapshot - v_already_retained, 0),
      GREATEST(COALESCE(v_internal_credit, 0), 0)
    );
  RETURN GREATEST(v_snapshot - v_already_retained, 0);
END;
$$;
ALTER FUNCTION private.gigl_order_remaining_retained_shipping(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.gigl_order_remaining_retained_shipping(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Checkout read: the delivery fee Baci must keep in the Paystack split, in
-- kobo. The value is the customer-facing delivery price (not tariff or
-- margin), and only service_role may read it. Unknown orders fail closed.
CREATE OR REPLACE FUNCTION public.get_order_paystack_split_retained_shipping_kobo(
  p_order_id uuid,
  p_merchant_id uuid
) RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: get_order_paystack_split_retained_shipping_kobo requires service_role'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.orders AS o
     WHERE o.id = p_order_id AND o.merchant_id = p_merchant_id
  ) THEN
    RAISE EXCEPTION 'paystack_split_order_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN pg_catalog.round(
    private.gigl_order_remaining_retained_shipping(p_order_id, p_merchant_id) * 100
  )::bigint;
END;
$$;
ALTER FUNCTION public.get_order_paystack_split_retained_shipping_kobo(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_order_paystack_split_retained_shipping_kobo(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_paystack_split_retained_shipping_kobo(uuid, uuid)
  TO service_role;

-- 3. Direct-split settlement recorders --------------------------------------
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
  v_settlement_id uuid;
  v_method text;
  v_shipping_status text;
  v_payment_status text;
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

  v_wallet_id := public.get_or_create_merchant_wallet(p_merchant_id);
  INSERT INTO public.merchant_settlements (
    merchant_id, wallet_id, source_type, source_id, gateway,
    gateway_reference, gross_amount, gateway_fee, platform_fee, net_amount,
    payment_date, expected_settlement_date, description, status, metadata,
    settlement_notified
  ) VALUES (
    p_merchant_id, v_wallet_id, p_source_type, p_source_id, p_gateway,
    p_gateway_reference, p_gross_amount, p_gateway_fee, p_platform_fee,
    -- Account-borne gateway fee: Paystack takes it from Baci's share, so the
    -- subaccount receives gross minus Baci's transaction_charge.
    p_gross_amount - p_platform_fee,
    pg_catalog.now(), pg_catalog.now()::date,
    'Settled to your bank by Paystack',
    'settled',
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'paystack_direct_split', true,
      'paystack_collection', 'direct_split',
      'paystack_subaccount_code', v_subaccount,
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
  RETURN public.record_paystack_direct_split_settlement(
    p_merchant_id, p_source_type, p_source_id, p_gateway,
    p_gateway_reference, p_gross_amount, p_gateway_fee,
    COALESCE(p_platform_fee, 0) + v_retained, p_description,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'retained_shipping_amount', v_retained,
      'retained_shipping_collected_by_split', v_retained = 0 OR v_collected
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

-- 4. Direct-settled exposure ------------------------------------------------
-- Settled Paystack order settlements that credited the wallet without proof
-- that Baci's own Paystack balance received the money. New Baci-collected
-- Paystack credits carry paystack_collection = 'integration' (set by the
-- executor from the verified payload); the owner's reconciliation marks
-- reviewed legacy rows legacy_wallet_credit_reconciled = true.
CREATE OR REPLACE FUNCTION private.merchant_wallet_direct_settled_exposure(
  p_wallet_id uuid
) RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(SUM(GREATEST(COALESCE(settlement.net_amount, 0), 0)), 0)
    FROM public.merchant_settlements AS settlement
   WHERE settlement.wallet_id = p_wallet_id
     AND settlement.status = 'settled'
     AND settlement.source_type = 'order'
     AND pg_catalog.lower(pg_catalog.btrim(COALESCE(settlement.gateway, ''))) = 'paystack'
     AND NOT private.is_direct_split_settlement(settlement.metadata)
     AND COALESCE(settlement.metadata ->> 'paystack_collection', '') <> 'integration'
     AND COALESCE(settlement.metadata ->> 'legacy_wallet_credit_reconciled', 'false') <> 'true'
$$;
ALTER FUNCTION private.merchant_wallet_direct_settled_exposure(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.merchant_wallet_direct_settled_exposure(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS merchant_settlements_wallet_settled_paystack_idx
  ON public.merchant_settlements (wallet_id)
  WHERE status = 'settled' AND source_type = 'order';

-- Spendable balance for payout callers and dashboards (service_role only).
CREATE OR REPLACE FUNCTION public.get_merchant_wallet_spendable_balance(
  p_merchant_id uuid
) RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallet public.merchant_wallets%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: get_merchant_wallet_spendable_balance requires service_role'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_wallet FROM public.merchant_wallets WHERE merchant_id = p_merchant_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  RETURN GREATEST(
    COALESCE(v_wallet.available_balance, 0)
      - private.merchant_wallet_direct_settled_exposure(v_wallet.id),
    0
  );
END;
$$;
ALTER FUNCTION public.get_merchant_wallet_spendable_balance(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_merchant_wallet_spendable_balance(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_merchant_wallet_spendable_balance(uuid)
  TO service_role;

