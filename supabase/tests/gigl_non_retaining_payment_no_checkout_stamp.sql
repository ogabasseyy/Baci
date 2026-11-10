-- Contract test (20261109120000): payment methods that cannot retain shipping
-- must never be stamped customer_checkout, and may rebind to the wallet.
BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

SELECT pg_temp.check(
  private.is_non_retaining_checkout_payment_method(m) = true,
  'expected non-retaining: ' || m)
FROM unnest(ARRAY['credit_direct','Credit-Direct',' pod ','pay_on_delivery','manual','manual_payment','cash']) AS m;

SELECT pg_temp.check(
  private.is_non_retaining_checkout_payment_method(m) = false,
  'expected retaining: ' || COALESCE(m, 'null'))
FROM unnest(ARRAY['paystack','korapay','wallet']::text[]) AS m;

SELECT pg_temp.check(
  pg_catalog.pg_get_functiondef('private.stamp_gigl_order_economics()'::regprocedure)
    LIKE '%is_non_retaining_checkout_payment_method(NEW.payment_method)%',
  'stamp trigger must consult the payment method');

SELECT pg_temp.check(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgname = 'stamp_gigl_order_economics'
      AND t.tgrelid = 'public.orders'::regclass
      AND pg_catalog.pg_get_triggerdef(t.oid) LIKE '%payment_method%'),
  'stamp trigger must fire on payment_method updates');

-- Regression: a wallet whose balance is entirely direct-settled exposure must
-- show 0 spendable (not the raw balance), matching reserve_merchant_shipping_charge.
SELECT pg_temp.check(
  pg_catalog.pg_get_functiondef(
    'public.get_merchant_shipping_wallet_balance(uuid)'::regprocedure)
    LIKE '%merchant_wallet_direct_settled_exposure(wallet.id)%'
  AND pg_catalog.pg_get_functiondef(
    'public.get_merchant_shipping_wallet_balance(uuid)'::regprocedure)
    LIKE '%GREATEST%',
  'shipping wallet balance must subtract direct-settled exposure, floored at 0');

ROLLBACK;
