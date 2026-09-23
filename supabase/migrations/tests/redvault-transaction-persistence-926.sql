BEGIN;

INSERT INTO private.uba_redvault_write_context VALUES (txid_current());
UPDATE public.orders SET payment_status = 'unpaid' WHERE id = (SELECT id FROM public.test_result);
UPDATE private.uba_redvault_applications SET status = 'pending' WHERE order_id = (SELECT id FROM public.test_result);
UPDATE private.uba_redvault_payment_attempts SET state = 'created' WHERE id = (SELECT attempt_id FROM public.test_attempt LIMIT 1);
DELETE FROM public.transactions WHERE gateway_reference = (SELECT reference FROM public.test_attempt LIMIT 1);
DELETE FROM private.uba_redvault_write_context WHERE transaction_id = txid_current();
SELECT set_config('request.jwt.claims','{"storefront_redvault_customer_email":"customer@example.test","storefront_order_context":"route","storefront_order_merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74"}',false);
SET ROLE authenticated;
SELECT public.reserve_storefront_redvault_payment_attempt(id) FROM public.test_result;
RESET ROLE;

DO $$
DECLARE v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts
  WHERE id = (SELECT attempt_id FROM public.test_attempt LIMIT 1);
  IF (SELECT count(*) FROM public.transactions WHERE gateway_reference = v_attempt.reference) <> 1
    OR NOT EXISTS (SELECT 1 FROM public.transactions WHERE gateway_reference = v_attempt.reference
      AND merchant_id = v_attempt.merchant_id AND order_id = v_attempt.order_id
      AND amount * 100 = v_attempt.amount_kobo AND currency = v_attempt.currency
      AND gateway = 'paystack' AND transaction_type = 'payment' AND status = 'pending' AND platform_fee IS NULL) THEN
    RAISE EXCEPTION 'REDVAULT initialized checkout has no uniquely bound pending transaction';
  END IF;
END;
$$;

UPDATE private.uba_redvault_payment_attempts SET state = 'initialized', authorization_url = 'https://checkout.paystack.com/local-fixture';
SELECT set_config('request.jwt.claims','{"storefront_redvault_customer_email":"customer@example.test","storefront_order_context":"route","storefront_order_merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74"}',false);
SET ROLE authenticated;
SELECT public.reserve_storefront_redvault_payment_attempt(id) FROM public.test_result;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.transactions) <> 1 THEN RAISE EXCEPTION 'REDVAULT retry duplicated transaction'; END IF;
END $$;
UPDATE public.transactions SET amount = amount + 1;
SET ROLE authenticated;
SELECT public.test_expect_error('SELECT public.reserve_storefront_redvault_payment_attempt(id) FROM public.test_result','redvault_attempt_transaction_conflict');
RESET ROLE;
ROLLBACK;
SELECT 'REDVAULT durable transaction and retry conflict checks passed' AS result;
