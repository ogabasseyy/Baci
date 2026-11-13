-- Airtime, data and bills paid from the PiggyVest main wallet (dark; the VTU
-- step of "pay from your PiggyVest wallet", on top of
-- 20261112161500_piggyvest_wallet_pay).
--
-- The VTU purchase itself runs in the existing wallet-only checkout route
-- (its own approved call graph) after the PiggyVest payment is confirmed and
-- its delivery claimed. This migration adds the one database step the wallet
-- pay drain needs for a confirmed VTU payment whose customer request did not
-- finish (no service-role client involved):
--
--   vtu_wallet_payment_delivery_state(integration_id, environment, operation_id)
--     'success'    the purchase vended          -> the drain records fulfilled
--     'failed'     the purchase failed          -> the drain records failed,
--                                                  which opens one refund
--     'processing' a vend may still be in flight -> left for the VTU requery
--     'mismatch'   not a claimed VTU payment of this purchase
--
-- A purchase still 'pending' was never sent to a provider (the checkout moves
-- a row to 'processing' before every vend, and a transient vend error restores
-- 'pending' only when nothing was vended). Such a row is closed as failed here
-- in the same transaction, so no later request can vend it after the refund.
-- The drain step counts only for purpose 'vtu', purchase_ref = the VTU
-- transaction id, the same customer and merchant (through the onboarding
-- intent), a checkout row marked paymentSource = 'piggyvest_wallet', and
-- exactly its amount in kobo.
--
-- It also adds get_vtu_wallet_pay_purchase (below), the checkout's
-- owner-scoped read of whether a purchase was prepared as PiggyVest-paid.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION piggyvest_primary.vtu_wallet_payment_delivery_state(
  integration_id uuid, environment text, operation_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment piggyvest_primary.wallet_payments%ROWTYPE;
  v_customer uuid;
  v_merchant uuid;
  v_status text;
BEGIN
  PERFORM piggyvest_primary.assert_wallet_pay_worker(
    vtu_wallet_payment_delivery_state.integration_id, vtu_wallet_payment_delivery_state.environment);
  SELECT payment.* INTO v_payment FROM piggyvest_primary.wallet_payments AS payment
   WHERE payment.id = vtu_wallet_payment_delivery_state.operation_id
     AND payment.integration_id = vtu_wallet_payment_delivery_state.integration_id
     AND payment.purpose = 'vtu'
     AND payment.state = 'confirmed'
     AND payment.fulfilment = 'claimed'
     FOR UPDATE;
  IF NOT FOUND THEN RETURN 'mismatch'; END IF;
  SELECT intent.customer_id, intent.merchant_id INTO v_customer, v_merchant
    FROM piggyvest_primary.onboarding_intents AS intent
   WHERE intent.id = v_payment.intent_id;
  SELECT row.status INTO v_status FROM public.vtu_transactions AS row
   WHERE row.id::text = v_payment.purchase_ref
     AND row.customer_id = v_customer
     AND row.merchant_id = v_merchant
     AND row.source = 'checkout'
     AND row.metadata ->> 'paymentSource' = 'piggyvest_wallet'
     AND row.amount * 100 = trunc(row.amount * 100)
     AND (row.amount * 100)::bigint = v_payment.amount_kobo
     FOR UPDATE;
  IF NOT FOUND THEN RETURN 'mismatch'; END IF;
  IF v_status = 'successful' THEN RETURN 'success'; END IF;
  IF v_status = 'failed' THEN RETURN 'failed'; END IF;
  IF v_status = 'pending' THEN
    -- A pending row marked by an interrupted or transient vend may already
    -- have been accepted by the provider: it is re-driven by the existing
    -- idempotent recovery path, never failed and refunded here.
    IF EXISTS (SELECT 1 FROM public.vtu_transactions AS row
                WHERE row.id::text = v_payment.purchase_ref
                  AND (row.metadata ? 'monnifyTransientVendError'
                       OR row.metadata ? 'preVendInterruptedAt')) THEN
      RETURN 'processing';
    END IF;
    UPDATE public.vtu_transactions AS row
       SET status = 'failed',
           error_message = 'We could not complete this purchase. Your payment is going back to your PiggyVest wallet.',
           metadata = COALESCE(row.metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
             'refundIssued', true, 'refundAmount', row.amount,
             'refundDestination', 'piggyvest_wallet')
     WHERE row.id::text = v_payment.purchase_ref AND row.status = 'pending';
    RETURN 'failed';
  END IF;
  RETURN 'processing';
END;
$$;

REVOKE ALL ON FUNCTION piggyvest_primary.vtu_wallet_payment_delivery_state(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.vtu_wallet_payment_delivery_state(uuid, text, uuid)
  TO piggyvest_primary_authorizer;

-- The checkout's own read of how one of the caller's purchases is paid:
-- whether the row was prepared as paid from the PiggyVest wallet, and its
-- amount. Owner-scoped like get_vtu_replay_binding (no buyer SELECT policy
-- exists on vtu_transactions by design). A replayed or joined purchase is
-- paid from PiggyVest only when it was prepared that way, so a store credit
-- purchase can never also be charged to the PiggyVest wallet.
CREATE FUNCTION public.get_vtu_wallet_pay_purchase(p_transaction_id uuid)
RETURNS TABLE (id uuid, piggyvest_paid boolean, amount numeric, status text,
               merchant_id uuid, customer_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id,
         COALESCE(t.source = 'checkout' AND t.metadata ->> 'paymentSource' = 'piggyvest_wallet', false),
         t.amount, t.status, t.merchant_id, t.customer_id
    FROM public.vtu_transactions AS t
   WHERE t.id = p_transaction_id
     AND EXISTS (
       SELECT 1 FROM public.customers AS c
        WHERE c.id = t.customer_id
          AND c.user_id = (SELECT auth.uid())
     );
$$;

REVOKE ALL ON FUNCTION public.get_vtu_wallet_pay_purchase(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_vtu_wallet_pay_purchase(uuid) TO authenticated;

-- Closes a purchase prepared as PiggyVest-paid whose payment ended unpaid
-- (short of money, released or expired), so a later store credit purchase of
-- the same thing starts a new row instead of joining one that can never be
-- vended. Only this customer's own pending row, and only while no payment for
-- it is live or paid (an issued one still open, reserved, dispatched,
-- confirmed or under review). A payment issued after the close is refused by
-- the checkout (the row is no longer pending); one sent anyway is refunded by
-- the drain (its delivery state reads 'failed').
CREATE FUNCTION piggyvest_primary.close_unpaid_vtu_wallet_purchase(scope jsonb, request jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent_id uuid;
  v_customer uuid;
  v_merchant uuid;
  v_id uuid;
BEGIN
  IF request IS NULL OR pg_catalog.jsonb_typeof(request) <> 'object'
    OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(request) AS k
                WHERE k NOT IN ('transactionId', 'cancelIssued'))
    OR pg_catalog.jsonb_typeof(COALESCE(request -> 'cancelIssued', 'true'::jsonb)) <> 'boolean'
    OR COALESCE(request ->> 'transactionId', '')
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'invalid wallet payment request' USING ERRCODE = '22023';
  END IF;
  v_intent_id := piggyvest_primary.assert_savings_scope(scope);
  SELECT intent.customer_id, intent.merchant_id INTO v_customer, v_merchant
    FROM piggyvest_primary.onboarding_intents AS intent
   WHERE intent.id = v_intent_id;
  SELECT row.id INTO v_id FROM public.vtu_transactions AS row
   WHERE row.id = (request ->> 'transactionId')::uuid
     AND row.customer_id = v_customer
     AND row.merchant_id = v_merchant
     AND row.source = 'checkout'
     AND row.metadata ->> 'paymentSource' = 'piggyvest_wallet'
     AND row.status = 'pending'
     FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- The customer closed the pay sheet before any PIN: an issued payment
  -- (no proof spent, nothing reserved) is released under its row lock, which
  -- the PIN reserve also takes, so a reserve either ran first (then the
  -- payment is live and the purchase stays) or is refused afterwards.
  IF (request ->> 'cancelIssued')::boolean IS TRUE THEN
    UPDATE piggyvest_primary.wallet_payments AS payment SET state = 'released'
     WHERE payment.id IN (
       SELECT live.id FROM piggyvest_primary.wallet_payments AS live
        WHERE live.integration_id = (scope ->> 'integrationId')::uuid
          AND live.intent_id = v_intent_id
          AND live.purpose = 'vtu'
          AND live.purchase_ref = v_id::text
          AND live.state = 'issued'
        FOR UPDATE);
  END IF;
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.wallet_payments AS payment
     WHERE payment.integration_id = (scope ->> 'integrationId')::uuid
       AND payment.purpose = 'vtu'
       AND payment.purchase_ref = v_id::text
       AND NOT (payment.state = 'released'
                OR (payment.state = 'issued' AND payment.expires_at <= pg_catalog.clock_timestamp()))) THEN
    RETURN false;
  END IF;
  UPDATE public.vtu_transactions AS row
     SET status = 'failed',
         error_message = 'This purchase was not paid. Nothing was taken from your PiggyVest wallet.',
         -- Nothing was collected: no refund is owed anywhere.
         metadata = COALESCE(row.metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
           'refundSkipped', true, 'refundSkipReason', 'piggyvest_unpaid')
   WHERE row.id = v_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION piggyvest_primary.close_unpaid_vtu_wallet_purchase(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.close_unpaid_vtu_wallet_purchase(jsonb, jsonb)
  TO piggyvest_primary_authorizer;

COMMIT;
