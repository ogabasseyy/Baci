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
-- It counts only for purpose 'vtu', purchase_ref = the VTU transaction id, the
-- same customer and merchant (through the onboarding intent), a checkout row
-- marked paymentSource = 'piggyvest_wallet', and exactly its amount in kobo.
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
    UPDATE public.vtu_transactions AS row
       SET status = 'failed',
           error_message = 'We could not complete this purchase. Your payment is going back to your PiggyVest wallet.'
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

COMMIT;
