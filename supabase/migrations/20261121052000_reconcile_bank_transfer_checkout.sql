-- Reuse the same checkout lock and shopper authority for both receipts.
CREATE FUNCTION cart_checkout_recovery_private.reconcile_checkout(p_method text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  claims jsonb := auth.jwt();
  checkout public.commerce_cart_checkout_sessions%ROWTYPE;
  authority public.commerce_cart_grants%ROWTYPE;
  cart public.commerce_carts%ROWTYPE;
  application private.uba_redvault_applications%ROWTYPE;
  order_row public.orders%ROWTYPE;
  customer_user_id uuid;
  unavailable jsonb := pg_catalog.jsonb_build_object('kind', 'unavailable');
  result jsonb;
BEGIN
  IF claims->>'role' IS DISTINCT FROM 'commerce_cart_shopper'
    OR claims->>'cart_scope' IS DISTINCT FROM 'checkout_recovery'
    OR coalesce(claims->>'exp', '') !~ '^[0-9]{1,12}$'
    OR (claims->>'exp')::numeric <= extract(epoch FROM pg_catalog.clock_timestamp())
    OR coalesce(claims->>'cart_recovery_key_hash', '') !~ '^[a-f0-9]{64}$'
    OR coalesce(claims->>'cart_recovery_generation', '') !~ '^[1-9][0-9]{0,8}$'
    OR coalesce(claims->>'cart_recovery_version', '') !~ '^[1-9][0-9]{0,8}$'
    OR nullif(claims->>'cart_recovery_email', '') IS NULL
    OR nullif(claims->>'cart_recovery_user_id', '') IS NULL
    OR nullif(claims->>'cart_principal_id', '') IS NULL THEN
    RETURN unavailable;
  END IF;

  -- This is the same first lock used by the bound order RPC. Retiring the
  -- row while holding it prevents even an earlier-started transaction from
  -- submitting the old session after the response permits a fresh review.
  SELECT * INTO checkout FROM public.commerce_cart_checkout_sessions
  WHERE id = (claims->>'cart_recovery_session_id')::uuid FOR UPDATE;
  IF NOT FOUND
    OR checkout.merchant_id IS DISTINCT FROM (claims->>'cart_merchant_id')::uuid
    OR checkout.cart_id IS DISTINCT FROM (claims->>'cart_id')::uuid
    OR checkout.preparing_grant_id IS DISTINCT FROM (claims->>'cart_grant_id')::uuid
    OR checkout.principal_id IS DISTINCT FROM claims->>'cart_principal_id'
    OR checkout.checkout_generation IS DISTINCT FROM (claims->>'cart_recovery_generation')::integer
    OR checkout.cart_version_reviewed IS DISTINCT FROM (claims->>'cart_recovery_version')::integer THEN
    RETURN unavailable;
  END IF;

  SELECT * INTO authority FROM public.commerce_cart_grants
  WHERE id = checkout.preparing_grant_id;
  IF NOT FOUND THEN RETURN unavailable; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'cc-device-revoke|' || checkout.merchant_id::text || '|' ||
      coalesce(authority.device_principal_id, authority.principal_id), 0));
  SELECT * INTO cart FROM public.commerce_carts
  WHERE id = checkout.cart_id AND merchant_id = checkout.merchant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN unavailable; END IF;
  PERFORM 1 FROM public.commerce_cart_grants g
  WHERE g.id = checkout.preparing_grant_id AND g.cart_id = checkout.cart_id
    AND g.merchant_id = checkout.merchant_id AND g.principal_id = checkout.principal_id
    AND g.revoked_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.commerce_cart_device_retirements retired
      WHERE retired.merchant_id = g.merchant_id
        AND retired.device_principal_id = coalesce(g.device_principal_id, g.principal_id))
  FOR UPDATE;
  IF NOT FOUND THEN RETURN unavailable; END IF;

  IF p_method = 'bank_transfer' THEN
    -- A still-active session is an unknown outcome. A late order write
    -- may still commit, so this branch never authorizes a second order.
    IF checkout.status <> 'submitted' OR cart.state IS DISTINCT FROM 'completed'
      OR checkout.result->'binding'->>'variant' IS DISTINCT FROM 'base' THEN
      RETURN unavailable;
    END IF;
    SELECT * INTO order_row FROM public.orders o
    WHERE o.id = checkout.order_id AND o.merchant_id = checkout.merchant_id
      AND o.payment_method = 'bank_transfer'
      AND o.payment_status IN ('unpaid', 'pending')
      AND lower(o.shipping_status) NOT IN ('cancelled', 'canceled')
      AND o.currency = 'NGN'
      AND o.total > 0 AND coalesce(o.amount_paid, 0) = 0
      AND coalesce(o.wallet_amount_used, 0) = 0
      AND nullif(o.tracking_token, '') IS NOT NULL
      AND lower(btrim(o.customer_email)) = claims->>'cart_recovery_email'
      AND pg_catalog.encode(extensions.digest(o.checkout_idempotency_key, 'sha256'), 'hex')
        = claims->>'cart_recovery_key_hash';
    IF NOT FOUND THEN RETURN unavailable; END IF;

    SELECT c.user_id INTO customer_user_id FROM public.customers c
    WHERE c.id = order_row.customer_id AND c.merchant_id = checkout.merchant_id;
    IF NOT FOUND OR coalesce(customer_user_id::text, 'guest')
      IS DISTINCT FROM claims->>'cart_recovery_user_id' THEN
      RETURN unavailable;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'kind', 'submitted',
      'order', pg_catalog.jsonb_build_object(
        'id', order_row.id, 'order_number', order_row.order_number,
        'tracking_token', order_row.tracking_token, 'currency', order_row.currency
      ),
      'amountDueToGateway', order_row.total
    );
  END IF;

  IF p_method IS DISTINCT FROM 'uba_redvault' THEN RETURN unavailable; END IF;
  IF checkout.status = 'submitted' THEN
    IF checkout.result->'binding'->>'variant' IS DISTINCT FROM 'redvault' THEN
      RETURN unavailable;
    END IF;
    SELECT * INTO application FROM private.uba_redvault_applications
    WHERE order_id = checkout.order_id AND merchant_id = checkout.merchant_id;
    IF NOT FOUND OR application.status IS DISTINCT FROM 'pending'
      OR application.customer_email IS DISTINCT FROM claims->>'cart_recovery_email'
      OR coalesce(application.user_id::text, 'guest') IS DISTINCT FROM claims->>'cart_recovery_user_id'
      OR pg_catalog.encode(extensions.digest(application.checkout_key, 'sha256'), 'hex')
        IS DISTINCT FROM claims->>'cart_recovery_key_hash'
      OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = checkout.order_id
        AND o.merchant_id = checkout.merchant_id AND o.payment_method = 'uba_redvault'
        AND o.payment_status = 'unpaid') THEN
      RETURN unavailable;
    END IF;
    RETURN pg_catalog.jsonb_build_object('kind', 'submitted', 'orderId', checkout.order_id);
  END IF;

  IF checkout.status NOT IN ('active', 'retired') OR cart.state IS DISTINCT FROM 'active' THEN
    RETURN unavailable;
  END IF;
  IF checkout.status = 'active' THEN
    UPDATE public.commerce_cart_checkout_sessions SET status = 'retired'
    WHERE id = checkout.id;
  END IF;
  result := pg_catalog.jsonb_build_object(
    'kind', 'retired', 'cartId', checkout.cart_id,
    'checkoutSessionId', checkout.id, 'checkoutGeneration', checkout.checkout_generation
  );
  RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN unavailable;
END;
$$;
ALTER FUNCTION cart_checkout_recovery_private.reconcile_checkout(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION cart_checkout_recovery_private.reconcile_checkout(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION cart_checkout_recovery_private.reconcile_redvault_checkout()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT cart_checkout_recovery_private.reconcile_checkout('uba_redvault')
$$;

CREATE FUNCTION cart_checkout_recovery_private.reconcile_bank_transfer_checkout()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT cart_checkout_recovery_private.reconcile_checkout('bank_transfer')
$$;
ALTER FUNCTION cart_checkout_recovery_private.reconcile_bank_transfer_checkout() OWNER TO postgres;
REVOKE ALL ON FUNCTION cart_checkout_recovery_private.reconcile_bank_transfer_checkout()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION cart_checkout_recovery_private.reconcile_bank_transfer_checkout()
  TO commerce_cart_shopper;

CREATE FUNCTION public.commerce_cart_reconcile_bank_transfer_checkout()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT cart_checkout_recovery_private.reconcile_bank_transfer_checkout()
$$;
REVOKE ALL ON FUNCTION public.commerce_cart_reconcile_bank_transfer_checkout()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commerce_cart_reconcile_bank_transfer_checkout()
  TO commerce_cart_shopper;
NOTIFY pgrst, 'reload schema';
