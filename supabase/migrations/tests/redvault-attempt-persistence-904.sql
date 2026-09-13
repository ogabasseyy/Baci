DO $$
BEGIN
  IF NOT has_function_privilege(
    'authenticated',
    'public.reserve_storefront_redvault_payment_attempt_v3(uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.reserve_storefront_redvault_payment_attempt_v3(uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.reserve_storefront_redvault_payment_attempt_v3(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'REDVAULT 904 reserve grants are not customer-scoped';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'REDVAULT 904 claim grants are not customer-scoped';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.record_storefront_redvault_payment_attempt_initialization_v2(uuid,text,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'public.record_storefront_redvault_payment_attempt_initialization_v2(uuid,text,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.record_storefront_redvault_payment_attempt_initialization_v2(uuid,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'REDVAULT 904 initialization grants are not customer-scoped';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'private.ensure_redvault_attempt_transaction_v2(uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'private.ensure_redvault_attempt_transaction_v2(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'REDVAULT 904 transaction helper is externally executable';
  END IF;
END;
$$;

BEGIN;

INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current());
UPDATE public.orders
SET payment_method = 'uba_redvault',
    payment_status = 'unpaid',
    currency = 'NGN'
WHERE id = (SELECT id FROM public.test_result);
DELETE FROM private.uba_redvault_write_context
WHERE transaction_id = pg_catalog.txid_current();

DO $$
DECLARE
  v_policy jsonb := jsonb_build_object(
    'bankCode', '033',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'),
    'issuerName', 'UBA TEST BANK',
    'verificationDomain', 'test'
  );
BEGIN
  UPDATE private.uba_redvault_applications
  SET status = 'pending', user_id = NULL
  WHERE order_id = (SELECT id FROM public.test_result);
  UPDATE private.uba_redvault_payment_attempts
  SET state = 'created',
      authorization_url = NULL,
      accepted_filter_policy = v_policy,
      accepted_filter_policy_hash = encode(
        extensions.digest(v_policy::text, 'sha256'),
        'hex'
      ),
      paystack_subaccount_code = 'ACCT_fixture',
      platform_fee_kobo = 200
  WHERE id = (SELECT attempt_id FROM public.test_attempt LIMIT 1);
  DELETE FROM public.transactions
  WHERE gateway_reference = (SELECT reference FROM public.test_attempt LIMIT 1);
END;
$$;

SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","storefront_redvault_customer_email":"customer@example.test","storefront_order_context":"route","storefront_order_merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74"}',
  false
);
SET ROLE authenticated;
SELECT public.reserve_storefront_redvault_payment_attempt_v3(id)
FROM public.test_result;
RESET ROLE;

DO $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_transaction public.transactions%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_attempt
  FROM private.uba_redvault_payment_attempts
  WHERE id = (SELECT attempt_id FROM public.test_attempt LIMIT 1);
  SELECT * INTO STRICT v_transaction
  FROM public.transactions
  WHERE gateway_reference = v_attempt.reference;
  IF v_transaction.order_id IS DISTINCT FROM v_attempt.order_id
    OR v_transaction.merchant_id IS DISTINCT FROM v_attempt.merchant_id
    OR v_transaction.amount * 100 IS DISTINCT FROM v_attempt.amount_kobo::numeric
    OR v_transaction.currency IS DISTINCT FROM 'NGN'
    OR v_transaction.gateway IS DISTINCT FROM 'paystack'
    OR v_transaction.transaction_type IS DISTINCT FROM 'payment'
    OR v_transaction.status IS DISTINCT FROM 'pending'
    OR v_transaction.platform_fee IS DISTINCT FROM 2.00 THEN
    RAISE EXCEPTION 'REDVAULT 904 did not persist the exact pending Paystack transaction';
  END IF;
END;
$$;

DELETE FROM public.transactions
WHERE gateway_reference = (SELECT reference FROM public.test_attempt LIMIT 1);
UPDATE private.uba_redvault_payment_attempts
SET state = 'created', authorization_url = NULL
WHERE id = (SELECT attempt_id FROM public.test_attempt LIMIT 1);
SET ROLE authenticated;
SELECT public.claim_storefront_redvault_payment_attempt_initialization_v3(
  (SELECT attempt_id FROM public.test_attempt LIMIT 1)
);
RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.transactions) <> 1 THEN
    RAISE EXCEPTION 'REDVAULT 904 direct claim did not persist its transaction';
  END IF;
END;
$$;

DELETE FROM public.transactions
WHERE gateway_reference = (SELECT reference FROM public.test_attempt LIMIT 1);
UPDATE private.uba_redvault_payment_attempts
SET state = 'initializing', authorization_url = NULL
WHERE id = (SELECT attempt_id FROM public.test_attempt LIMIT 1);
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","storefront_redvault_customer_email":"customer@example.test","storefront_order_context":"route","storefront_order_merchant_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',
  false
);
SET ROLE authenticated;
SELECT public.test_expect_error(
  'SELECT public.record_storefront_redvault_payment_attempt_initialization_v2((SELECT attempt_id FROM public.test_attempt LIMIT 1), ''initialized'', ''https://checkout.paystack.com/local-fixture'')',
  'redvault_customer_context_required'
);
RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.transactions) <> 0 THEN
    RAISE EXCEPTION 'REDVAULT 904 privileged transaction helper ran before customer authorization';
  END IF;
END;
$$;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","storefront_redvault_customer_email":"customer@example.test","storefront_order_context":"route","storefront_order_merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74"}',
  false
);
SET ROLE authenticated;
SELECT public.record_storefront_redvault_payment_attempt_initialization_v2(
  (SELECT attempt_id FROM public.test_attempt LIMIT 1),
  'initialized',
  'https://checkout.paystack.com/local-fixture'
);
RESET ROLE;

DO $$
BEGIN
  IF (SELECT state FROM private.uba_redvault_payment_attempts
      WHERE id = (SELECT attempt_id FROM public.test_attempt LIMIT 1)) <> 'initialized'
    OR (SELECT authorization_url FROM private.uba_redvault_payment_attempts
        WHERE id = (SELECT attempt_id FROM public.test_attempt LIMIT 1))
      <> 'https://checkout.paystack.com/local-fixture' THEN
    RAISE EXCEPTION 'REDVAULT 904 initialization persistence returned the legacy row shape';
  END IF;
END;
$$;

UPDATE private.uba_redvault_payment_attempts
SET state = 'captured_held', authorization_url = NULL
WHERE id = (SELECT attempt_id FROM public.test_attempt LIMIT 1);
SET ROLE authenticated;
SELECT public.test_expect_error(
  'SELECT public.reserve_storefront_redvault_payment_attempt_v3(id) FROM public.test_result',
  'redvault_capture_reconciliation_required'
);
RESET ROLE;

UPDATE private.uba_redvault_payment_attempts
SET state = 'initialized'
WHERE id = (SELECT attempt_id FROM public.test_attempt LIMIT 1);
INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current());
UPDATE public.orders
SET currency = 'USD'
WHERE id = (SELECT id FROM public.test_result);
DELETE FROM private.uba_redvault_write_context
WHERE transaction_id = pg_catalog.txid_current();
SET ROLE authenticated;
SELECT public.test_expect_error(
  'SELECT public.reserve_storefront_redvault_payment_attempt_v3(id) FROM public.test_result',
  'redvault_currency_unsupported'
);
RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM private.uba_redvault_payment_attempts) <> 1 THEN
    RAISE EXCEPTION 'REDVAULT 904 replay guards allowed a second attempt';
  END IF;
END;
$$;

ROLLBACK;
SELECT 'REDVAULT 904 attempt persistence and replay guards passed' AS result;
