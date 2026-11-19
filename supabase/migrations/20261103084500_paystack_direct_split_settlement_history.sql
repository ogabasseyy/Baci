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
-- This change ships as five migrations, 20261103084500 to 20261103084504:
--   1. adds private.is_direct_split_settlement, recognising both the REDVAULT
--      marker and the new paystack_direct_split marker;
--   2. adds private.gigl_order_remaining_retained_shipping (the customer-paid
--      GIGL delivery fee still to be retained for an order, the same rule the
--      settlement wrappers use) and the proof-bound checkout read
--      get_order_paystack_split_retained_shipping_kobo that puts that fee in
--      Baci's Paystack split (this file);
--   3. (20261103084501) adds record_paystack_direct_split_settlement(_gigl_v1):
--      settled history rows with no wallet movement, mirroring the REDVAULT
--      direct recorders;
--   4. (20261103084502) adds private.merchant_wallet_direct_settled_exposure:
--      wallet credits that came from Paystack order settlements recorded
--      before this change (or without proof that Baci's own Paystack balance
--      received them). Until the owner reconciles them, they are not
--      spendable;
--   5. (20261103084503) guards the two wallet spend primitives
--      (debit_merchant_wallet for payouts, reserve_merchant_shipping_charge
--      for GIG bookings) so they can only spend available_balance minus that
--      exposure;
--   6. (20261103084504) teaches finalize_refunded_cancellation_order_v1 the
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
     AND settlement.status IS DISTINCT FROM 'cancelled'
     -- A direct split whose verified charge never carried the fee to Baci
     -- did not retain it; a later payment for the order may still collect it.
     AND COALESCE(
       settlement.metadata ->> 'retained_shipping_collected_by_split', 'true'
     ) <> 'false';

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
-- kobo. The storefront calls it with the request-scoped client, so the
-- caller proves the order the same way checkout does: order id, merchant and
-- the order's customer email. The value is the customer-facing delivery
-- price the shopper already sees (never tariff or margin). A wrong email and
-- an unknown order raise the same error. Accepted disclosure: a caller who
-- already holds the order and merchant ids can confirm the customer email,
-- as get_order_payment_snapshot's email check already allows. A failed proof
-- raises rather than returning 0, because 0 would silently drop the fee from
-- Baci's split.
CREATE OR REPLACE FUNCTION public.get_order_paystack_split_retained_shipping_kobo(
  p_order_id uuid,
  p_merchant_id uuid,
  p_email text
) RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NULLIF(pg_catalog.btrim(COALESCE(p_email, '')), '') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.orders AS o
        WHERE o.id = p_order_id
          AND o.merchant_id = p_merchant_id
          AND pg_catalog.lower(pg_catalog.btrim(COALESCE(o.customer_email, '')))
            = pg_catalog.lower(pg_catalog.btrim(p_email))
     ) THEN
    RAISE EXCEPTION 'paystack_split_order_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN pg_catalog.round(
    private.gigl_order_remaining_retained_shipping(p_order_id, p_merchant_id) * 100
  )::bigint;
END;
$$;
ALTER FUNCTION public.get_order_paystack_split_retained_shipping_kobo(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_order_paystack_split_retained_shipping_kobo(uuid, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_paystack_split_retained_shipping_kobo(uuid, uuid, text)
  TO anon, authenticated, service_role;
