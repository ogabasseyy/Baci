-- Contract test (20261109180000): retention is an allow-list; any unverified
-- or unknown payment method is non-retaining.
BEGIN;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

SELECT pg_temp.check(
  private.is_non_retaining_checkout_payment_method(m) = true,
  'expected non-retaining: ' || COALESCE(m, 'null'))
FROM unnest(ARRAY['credit_direct','Credit-Direct',' pod ','pay_on_delivery','manual',
  'manual_payment','cash','oxygen','bank_transfer','jumia','paypal','quiz_voucher',
  'credpal','some_future_provider', NULL, '']::text[]) AS m;

SELECT pg_temp.check(
  private.is_non_retaining_checkout_payment_method(m) = false,
  'expected retaining: ' || m)
FROM unnest(ARRAY['card','Card ','paystack','korapay','uba_redvault','invoice',
  'payforme','juicyway','klump','wallet','savings','store_credit']::text[]) AS m;

ROLLBACK;
