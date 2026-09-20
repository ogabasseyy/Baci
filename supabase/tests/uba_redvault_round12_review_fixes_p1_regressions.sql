-- Round-12 P1 regressions: evidence-review attempts block cancellation;
-- stale init leases are reclaimable; orphaned submission claims enter
-- reconciliation; split sales record wallet-free direct settlements.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_user uuid := '11111111-0000-4000-8000-000000000072';
  v_customer uuid := '22222222-0000-4000-8000-000000000072';
  v_order_review uuid := '10000000-0000-4000-8000-000000000071';
  v_order_review_fresh uuid := '10000000-0000-4000-8000-000000000072';
  v_order_lease uuid := '10000000-0000-4000-8000-000000000073';
  v_order_lease_s uuid := '10000000-0000-4000-8000-000000000076';
  v_order_lease_n uuid := '10000000-0000-4000-8000-000000000077';
  v_order_fee uuid := '10000000-0000-4000-8000-000000000074';
  v_order_plain uuid := '10000000-0000-4000-8000-000000000075';
  v_application_review uuid := 'd1000000-0000-4000-8000-000000000071';
  v_application_review_fresh uuid := 'd1000000-0000-4000-8000-000000000072';
  v_application_lease uuid := 'd1000000-0000-4000-8000-000000000073';
  v_application_lease_stale uuid := 'd1000000-0000-4000-8000-000000000074';
  v_application_lease_null uuid := 'd1000000-0000-4000-8000-000000000075';
  v_application_fee uuid := 'd1000000-0000-4000-8000-000000000076';
  v_attempt_review uuid := 'd2000000-0000-4000-8000-000000000071';
  v_attempt_review_fresh uuid := 'd2000000-0000-4000-8000-000000000072';
  v_attempt_lease uuid := 'd2000000-0000-4000-8000-000000000073';
  v_attempt_lease_stale uuid := 'd2000000-0000-4000-8000-000000000074';
  v_attempt_lease_null uuid := 'd2000000-0000-4000-8000-000000000075';
  v_attempt_fee uuid := 'd2000000-0000-4000-8000-000000000076';
  v_refund_orphan_stale uuid := 'e1000000-0000-4000-8000-000000000071';
  v_refund_orphan_fresh uuid := 'e1000000-0000-4000-8000-000000000072';
  v_refund_fee_a uuid := 'e1000000-0000-4000-8000-000000000073';
  v_refund_fee_b uuid := 'e1000000-0000-4000-8000-000000000074';
  v_refund_fee_c uuid := 'e1000000-0000-4000-8000-000000000075';
  v_discount uuid := 'f0000000-0000-4000-8000-000000000072';
  v_wallet uuid := 'f1000000-0000-4000-8000-000000000072';
  v_product uuid := 'b0000000-0000-4000-8000-000000000072';
  v_variant uuid := 'c0000000-0000-4000-8000-000000000072';
  v_item_review uuid := '20000000-0000-4000-8000-000000000071';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_state text;
  v_status text;
  v_claimed boolean;
  v_claim_id uuid;
  v_token uuid;
  v_net numeric;
  v_upcoming numeric;
  v_count integer;
  v_settlement uuid;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p12@example.com', 'Redvault P12')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R12P1', 'fixed_amount', 100);
  -- Mirror ops activation so applications pass commercial-terms validation.
  UPDATE private.uba_redvault_runtime
  SET commercial_terms_confirmed = true,
      commercial_terms = jsonb_build_object(
        'campaign_dates', jsonb_build_object(
          'starts_at', '2020-01-01T00:00:00Z', 'ends_at', '2030-01-01T00:00:00Z'),
        'minimum_spend', jsonb_build_object('eligible_subtotal_kobo', 1000),
        'caps', jsonb_build_object('discount_kobo', 1000000),
        'usage_limits', jsonb_build_object(
          'usage_limit', 1000000, 'usage_limit_per_customer', 1000000))
  WHERE partnership = 'uba_redvault';
  INSERT INTO public.products (id, merchant_id, name, price, has_variants, inventory_tracking_policy)
  VALUES (v_product, v_merchant, 'Redvault P12 product', 150000, true, 'serialized_strict');
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy, attributes)
  VALUES (v_variant, v_product, v_merchant, 'inherit', '{"color":"red","storage":"128GB"}'::jsonb);
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer, v_merchant, v_user, 'redvault-p12@example.com');

  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, total, payment_method, payment_status, shipping_status, created_at)
  VALUES
    (v_order_review, v_merchant, v_customer, 'R12P1-REVIEW', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     pg_catalog.now() - interval '100 hours'),
    (v_order_review_fresh, v_merchant, v_customer, 'R12P1-REVIEWF', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_lease, v_merchant, v_customer, 'R12P1-LEASE', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_lease_s, v_merchant, v_customer, 'R12P1-LEASES', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_lease_n, v_merchant, v_customer, 'R12P1-LEASEN', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_fee, v_merchant, v_customer, 'R12P1-FEE', 1500.00, 'uba_redvault', 'paid', 'processing',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_plain, v_merchant, v_customer, 'R12P1-PLAIN', 1500.00, 'card', 'paid', 'processing',
     pg_catalog.now() - interval '10 minutes');
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES (v_item_review, v_order_review, v_product, v_variant, 'Redvault P12 item', 150000, 1);
  INSERT INTO public.variant_inventory
    (id, merchant_id, order_id, order_item_id, variant_id, status, identifier_type, identifier_value)
  VALUES ('a0000000-0000-4000-8000-000000000071', v_merchant, v_order_review, v_item_review, v_variant,
    'reserved', 'serial', 'R12P1-001');
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status, user_id)
  VALUES
    (v_application_review, v_order_review, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p12@example.com', 'R12P1-REVIEW', 'R12P1-REVIEW', 100, 150000, 'pending', v_user),
    (v_application_review_fresh, v_order_review_fresh, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p12@example.com', 'R12P1-REVIEWF', 'R12P1-REVIEWF', 100, 150000, 'pending', v_user),
    (v_application_lease, v_order_lease, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p12@example.com', 'R12P1-LEASE', 'R12P1-LEASE', 100, 150000, 'pending', v_user),
    (v_application_lease_stale, v_order_lease_s, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p12@example.com', 'R12P1-LEASES', 'R12P1-LEASES', 100, 150000, 'pending', v_user),
    (v_application_lease_null, v_order_lease_n, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p12@example.com', 'R12P1-LEASEN', 'R12P1-LEASEN', 100, 150000, 'pending', v_user),
    (v_application_fee, v_order_fee, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p12@example.com', 'R12P1-FEE', 'R12P1-FEE', 100, 150000, 'pending', v_user);
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash,
     paystack_subaccount_code, platform_fee_kobo)
  VALUES
    (v_attempt_review, v_application_review, v_order_review, v_merchant, 'R12P1-ATTEMPT-REVIEW', v_hash,
     150000, 'NGN', 'capture_evidence_review', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r12p1', 0),
    (v_attempt_review_fresh, v_application_review_fresh, v_order_review_fresh, v_merchant, 'R12P1-ATTEMPT-REVIEWF', v_hash,
     150000, 'NGN', 'capture_evidence_review', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r12p1', 0),
    (v_attempt_lease, v_application_lease, v_order_lease, v_merchant, 'R12P1-ATTEMPT-LEASE', v_hash,
     150000, 'NGN', 'created', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r12p1', 0),
    (v_attempt_lease_stale, v_application_lease_stale, v_order_lease_s, v_merchant, 'R12P1-ATTEMPT-LEASES', v_hash,
     150000, 'NGN', 'created', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r12p1', 0),
    (v_attempt_lease_null, v_application_lease_null, v_order_lease_n, v_merchant, 'R12P1-ATTEMPT-LEASEN', v_hash,
     150000, 'NGN', 'created', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r12p1', 0),
    (v_attempt_fee, v_application_fee, v_order_fee, v_merchant, 'R12P1-ATTEMPT-FEE', v_hash,
     150000, 'NGN', 'created', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r12p1', 0);
  -- Orphan the lease fixtures the way a crash would: claimed, never recorded.
  UPDATE private.uba_redvault_payment_attempts
  SET state = 'initializing', initialization_claimed_at = pg_catalog.now() - interval '10 minutes'
  WHERE id = v_attempt_lease_stale;
  UPDATE private.uba_redvault_payment_attempts
  SET state = 'initializing', initialization_claimed_at = NULL
  WHERE id = v_attempt_lease_null;
  INSERT INTO private.uba_redvault_refunds
    (id, attempt_id, state, refund_type, idempotency_key, amount_kobo, provider_reference, updated_at)
  VALUES
    (v_refund_orphan_stale, v_attempt_fee, 'processing', 'merchandise_units', 'R12P1-ORPHAN-S', 10000, NULL,
     pg_catalog.now() - interval '10 minutes'),
    (v_refund_orphan_fresh, v_attempt_fee, 'processing', 'merchandise_units', 'R12P1-ORPHAN-F', 10000, NULL,
     pg_catalog.now());
  INSERT INTO public.transactions
    (id, merchant_id, order_id, transaction_type, amount, currency, status, gateway, gateway_reference, platform_fee)
  VALUES
    ('d3000000-0000-4000-8000-000000000074', v_merchant, v_order_fee, 'payment', 1500.00, 'NGN',
     'completed', 'paystack', 'R12P1-ATTEMPT-FEE', NULL);

  -- P1 (evidence-review exclusion): review-state attempts block every
  -- cancellation path like held captures do.
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
  UPDATE public.orders SET payment_status = 'cancelled', updated_at = pg_catalog.now()
  WHERE created_at < (pg_catalog.now() - interval '72 hours')
    AND payment_status = 'unpaid';
  SELECT payment_status INTO v_state FROM public.orders WHERE id = v_order_review;
  IF v_state <> 'unpaid' THEN
    RAISE EXCEPTION 'evidence-review capture was cancelled, got %', v_state;
  END IF;
  SELECT status INTO v_status FROM public.variant_inventory
  WHERE id = 'a0000000-0000-4000-8000-000000000071';
  IF v_status <> 'reserved' THEN
    RAISE EXCEPTION 'evidence-review units were released, got %', v_status;
  END IF;
  BEGIN
    PERFORM public.cancel_abandoned_uba_redvault_draft(v_order_review);
    RAISE EXCEPTION 'abandon cancel of evidence-review unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_abandoned_draft_active' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  BEGIN
    PERFORM public.cancel_uba_redvault_order_as_customer(v_order_review_fresh, 'nope');
    RAISE EXCEPTION 'customer cancel of evidence-review unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_customer_cancel_active' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- P1 (initialization lease): created claims, stale initializing
  -- reclaims (once), fresh initializing refuses.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'storefront_order_context', 'route',
    'storefront_order_merchant_id', v_merchant::text,
    'storefront_redvault_customer_email', 'redvault-p12@example.com')::text, true);
  SELECT initialization_claimed INTO v_claimed
  FROM public.claim_storefront_redvault_payment_attempt_initialization_v2(v_attempt_lease);
  IF v_claimed IS NOT TRUE THEN
    RAISE EXCEPTION 'created attempt was not claimable';
  END IF;
  SELECT initialization_claimed INTO v_claimed
  FROM public.claim_storefront_redvault_payment_attempt_initialization_v2(v_attempt_lease_stale);
  IF v_claimed IS NOT TRUE THEN
    RAISE EXCEPTION 'stale initializing lease was not reclaimed';
  END IF;
  SELECT initialization_claimed INTO v_claimed
  FROM public.claim_storefront_redvault_payment_attempt_initialization_v2(v_attempt_lease_stale);
  IF v_claimed IS NOT FALSE THEN
    RAISE EXCEPTION 'reclaimed lease did not heartbeat; double-claimed';
  END IF;
  SELECT initialization_claimed INTO v_claimed
  FROM public.claim_storefront_redvault_payment_attempt_initialization_v2(v_attempt_lease_null);
  IF v_claimed IS NOT TRUE THEN
    RAISE EXCEPTION 'NULL-lease initializing row was not reclaimed';
  END IF;
  SELECT initialization_claimed INTO v_claimed
  FROM public.claim_storefront_redvault_payment_attempt_initialization_v2(v_attempt_lease);
  IF v_claimed IS NOT FALSE THEN
    RAISE EXCEPTION 'fresh initializing lease was reclaimed too early';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- P1 (orphaned submission claims): a stale reference-less processing
  -- row enters reconciliation; a fresh one does not.
  SELECT id, reconciliation_claim_token INTO v_claim_id, v_token
  FROM public.claim_next_uba_redvault_refund_reconciliation();
  IF v_claim_id <> v_refund_orphan_stale THEN
    RAISE EXCEPTION 'stale orphan was not claimed, got %', v_claim_id;
  END IF;
  -- A nonterminal lookup re-leases the orphan instead of stranding it.
  PERFORM public.reconcile_uba_redvault_refund(v_claim_id, v_token, 'pending');
  SELECT state INTO v_state FROM private.uba_redvault_refunds WHERE id = v_claim_id;
  IF v_state <> 'processing' THEN
    RAISE EXCEPTION 'orphan left reconciliation, got %', v_state;
  END IF;
  SELECT id INTO v_claim_id FROM public.claim_next_uba_redvault_refund_reconciliation();
  IF v_claim_id IS NOT NULL THEN
    RAISE EXCEPTION 're-leased orphan was immediately reclaimable';
  END IF;
  -- The fresh orphan is never selected while its lease holds.
  SELECT count(*) INTO v_count FROM private.uba_redvault_refunds
  WHERE id = v_refund_orphan_fresh AND reconciliation_claim_token IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'fresh orphan was claimed';
  END IF;

  -- P1 (direct-split settlement): the informational row records proceeds
  -- with no wallet movement, stays idempotent, and fails closed.
  SELECT public.record_uba_redvault_direct_settlement(v_merchant, 'order', v_order_fee, 'paystack',
    'R12P1-ATTEMPT-FEE', 1500.00, 100, 0, 'test', '{}'::jsonb)
  INTO v_settlement;
  IF v_settlement IS NULL THEN
    RAISE EXCEPTION 'direct settlement was not recorded';
  END IF;
  SELECT net_amount, status INTO v_net, v_status FROM public.merchant_settlements
  WHERE id = v_settlement;
  IF v_net <> 1400.00 THEN
    RAISE EXCEPTION 'direct net wrong, got %', v_net;
  END IF;
  IF v_status <> 'settled' THEN
    RAISE EXCEPTION 'direct row is payable, got %', v_status;
  END IF;
  SELECT upcoming_balance INTO v_upcoming FROM public.merchant_wallets WHERE id = v_wallet;
  IF v_upcoming <> 0 THEN
    RAISE EXCEPTION 'direct settlement credited the wallet, got %', v_upcoming;
  END IF;
  SELECT public.record_uba_redvault_direct_settlement(v_merchant, 'order', v_order_fee, 'paystack',
    'R12P1-ATTEMPT-FEE', 1500.00, 100, 0, 'test', '{}'::jsonb)
  INTO v_claim_id;
  IF v_claim_id IS NOT NULL THEN
    RAISE EXCEPTION 'direct settlement was not idempotent';
  END IF;
  BEGIN
    PERFORM public.record_uba_redvault_direct_settlement(v_merchant, 'order', v_order_plain, 'paystack',
      'R12P1-OTHER', 1500.00, 100, 0, 'test', '{}'::jsonb);
    RAISE EXCEPTION 'direct settlement of a non-REDVAULT order unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_direct_settlement_order_mismatch' THEN RAISE; END IF;
  END;
  -- Reversals on a direct row adjust only the recorded net: a partial
  -- reduces it with no wallet debit, and the completing refund cancels
  -- the row with no wallet debit either.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO private.uba_redvault_refunds (id, attempt_id, state, refund_type, idempotency_key, amount_kobo)
  VALUES (v_refund_fee_b, v_attempt_fee, 'processed', 'merchandise_units', 'R12P1-FEE-B', 110000);
  SELECT net_amount INTO v_net FROM public.merchant_settlements WHERE id = v_settlement;
  IF v_net <> 373.33 THEN
    RAISE EXCEPTION 'direct partial reversal wrong, got %', v_net;
  END IF;
  SELECT upcoming_balance INTO v_upcoming FROM public.merchant_wallets WHERE id = v_wallet;
  IF v_upcoming <> 0 THEN
    RAISE EXCEPTION 'direct partial reversal moved the wallet, got %', v_upcoming;
  END IF;
  SELECT count(*) INTO v_count FROM public.wallet_transactions WHERE merchant_id = v_merchant;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'direct partial reversal wrote wallet transactions';
  END IF;
  INSERT INTO private.uba_redvault_refunds (id, attempt_id, state, refund_type, idempotency_key, amount_kobo)
  VALUES (v_refund_fee_c, v_attempt_fee, 'processed', 'merchandise_units', 'R12P1-FEE-C', 40000);
  SELECT status INTO v_status FROM public.merchant_settlements WHERE id = v_settlement;
  IF v_status <> 'cancelled' THEN
    RAISE EXCEPTION 'direct full reversal did not cancel, got %', v_status;
  END IF;
  SELECT upcoming_balance INTO v_upcoming FROM public.merchant_wallets WHERE id = v_wallet;
  IF v_upcoming <> 0 THEN
    RAISE EXCEPTION 'direct full reversal moved the wallet, got %', v_upcoming;
  END IF;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
