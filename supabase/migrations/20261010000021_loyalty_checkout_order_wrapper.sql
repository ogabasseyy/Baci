-- Checkout order wrapper for loyalty reward codes (issue #3165).
--
-- Split from 20261010000009_loyalty_checkout_bridge.sql (300-line
-- limit): that file keeps the read-only resolve RPC; this file owns
-- the wrapper that claims a single-use code while creating the order.

-- Order wrapper: claims a single-use loyalty code while creating the
-- order. Same shape as the discount-code wrapper: lock the claim row,
-- create (or replay) the order through the unmodified trust-boundary
-- RPC, enforce policy on fresh orders only, then mark used. Single-use
-- by design (one redemption row = one claim), so no usage table.
CREATE OR REPLACE FUNCTION public.create_storefront_order_with_loyalty_code(
  p_merchant_id uuid, p_customer_email text, p_customer_name text, p_items jsonb,
  p_customer_phone text DEFAULT NULL, p_shipping_fee numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0, p_tax_amount numeric DEFAULT 0,
  p_payment_method text DEFAULT 'card', p_payment_status text DEFAULT 'unpaid',
  p_shipping_status text DEFAULT 'pending', p_shipping_address jsonb DEFAULT NULL,
  p_source text DEFAULT 'online_store', p_notes text DEFAULT NULL, p_ad_tracking jsonb DEFAULT NULL,
  p_selected_quote_id uuid DEFAULT NULL, p_shipping_provider text DEFAULT NULL,
  p_tracking_number text DEFAULT NULL, p_user_id uuid DEFAULT NULL, p_tax_basis text DEFAULT 'exclusive',
  p_gift_wrapping_fee numeric DEFAULT 0, p_expected_total numeric DEFAULT NULL,
  p_checkout_idempotency_key text DEFAULT NULL, p_checkout_request_hash text DEFAULT NULL,
  p_loyalty_redemption_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, order_number text, tracking_token text, subtotal numeric, shipping_fee numeric,
  discount_amount numeric, tax_amount numeric, total numeric, customer_id uuid, customer_email text,
  customer_name text, customer_phone text, payment_status text, shipping_status text,
  payment_method text, shipping_address jsonb, merchant_id uuid, tax_basis text,
  gift_wrapping_fee numeric, idempotency_replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_redemption  record;
  v_reward_id   uuid;
  v_order       record;
  v_existing_payment_status text;
  v_existing_shipping_status text;
  v_now         timestamptz := pg_catalog.now();
  v_expected    numeric;
  v_claim_order_status text;
  v_claim_payment_status text;
  v_order_currency text;
BEGIN
  IF p_loyalty_redemption_id IS NULL THEN
    RAISE EXCEPTION 'loyalty_redemption_required';
  END IF;

  -- Parent-before-child lock order (DELETE route locks parent first):
  -- read the reward id unlocked, lock the parent, then lock the child.
  SELECT rr.reward_id INTO v_reward_id
  FROM public.reward_redemptions rr
  WHERE rr.id = p_loyalty_redemption_id AND rr.merchant_id = p_merchant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'loyalty_redemption_not_found'; END IF;

  IF v_reward_id IS NOT NULL THEN
    PERFORM 1 FROM public.loyalty_rewards rw
    WHERE rw.id = v_reward_id FOR UPDATE;
  END IF;

  -- Lock the redemption row. Held through commit so concurrent
  -- checkouts racing the same single-use code serialize on the claim.
  -- Re-reads every field: a racing checkout may have claimed the code
  -- since the unlocked read above. The parent is already locked, so
  -- the legacy minimum fallback cannot change under validation; a
  -- deleted reward reads back NULL there and the issuance snapshot
  -- governs (see the resolver).
  SELECT
    rr.id, rr.reward_id, rr.reward_type, rr.reward_value, rr.discount_code,
    rr.expires_at, COALESCE(rr.used, false) AS used,
    rr.used_on_order_id, rr.issuance_currency, rr.max_redemption_percentage,
    COALESCE(rr.minimum_order_amount, rw.minimum_order_amount)
      AS minimum_order_amount
  INTO v_redemption
  FROM public.reward_redemptions rr
  LEFT JOIN public.loyalty_rewards rw ON rw.id = rr.reward_id
  WHERE rr.id = p_loyalty_redemption_id AND rr.merchant_id = p_merchant_id
  FOR UPDATE OF rr;
  IF NOT FOUND THEN RAISE EXCEPTION 'loyalty_redemption_not_found'; END IF;

  -- REPLAY pre-check: the base RPC reopens an existing order whose
  -- only terminal marker is payment_status (mark_abandoned_orders),
  -- resetting it to unpaid before any post-check could observe the
  -- cancellation. When this call carries a checkout idempotency key,
  -- judge the stored order first and refuse a cancelled one outright
  -- (the route maps order_not_reusable to a refresh-checkout 409).
  IF pg_catalog.btrim(COALESCE(p_checkout_idempotency_key, '')) <> '' THEN
    SELECT o.payment_status, o.shipping_status
    INTO v_existing_payment_status, v_existing_shipping_status
    FROM public.orders o
    WHERE o.merchant_id = p_merchant_id
      AND o.checkout_idempotency_key
        = pg_catalog.btrim(p_checkout_idempotency_key)
    FOR UPDATE;
    IF FOUND
       AND (public.loyalty_status_is_cancelled(v_existing_payment_status)
         OR public.loyalty_status_is_cancelled(v_existing_shipping_status))
    THEN
      RAISE EXCEPTION 'order_not_reusable';
    END IF;
  END IF;

  -- Create (or idempotently replay) the order via the unmodified trust-boundary RPC.
  SELECT
    created.id, created.order_number, created.tracking_token, created.subtotal,
    created.shipping_fee, created.discount_amount, created.tax_amount, created.total,
    created.customer_id, created.customer_email, created.customer_name, created.customer_phone,
    created.payment_status, created.shipping_status, created.payment_method, created.shipping_address,
    created.merchant_id, created.tax_basis, created.gift_wrapping_fee, created.idempotency_replayed
  INTO v_order
  FROM public.create_storefront_order(
    p_merchant_id => p_merchant_id, p_customer_email => p_customer_email,
    p_customer_name => p_customer_name, p_items => p_items, p_customer_phone => p_customer_phone,
    p_shipping_fee => p_shipping_fee,
    p_discount_amount => GREATEST(COALESCE(p_discount_amount, 0), 0),
    p_tax_amount => p_tax_amount, p_payment_method => p_payment_method,
    p_payment_status => p_payment_status, p_shipping_status => p_shipping_status,
    p_shipping_address => p_shipping_address, p_source => p_source, p_notes => p_notes,
    p_ad_tracking => p_ad_tracking, p_selected_quote_id => p_selected_quote_id,
    p_shipping_provider => p_shipping_provider, p_tracking_number => p_tracking_number,
    p_user_id => p_user_id, p_tax_basis => p_tax_basis, p_gift_wrapping_fee => p_gift_wrapping_fee,
    p_expected_total => p_expected_total, p_checkout_idempotency_key => p_checkout_idempotency_key,
    p_checkout_request_hash => p_checkout_request_hash
  ) AS created;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'loyalty_order_creation_failed'; END IF;

  -- REPLAY: the order already existed; the first call already enforced
  -- policy and claimed the code, so a legitimate retry returns as-is
  -- WITHOUT re-checking or re-marking — but only while that claim is
  -- still live. A payment-only cancellation (mark_abandoned_orders)
  -- neither blocks the underlying RPC's replay (it reopens the order
  -- as unpaid) nor keeps the claim: the release trigger frees the
  -- code, so returning success here would leave the reopened order's
  -- discount in place while another order claims the same code. A
  -- replay whose claim was released (or whose order is cancelled)
  -- falls through to the FRESH claim below and re-earns the code
  -- under full policy.
  IF v_order.idempotency_replayed
     AND v_redemption.used
     AND v_redemption.used_on_order_id = v_order.id
     AND NOT public.loyalty_status_is_cancelled(v_order.payment_status)
     AND NOT public.loyalty_status_is_cancelled(v_order.shipping_status) THEN
    RETURN QUERY SELECT
      v_order.id, v_order.order_number, v_order.tracking_token, v_order.subtotal,
      v_order.shipping_fee, v_order.discount_amount, v_order.tax_amount, v_order.total,
      v_order.customer_id, v_order.customer_email, v_order.customer_name, v_order.customer_phone,
      v_order.payment_status, v_order.shipping_status, v_order.payment_method, v_order.shipping_address,
      v_order.merchant_id, v_order.tax_basis, v_order.gift_wrapping_fee, v_order.idempotency_replayed;
    RETURN;
  END IF;

  -- FRESH claim: enforce the FULL policy in-DB. Any RAISE rolls the order
  -- back atomically (no orphan order, no consumed code). A claim stamped
  -- to a cancelled order is reusable: the release trigger skips rows
  -- locked by an in-flight retry (SKIP LOCKED), and cancelled is terminal
  -- (reopen clamp), so the status read below cannot go stale.
  IF v_redemption.used THEN
    SELECT o.shipping_status, o.payment_status
    INTO v_claim_order_status, v_claim_payment_status
    FROM public.orders o
    WHERE o.id = v_redemption.used_on_order_id;
    IF NOT public.loyalty_status_is_cancelled(v_claim_order_status)
       AND NOT public.loyalty_status_is_cancelled(v_claim_payment_status) THEN
      RAISE EXCEPTION 'loyalty_code_already_used';
    END IF;
  END IF;
  IF v_redemption.expires_at IS NOT NULL AND v_redemption.expires_at < v_now THEN
    RAISE EXCEPTION 'loyalty_code_expired'; END IF;
  -- No live-enabled check: issued codes are snapshot-governed (see the
  -- resolver), so a later disable or delete cannot strand a paid code.
  -- Only discount-typed codes with a positive value are
  -- checkout-applicable; other types are honored off-checkout.
  IF NOT public.loyalty_reward_is_checkout_discount(
       v_redemption.reward_type, v_redemption.reward_value) THEN
    RAISE EXCEPTION 'loyalty_code_not_applicable'; END IF;

  IF v_redemption.minimum_order_amount IS NOT NULL
     AND v_order.subtotal < v_redemption.minimum_order_amount THEN
    RAISE EXCEPTION 'minimum_purchase_not_met'; END IF;

  -- Fixed codes and positive minimums are denominated in their
  -- issuance currency (stamped at mint): a later merchant currency
  -- change must not re-denominate a paid code against this order's
  -- currency. Minimum-free percentage codes scale with the subtotal
  -- and stay currency-agnostic; unstamped rows keep legacy behavior.
  IF v_redemption.issuance_currency IS NOT NULL
     AND (v_redemption.reward_type IN ('discount', 'discount_fixed')
       OR COALESCE(v_redemption.minimum_order_amount, 0) > 0) THEN
    SELECT o.currency INTO v_order_currency
    FROM public.orders o
    WHERE o.id = v_order.id;
    IF pg_catalog.upper(COALESCE(v_order_currency, '')) IS DISTINCT FROM
       pg_catalog.upper(v_redemption.issuance_currency) THEN
      RAISE EXCEPTION 'loyalty_code_currency_mismatch';
    END IF;
  END IF;

  -- The stored value must be usable for checkout: a legacy
  -- percentage over 100 would otherwise clamp to the full subtotal,
  -- letting a snapshot the issuance classification rejects create a
  -- 100% discount. Previews already hide unusable values; reject the
  -- same way here, before any claim.
  IF NOT public.loyalty_reward_value_is_usable(
       v_redemption.reward_type, v_redemption.reward_value) THEN
    RAISE EXCEPTION 'loyalty_code_not_applicable';
  END IF;

  -- Two-sided amount validation against the AUTHORITATIVE subtotal
  -- (mirror the discount wrapper; plain discounts are fixed by
  -- convention — only discount_percentage is proportional).
  IF v_redemption.reward_type = 'discount_percentage' THEN
    v_expected := pg_catalog.round(v_order.subtotal * v_redemption.reward_value / 100.0, 0);
  ELSE
    v_expected := pg_catalog.round(v_redemption.reward_value, 0);
  END IF;
  v_expected := GREATEST(0, LEAST(v_expected, pg_catalog.round(v_order.subtotal, 0)));

  -- The merchant's maximum redemption percentage, snapshotted at
  -- mint, caps the discount share of the subtotal.
  IF v_redemption.max_redemption_percentage IS NOT NULL THEN
    v_expected := LEAST(v_expected,
      pg_catalog.round(
        v_order.subtotal * v_redemption.max_redemption_percentage / 100.0, 0));
  END IF;

  -- A computed discount of zero must not consume the code: reject
  -- before the claim (percentages and the cap can round to zero on
  -- small subtotals even though the mint rejects zero-value fixed).
  IF v_expected <= 0 THEN
    RAISE EXCEPTION 'loyalty_code_not_applicable'; END IF;

  IF pg_catalog.abs(v_order.discount_amount - v_expected) > 1 THEN
    RAISE EXCEPTION 'discount_amount_mismatch'
      USING DETAIL = pg_catalog.format('applied=%s expected=%s subtotal=%s',
        v_order.discount_amount, v_expected, v_order.subtotal);
  END IF;

  -- Claim the single-use code (the row lock makes the read-check-write
  -- atomic; the predicate keeps a racing claim from double-marking, while
  -- still permitting the cancelled-order steal verified above: the lock
  -- held since the claim check means the stamp cannot have moved).
  UPDATE public.reward_redemptions AS rr
  SET used = true, used_on_order_id = v_order.id, used_at = v_now
  WHERE rr.id = v_redemption.id
    AND (COALESCE(rr.used, false) = false OR rr.used_on_order_id = v_redemption.used_on_order_id);

  RETURN QUERY SELECT
    v_order.id, v_order.order_number, v_order.tracking_token, v_order.subtotal,
    v_order.shipping_fee, v_order.discount_amount, v_order.tax_amount, v_order.total,
    v_order.customer_id, v_order.customer_email, v_order.customer_name, v_order.customer_phone,
    v_order.payment_status, v_order.shipping_status, v_order.payment_method, v_order.shipping_address,
    v_order.merchant_id, v_order.tax_basis, v_order.gift_wrapping_fee, v_order.idempotency_replayed;
END;
$$;

REVOKE ALL ON FUNCTION public.create_storefront_order_with_loyalty_code(
  uuid, text, text, jsonb, text, numeric, numeric, numeric, text, text, text, jsonb,
  text, text, jsonb, uuid, text, text, uuid, text, numeric, numeric, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_storefront_order_with_loyalty_code(
  uuid, text, text, jsonb, text, numeric, numeric, numeric, text, text, text, jsonb,
  text, text, jsonb, uuid, text, text, uuid, text, numeric, numeric, text, text, uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.create_storefront_order_with_loyalty_code(
  uuid, text, text, jsonb, text, numeric, numeric, numeric, text, text, text, jsonb,
  text, text, jsonb, uuid, text, text, uuid, text, numeric, numeric, text, text, uuid) IS
  'Atomically claims a single-use loyalty code while creating the order. Locks the redemption and reward-policy rows; replay-first; for fresh orders enforces unused/unexpired/reward-live/applicable/minimum and a two-sided exact (±1) amount check against the DB subtotal, then marks the code used. Self-policing, so granted to anon.';
