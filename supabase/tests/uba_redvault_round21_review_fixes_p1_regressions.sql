-- Round-21 P1 regressions: the shipment-booking claim atomically refuses
-- refunded orders while acquiring the lock; the post-submit confirm files
-- a durable interception review and refuses the persist when a full refund
-- finalized after the provider submission; the REDVAULT order draft
-- reports its idempotency replay disposition.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_user uuid := '11111111-0000-4000-8000-0000000000d1';
  v_customer uuid := '22222222-0000-4000-8000-0000000000d1';
  v_order_paid uuid := '10000000-0000-4000-8000-0000000000d1';
  v_order_refunded uuid := '10000000-0000-4000-8000-0000000000d2';
  v_order_confirm_paid uuid := '10000000-0000-4000-8000-0000000000d3';
  v_order_confirm_refunded uuid := '10000000-0000-4000-8000-0000000000d4';
  v_lock uuid := '3f761560-04b7-4f50-bf8c-96efb68300d1';
  v_lock_other uuid := '3f761560-04b7-4f50-bf8c-96efb68300d2';
  v_product uuid := 'b0000000-0000-4000-8000-0000000000d1';
  v_discount uuid := 'f0000000-0000-4000-8000-0000000000d1';
  v_wallet uuid := 'f1000000-0000-4000-8000-0000000000d1';
  v_claim record;
  v_receipt jsonb;
  v_review_count integer;
  v_provider text;
  v_order_input jsonb;
  v_quote jsonb;
  v_bad_quote jsonb;
  v_draft record;
  v_first_id uuid;
  v_first_replayed boolean;
  v_second_replayed boolean;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p21@example.com', 'Redvault P21')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer, v_merchant, v_user, 'redvault-p21@example.com');
  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, total, payment_method, payment_status, shipping_status,
     created_at)
  VALUES
    (v_order_paid, v_merchant, v_customer, 'R21P1-PAID', 1500.00, 'uba_redvault', 'paid', 'processing',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_refunded, v_merchant, v_customer, 'R21P1-REFUNDED', 1500.00, 'uba_redvault', 'refunded', 'processing',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_confirm_paid, v_merchant, v_customer, 'R21P1-CPAID', 1500.00, 'uba_redvault', 'paid', 'processing',
     pg_catalog.now() - interval '10 minutes'),
    (v_order_confirm_refunded, v_merchant, v_customer, 'R21P1-CREFUNDED', 1500.00, 'uba_redvault', 'refunded', 'processing',
     pg_catalog.now() - interval '10 minutes');
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- P1 (atomic check-and-claim): a paid order claims, a refunded order
  -- raises instead of acquiring the booking lock.
  SELECT * INTO v_claim
  FROM public.claim_order_shipment_booking(v_order_paid, v_merchant, v_lock, 900);
  IF v_claim.claimed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'paid order did not acquire the booking lock';
  END IF;
  BEGIN
    PERFORM public.claim_order_shipment_booking(v_order_refunded, v_merchant, v_lock_other, 900);
    RAISE EXCEPTION 'refunded order unexpectedly acquired the booking lock';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_refunded_for_shipment' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.orders WHERE id = v_order_refunded
    AND shipment_booking_lock_token IS NOT NULL) THEN
    RAISE EXCEPTION 'refunded order claim left a booking lock behind';
  END IF;

  -- P1 (post-submit confirm): paid passes silently, missing raises, and a
  -- refund files the interception review (once) and returns a refusal
  -- receipt instead of raising (a raise would roll the filing back).
  SELECT public.confirm_shippable_order_payment_for_booking_persist(
    v_order_confirm_paid, v_merchant, 'GIGL', 'ps-r21', 'TRK-R21')
  INTO v_receipt;
  IF v_receipt->>'persist_allowed' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'paid order unexpectedly failed the persist confirm';
  END IF;
  BEGIN
    PERFORM public.confirm_shippable_order_payment_for_booking_persist(
      gen_random_uuid(), v_merchant, 'GIGL', 'ps-r21', 'TRK-R21');
    RAISE EXCEPTION 'missing order unexpectedly passed the persist confirm';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_not_found_for_shipment' THEN RAISE; END IF;
  END;
  SELECT public.confirm_shippable_order_payment_for_booking_persist(
    v_order_confirm_refunded, v_merchant, 'GIGL', 'ps-r21', 'TRK-R21')
  INTO v_receipt;
  IF v_receipt->>'persist_allowed' IS DISTINCT FROM 'false'
    OR v_receipt->>'duplicate' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'refunded order unexpectedly passed the persist confirm';
  END IF;
  SELECT count(*), max(metadata ->> 'provider') INTO v_review_count, v_provider
  FROM public.reconciliation_review
  WHERE issue_type = 'shipment_booked_after_full_refund'
    AND order_id = v_order_confirm_refunded
    AND resolved_at IS NULL;
  IF v_review_count <> 1 THEN
    RAISE EXCEPTION 'interception review missing, got % rows', v_review_count;
  END IF;
  IF v_provider <> 'GIGL' THEN
    RAISE EXCEPTION 'interception review lost the provider identity';
  END IF;
  SELECT public.confirm_shippable_order_payment_for_booking_persist(
    v_order_confirm_refunded, v_merchant, 'GIGL', 'ps-r21', 'TRK-R21')
  INTO v_receipt;
  IF v_receipt->>'persist_allowed' IS DISTINCT FROM 'false'
    OR v_receipt->>'duplicate' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'duplicate interception receipt wrong, got %', v_receipt;
  END IF;
  SELECT count(*) INTO v_review_count
  FROM public.reconciliation_review
  WHERE issue_type = 'shipment_booked_after_full_refund'
    AND order_id = v_order_confirm_refunded
    AND resolved_at IS NULL;
  IF v_review_count <> 1 THEN
    RAISE EXCEPTION 'interception review duplicated, got % rows', v_review_count;
  END IF;

  -- P2 (replay disposition): the draft reports a fresh creation versus a
  -- retried checkout key, and conflicts on altered payloads. Fixture
  -- mirrors the native behavioral checks.
  INSERT INTO public.products VALUES
    (v_product, v_merchant, 'Samsung', 'Galaxy S24', 100, 'new', 'S', 7.5);
  INSERT INTO public.discount_codes(id, merchant_id, code, discount_type, discount_value, applies_to, is_active)
  VALUES (v_discount, v_merchant, 'R21P1', 'percentage', 5, 'all', true);
  INSERT INTO private.uba_redvault_discount_binding(discount_code_id, merchant_id, partnership)
  VALUES (v_discount, v_merchant, 'uba_redvault');
  UPDATE private.uba_redvault_runtime
  SET enabled = true,
      commercial_terms_confirmed = true,
      commercial_terms = '{"campaign_dates":"fixture","minimum_spend":"fixture","caps":"fixture","usage_limits":"fixture","stacking":"fixture","split_payments":"fixture","funding_fees":"fixture","refund_usage_restoration":"fixture","operations_owner":"fixture"}'::jsonb
  WHERE partnership = 'uba_redvault';
  PERFORM set_config('request.jwt.claims',
    '{"storefront_redvault_customer_email":"customer@example.test","storefront_order_context":"route","storefront_order_merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74"}',
    true);
  v_order_input := jsonb_build_object(
    'merchant_id', v_merchant::text,
    'customer_email', 'customer@example.test',
    'customer_name', 'Fixture',
    'discount_amount', 5,
    'checkout_idempotency_key', 'R21P1-REPLAY',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', v_product::text, 'quantity', 1,
      'condition', 'new', 'variant_attributes', '{}'::jsonb)));
  v_quote := jsonb_build_object(
    'discountKobo', 500, 'eligibleSubtotalKobo', 10000, 'productSubtotalKobo', 10000,
    'lines', jsonb_build_array(jsonb_build_object(
      'brand', 'Samsung', 'name', 'Galaxy S24', 'condition', 'new', 'discountKobo', 500,
      'lineId', 1, 'productId', v_product::text, 'quantity', 1, 'unitDiscountsKobo',
      jsonb_build_array(500), 'unitPriceKobo', 10000, 'variantAttributes', '{}'::jsonb,
      'variantId', NULL, 'vatCategoryCode', 'S', 'vatRateBp', 750)),
    'groups', jsonb_build_array(jsonb_build_object(
      'condition', 'new', 'discountKobo', 500, 'key', 'fixture', 'lineSubtotalKobo', 10000,
      'members', jsonb_build_array(jsonb_build_object(
        'allocationKobo', 500, 'lineId', 1, 'quantity', 1)),
      'productId', v_product::text, 'taxInclusive', false, 'unitPriceKobo', 10000,
      'variantAttributes', '{}'::jsonb, 'variantId', NULL, 'vatCategoryCode', 'S',
      'vatRateBp', 750)));
  SELECT * INTO v_draft
  FROM public.create_storefront_redvault_order_draft(v_order_input, v_quote);
  v_first_id := v_draft.id;
  v_first_replayed := v_draft.idempotency_replayed;
  IF v_first_replayed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'fresh draft misreported replay disposition';
  END IF;
  SELECT * INTO v_draft
  FROM public.create_storefront_redvault_order_draft(v_order_input, v_quote);
  v_second_replayed := v_draft.idempotency_replayed;
  IF v_second_replayed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'retried checkout key was not reported as a replay';
  END IF;
  IF v_draft.id IS DISTINCT FROM v_first_id THEN
    RAISE EXCEPTION 'replay returned a different order id';
  END IF;
  v_bad_quote := jsonb_set(v_quote, '{eligibleSubtotalKobo}', '9999');
  BEGIN
    PERFORM public.create_storefront_redvault_order_draft(v_order_input, v_bad_quote);
    RAISE EXCEPTION 'altered replay payload unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'checkout_idempotency_conflict' THEN RAISE; END IF;
  END;
  -- The atomic wrapper passes the disposition through to the route.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS routine
    WHERE routine.proname = 'create_storefront_redvault_order'
      AND 'idempotency_replayed' = ANY (routine.proargnames)) THEN
    RAISE EXCEPTION 'atomic wrapper does not expose the replay disposition';
  END IF;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
