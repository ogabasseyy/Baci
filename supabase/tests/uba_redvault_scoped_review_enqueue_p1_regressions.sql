-- Round-7 P1 regression: REDVAULT inventory-confirmation reviews are filed
-- through the narrowly scoped file_uba_redvault_inventory_confirmation_review
-- RPC (service_role or the merchant-bound storefront route client) instead of
-- an unrestricted admin-client insert from the user-facing payment flow.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_order_a uuid := '10000000-0000-4000-8000-000000000021';
  v_order_b uuid := '10000000-0000-4000-8000-000000000022';
  v_transaction_a uuid := 'd3000000-0000-4000-8000-000000000021';
  v_receipt jsonb;
  v_count integer;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p7@example.com', 'Redvault P7')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.orders (id, merchant_id, order_number, total, payment_method)
  VALUES (v_order_a, v_merchant, 'R7P1-A', 1500.00, 'uba_redvault'),
         (v_order_b, v_merchant, 'R7P1-B', 1500.00, 'uba_redvault');
  INSERT INTO public.transactions
    (id, merchant_id, order_id, transaction_type, amount, currency, status, gateway, gateway_reference, platform_fee)
  VALUES (v_transaction_a, v_merchant, v_order_a, 'payment', 1500.00, 'NGN', 'pending', 'paystack', 'R7P1-REF-A', NULL);

  -- A scoped route client files the review through the RPC.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'storefront_order_context', 'route',
    'storefront_order_merchant_id', '6b5cb8a4-5575-456c-b936-8cdfae30db74')::text, true);
  v_receipt := public.file_uba_redvault_inventory_confirmation_review(
    v_order_a, v_transaction_a, 'R7P1-REF-A', 'REDVAULT capture evidence requires review: test',
    v_merchant, '{"reason":"test"}'::jsonb);
  IF COALESCE((v_receipt->>'filed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'scoped review filing failed: %', v_receipt;
  END IF;
  SELECT count(*) INTO v_count FROM public.reconciliation_review
  WHERE issue_type = 'serialized_inventory_confirmation_failed'
    AND order_id = v_order_a AND resolved_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'scoped filing did not create the review, got %', v_count;
  END IF;

  -- Refiling the open review folds into a duplicate receipt, not a violation.
  v_receipt := public.file_uba_redvault_inventory_confirmation_review(
    v_order_a, v_transaction_a, 'R7P1-REF-A', 'REDVAULT capture evidence requires review: test',
    v_merchant, '{"reason":"test"}'::jsonb);
  IF COALESCE((v_receipt->>'duplicate')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'refile did not report duplicate: %', v_receipt;
  END IF;

  -- A scoped token bound to a different merchant is refused.
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'storefront_order_context', 'route',
    'storefront_order_merchant_id', '00000000-0000-4000-8000-000000000000')::text, true);
  BEGIN
    PERFORM public.file_uba_redvault_inventory_confirmation_review(
      v_order_a, v_transaction_a, 'R7P1-REF-A', 'REDVAULT capture evidence requires review: test',
      v_merchant, '{"reason":"test"}'::jsonb);
    RAISE EXCEPTION 'wrong-merchant filing unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'forbidden:%' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- service_role files on a second order without an open review.
  v_receipt := public.file_uba_redvault_inventory_confirmation_review(
    v_order_b, NULL, 'R7P1-REF-B', 'REDVAULT capture held: test',
    v_merchant, '{}'::jsonb);
  IF COALESCE((v_receipt->>'filed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'service filing failed: %', v_receipt;
  END IF;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
