-- Owner-only "Baci pays shipping" mode for GIG bookings.
-- The platform owner flags a merchant in a private, service-only table (set it
-- from the SQL editor as postgres; no API, RLS policy or UI can write it).
-- For flagged merchants reserve_merchant_shipping_charge records a
-- funding_source = 'platform' charge and debits no wallet; refunds credit
-- nothing back. Every guard for normal merchants (Paystack direct-split
-- exposure, funding-source trigger, prepaid checks) is unchanged.

CREATE TABLE IF NOT EXISTS private.platform_funded_gigl_merchants (
  merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.platform_funded_gigl_merchants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.platform_funded_gigl_merchants
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.merchant_shipping_charges
  ADD COLUMN IF NOT EXISTS funding_source text NOT NULL DEFAULT 'merchant_wallet';
DO $$ BEGIN
  ALTER TABLE public.merchant_shipping_charges
    ADD CONSTRAINT merchant_shipping_charges_funding_source_check
    CHECK (funding_source IN ('merchant_wallet', 'platform'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.merchant_shipping_charges
    ADD CONSTRAINT merchant_shipping_charges_platform_no_wallet_movement
    CHECK (
      funding_source <> 'platform'
      OR (debit_transaction_id IS NULL AND refund_transaction_id IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.get_gigl_shipping_funding_mode(p_merchant_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id_required' USING ERRCODE = '22023';
  END IF;
  IF (SELECT auth.uid()) IS NULL OR NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'orders', 'fulfill'
  ) THEN
    RAISE EXCEPTION 'gigl_shipping_funding_mode_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN EXISTS (
    SELECT 1 FROM private.platform_funded_gigl_merchants AS flag
    WHERE flag.merchant_id = p_merchant_id AND flag.enabled
  ) THEN 'platform' ELSE 'merchant_wallet' END;
END;
$$;
ALTER FUNCTION public.get_gigl_shipping_funding_mode(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_gigl_shipping_funding_mode(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_gigl_shipping_funding_mode(uuid)
  TO authenticated;

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
  v_is_owner boolean := false;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('merchant-shipping-order:' || p_order_id, 0)
  );
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;
  v_is_owner := EXISTS (
    SELECT 1
    FROM public.merchants AS merchant
    WHERE merchant.id = v_order.merchant_id
      AND merchant.user_id = (SELECT auth.uid())
  );
  IF NOT FOUND
     OR NOT (
       v_is_owner
       OR public.check_staff_permission(
         (SELECT auth.uid()), v_order.merchant_id, 'orders', 'fulfill'
       )
       OR public.check_staff_permission(
         (SELECT auth.uid()), v_order.merchant_id, 'orders', 'edit'
       )
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
    ELSIF v_existing.status = 'provider_submitting'
      AND v_existing.provider_submitting_at IS NOT NULL
      AND v_existing.provider_submitting_at <= now() - interval '15 minutes' THEN
      UPDATE public.merchant_shipping_charges
      SET status = 'needs_reconciliation',
          failure_code = 'STALE_PROVIDER_SUBMISSION',
          updated_at = now()
      WHERE id = v_existing.id
      RETURNING status INTO v_charge_status;
      v_existing.status := v_charge_status;
    END IF;
    IF v_existing.funding_source = 'platform' THEN
      balance_after := NULL;
    ELSE
      SELECT available_balance INTO balance_after
      FROM public.merchant_wallets
      WHERE merchant_id = v_order.merchant_id;
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.charged_amount, balance_after, v_existing.status;
    RETURN;
  END IF;

  -- New wallet debits move merchant funds: the owner, or staff granted both
  -- orders.fulfill and orders.edit (the booking claim that consumes the debit
  -- needs orders.edit). Staff holding only one of the two may resume an
  -- existing charge above but cannot create a new debit.
  IF NOT (
    v_is_owner
    OR (
      public.check_staff_permission(
        (SELECT auth.uid()), v_order.merchant_id, 'orders', 'fulfill'
      )
      AND public.check_staff_permission(
        (SELECT auth.uid()), v_order.merchant_id, 'orders', 'edit'
      )
    )
  ) THEN
    RAISE EXCEPTION 'wallet_reservation_fulfill_edit_required' USING ERRCODE = '42501';
  END IF;

  -- Owner-set platform mode: Baci's shared GIG account pays, so no wallet is
  -- debited. The charge row still carries the idempotent submit/recover state
  -- machine. The flag is private and has no API, RLS or UI write path.
  IF EXISTS (
    SELECT 1
    FROM private.platform_funded_gigl_merchants AS flag
    WHERE flag.merchant_id = v_order.merchant_id
      AND flag.enabled
  ) THEN
    INSERT INTO public.merchant_shipping_charges AS charge(
      merchant_id, order_id, shipping_quote_id, currency, charged_amount,
      provider_cost, platform_margin, attempt_token_digest, funding_source
    ) VALUES (
      v_order.merchant_id, p_order_id, p_quote_id, v_quote.currency, v_quote.price,
      v_quote.provider_cost, v_quote.platform_margin,
      pg_catalog.encode(extensions.digest(p_attempt_token, 'sha256'), 'hex'),
      'platform'
    ) RETURNING charge.id, charge.status INTO v_charge_id, v_charge_status;
    RETURN QUERY SELECT v_charge_id, v_quote.price, NULL::numeric, v_charge_status;
    RETURN;
  END IF;

  SELECT * INTO v_wallet
  FROM public.merchant_wallets
  WHERE merchant_id = v_order.merchant_id
  FOR UPDATE;
  -- Paystack direct-split sales recorded on the wallet before 20261103084500
  -- are not Baci-held money: only the balance above that exposure can pay for
  -- a booking. The message keeps the MERCHANT_WALLET_INSUFFICIENT prefix the
  -- application maps to its insufficient-balance response.
  IF NOT FOUND
     OR COALESCE(v_wallet.available_balance, 0)
        - private.merchant_wallet_direct_settled_exposure(v_wallet.id)
        < v_quote.price THEN
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
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_merchant_shipping_charge(uuid, uuid, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.refund_merchant_shipping_charge(
  p_charge_id uuid, p_attempt_token text, p_reason_code text
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_charge public.merchant_shipping_charges%ROWTYPE;
  v_balance numeric;
  v_transaction uuid;
BEGIN
  SELECT msc.* INTO v_charge
  FROM public.merchant_shipping_charges AS msc
  WHERE msc.id = p_charge_id
    AND (
      public.check_staff_permission((SELECT auth.uid()), msc.merchant_id, 'orders', 'fulfill')
      OR public.check_staff_permission((SELECT auth.uid()), msc.merchant_id, 'orders', 'edit')
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'charge_not_owned' USING ERRCODE = '42501';
  END IF;
  IF v_charge.attempt_token_digest <> pg_catalog.encode(
    extensions.digest(p_attempt_token, 'sha256'), 'hex'
  ) THEN
    RAISE EXCEPTION 'charge_not_owned' USING ERRCODE = '42501';
  END IF;
  IF v_charge.status = 'refunded' THEN RETURN v_charge.status; END IF;
  IF v_charge.status IN ('booked', 'needs_reconciliation') THEN RETURN v_charge.status; END IF;
  IF v_charge.status = 'provider_submitting'
     AND v_charge.provider_submitting_at IS NOT NULL
     AND v_charge.provider_submitting_at > now() - interval '15 minutes'
     AND v_charge.shipment_id IS NOT NULL THEN
    RETURN v_charge.status;
  END IF;
  IF v_charge.status NOT IN ('reserved', 'provider_submitting') THEN RETURN v_charge.status; END IF;
  IF v_charge.funding_source = 'platform' THEN
    -- Nothing was debited, so nothing is credited back.
    UPDATE public.merchant_shipping_charges
    SET status = 'refunded', failure_code = p_reason_code,
        refunded_at = now(), updated_at = now()
    WHERE id = v_charge.id;
    RETURN 'refunded';
  END IF;
  UPDATE public.merchant_wallets
  SET available_balance = available_balance + v_charge.charged_amount, updated_at = now()
  WHERE merchant_id = v_charge.merchant_id
  RETURNING available_balance INTO v_balance;
  INSERT INTO public.wallet_transactions(
    wallet_id, merchant_id, type, amount, balance_after, source_type,
    source_id, description, status
  )
  SELECT id, v_charge.merchant_id, 'refund', v_charge.charged_amount,
    v_balance, 'gigl_shipping', v_charge.order_id,
    'GIGL shipping reservation refund', 'completed'
  FROM public.merchant_wallets
  WHERE merchant_id = v_charge.merchant_id
  RETURNING id INTO v_transaction;
  UPDATE public.merchant_shipping_charges
  SET status = 'refunded', refund_transaction_id = v_transaction,
      failure_code = p_reason_code, refunded_at = now(), updated_at = now()
  WHERE id = v_charge.id;
  RETURN 'refunded';
END;
$$;

REVOKE ALL ON FUNCTION public.refund_merchant_shipping_charge(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_merchant_shipping_charge(uuid, text, text)
  TO authenticated;

-- Cancelling an order before submission must not credit a wallet for a
-- platform charge (it would also violate the no-wallet-movement CHECK).
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
     AND OLD.shipping_status NOT IN ('cancelled', 'canceled') THEN
    IF EXISTS (
      SELECT 1
      FROM public.merchant_shipping_charges AS charge
      WHERE charge.order_id = NEW.id
        AND charge.status IN ('booked', 'needs_reconciliation')
    ) THEN
      RAISE EXCEPTION 'active_merchant_shipping_charge' USING ERRCODE = '55P03';
    END IF;

    IF NEW.shipment_id IS NULL THEN
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
        IF v_charge.funding_source = 'platform' THEN
          -- Baci paid; nothing was debited, so nothing is credited back.
          UPDATE public.merchant_shipping_charges
          SET status = 'refunded',
              failure_code = 'ORDER_CANCELLED_BEFORE_SUBMISSION',
              refunded_at = now(),
              updated_at = now()
          WHERE id = v_charge.id;
          CONTINUE;
        END IF;

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
        FROM public.merchant_shipping_charges AS charge
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
  END IF;
  RETURN NEW;
END;
$$;

-- merchant_shipping_charges is column-granted to authenticated (20260903128000);
-- the bound-quote lookup reads the payer of an existing reservation. The
-- column carries no money values, so exposing it leaks no economics.
GRANT SELECT (funding_source) ON TABLE public.merchant_shipping_charges
  TO authenticated;
