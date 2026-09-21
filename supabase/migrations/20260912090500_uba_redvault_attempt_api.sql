ALTER TABLE private.uba_redvault_runtime ADD COLUMN IF NOT EXISTS paystack_bank_code text;
ALTER TABLE private.uba_redvault_payment_attempts ADD COLUMN IF NOT EXISTS authorization_url text;
ALTER TABLE private.uba_redvault_payment_attempts DROP CONSTRAINT IF EXISTS uba_redvault_payment_attempts_state_check;
ALTER TABLE private.uba_redvault_payment_attempts ADD CONSTRAINT uba_redvault_payment_attempts_state_check
  CHECK (state IN ('created','initializing','initialized','indeterminate','captured_held','approved','superseded','void'));
DROP INDEX IF EXISTS private.uba_redvault_live_attempt_per_application;
CREATE UNIQUE INDEX uba_redvault_live_attempt_per_application ON private.uba_redvault_payment_attempts(application_id)
  WHERE state IN ('created','initializing','initialized','indeterminate');

DROP FUNCTION IF EXISTS public.get_order_payment_snapshot(uuid, text);
CREATE FUNCTION public.get_order_payment_snapshot(p_order_id uuid, p_email text)
RETURNS TABLE(merchant_id uuid, total numeric, currency text, tracking_token text, shipping_status text, payment_status text, merchant_country text, payment_method text)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT o.merchant_id, o.total, o.currency, o.tracking_token, o.shipping_status, o.payment_status, m.country, o.payment_method
  FROM public.orders AS o
  JOIN public.merchants AS m ON m.id = o.merchant_id
  WHERE o.id = p_order_id
    AND pg_catalog.lower(o.customer_email) = pg_catalog.lower(pg_catalog.btrim(p_email))
  LIMIT 1;
$$;
ALTER FUNCTION public.get_order_payment_snapshot(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_order_payment_snapshot(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_payment_snapshot(uuid, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_storefront_redvault_checkout_summary(p_order_id uuid)
RETURNS TABLE (
  order_id uuid,
  total numeric,
  currency text,
  tracking_token text,
  payment_method text,
  payment_status text,
  product_subtotal_kobo bigint,
  eligible_subtotal_kobo bigint,
  ineligible_subtotal_kobo bigint,
  discount_kobo bigint,
  tax_kobo bigint,
  shipping_kobo bigint,
  gift_wrapping_kobo bigint,
  payable_kobo bigint,
  mixed_basket boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  application private.uba_redvault_applications%ROWTYPE;
  persisted_order public.orders%ROWTYPE;
  product_subtotal bigint;
  eligible_subtotal bigint;
  persisted_discount bigint;
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route' THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;

  SELECT * INTO application
  FROM private.uba_redvault_applications AS candidate_application
  WHERE candidate_application.order_id = p_order_id
  FOR SHARE;
  IF NOT FOUND
    OR application.status <> 'pending'
    OR application.merchant_id::text IS DISTINCT FROM auth.jwt()->>'storefront_order_merchant_id'
    OR application.customer_email IS DISTINCT FROM auth.jwt()->>'storefront_redvault_customer_email'
    OR application.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'redvault_customer_context_required';
  END IF;

  SELECT * INTO persisted_order
  FROM public.orders AS candidate_order
  WHERE candidate_order.id = application.order_id
  FOR SHARE;
  IF NOT FOUND
    OR persisted_order.merchant_id IS DISTINCT FROM application.merchant_id
    OR pg_catalog.lower(pg_catalog.btrim(persisted_order.customer_email)) IS DISTINCT FROM application.customer_email
    OR persisted_order.payment_method <> 'uba_redvault'
    OR persisted_order.payment_status <> 'unpaid'
    OR persisted_order.currency IS NULL
    OR persisted_order.total IS NULL THEN
    RAISE EXCEPTION 'redvault_order_snapshot_mismatch';
  END IF;

  IF COALESCE(application.quote_payload->>'productSubtotalKobo', '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'redvault_quote_invalid';
  END IF;
  product_subtotal := (application.quote_payload->>'productSubtotalKobo')::bigint;
  eligible_subtotal := application.eligible_subtotal_kobo;
  persisted_discount := pg_catalog.round(persisted_order.discount_amount * 100)::bigint;
  IF product_subtotal < eligible_subtotal
    OR persisted_discount <> application.discount_kobo
    OR pg_catalog.round(persisted_order.subtotal * 100)::bigint <> product_subtotal
    OR pg_catalog.round(persisted_order.total * 100)::bigint < 0 THEN
    RAISE EXCEPTION 'redvault_order_snapshot_mismatch';
  END IF;

  RETURN QUERY SELECT
    persisted_order.id,
    persisted_order.total,
    persisted_order.currency,
    persisted_order.tracking_token,
    persisted_order.payment_method,
    persisted_order.payment_status,
    product_subtotal,
    eligible_subtotal,
    product_subtotal - eligible_subtotal,
    application.discount_kobo,
    pg_catalog.round(COALESCE(persisted_order.tax_amount, 0) * 100)::bigint,
    pg_catalog.round(COALESCE(persisted_order.shipping_fee, 0) * 100)::bigint,
    pg_catalog.round(COALESCE(persisted_order.gift_wrapping_fee, 0) * 100)::bigint,
    pg_catalog.round(persisted_order.total * 100)::bigint,
    product_subtotal > eligible_subtotal;
END;
$$;
ALTER FUNCTION public.get_storefront_redvault_checkout_summary(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_storefront_redvault_checkout_summary(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_redvault_checkout_summary(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reserve_storefront_redvault_payment_attempt(p_order_id uuid)
RETURNS TABLE (attempt_id uuid, reference text, amount_kobo bigint, currency text, quote_payload_hash text, state text, bank_code text, authorization_url text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE application private.uba_redvault_applications%ROWTYPE; runtime private.uba_redvault_runtime%ROWTYPE; attempt private.uba_redvault_payment_attempts%ROWTYPE;
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route' THEN RAISE EXCEPTION 'redvault_route_context_required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0));
  SELECT * INTO attempt FROM private.uba_redvault_payment_attempts AS candidate
    WHERE candidate.order_id = p_order_id AND candidate.state IN ('created','initializing','initialized','indeterminate')
    ORDER BY candidate.created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO application FROM private.uba_redvault_applications WHERE id = attempt.application_id FOR SHARE;
  ELSE
    SELECT * INTO application FROM private.uba_redvault_applications WHERE order_id = p_order_id FOR UPDATE;
  END IF;
  IF NOT FOUND OR application.status <> 'pending' OR application.merchant_id::text IS DISTINCT FROM auth.jwt()->>'storefront_order_merchant_id'
    OR application.customer_email IS DISTINCT FROM auth.jwt()->>'storefront_redvault_customer_email' OR application.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'redvault_customer_context_required'; END IF;
  SELECT * INTO runtime FROM private.uba_redvault_runtime WHERE partnership='uba_redvault' FOR SHARE;
  IF NOT FOUND OR NOT runtime.enabled THEN RAISE EXCEPTION 'redvault_disabled'; END IF;
  IF runtime.paystack_bank_code IS NULL OR runtime.paystack_bank_code !~ '^[0-9]{3}$' THEN RAISE EXCEPTION 'redvault_bank_filter_unconfigured'; END IF;
  IF attempt.id IS NULL THEN
    INSERT INTO private.uba_redvault_payment_attempts(application_id,order_id,merchant_id,reference,quote_payload_hash,amount_kobo,currency,state)
    SELECT application.id,application.order_id,application.merchant_id,'RV-'||replace(extensions.gen_random_uuid()::text,'-',''),application.quote_payload_hash,round(orders.total*100)::bigint,'NGN','created' FROM public.orders WHERE id=application.order_id AND payment_method='uba_redvault' AND payment_status='unpaid'
    RETURNING * INTO attempt;
    IF NOT FOUND THEN RAISE EXCEPTION 'redvault_order_snapshot_mismatch'; END IF;
  END IF;
  RETURN QUERY SELECT attempt.id,attempt.reference,attempt.amount_kobo,attempt.currency,attempt.quote_payload_hash,attempt.state,runtime.paystack_bank_code,attempt.authorization_url;
END; $$;
ALTER FUNCTION public.reserve_storefront_redvault_payment_attempt(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_storefront_redvault_payment_attempt(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_storefront_redvault_payment_attempt(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_storefront_redvault_payment_attempt_initialization(p_attempt_id uuid)
RETURNS TABLE (attempt_id uuid, reference text, amount_kobo bigint, currency text, quote_payload_hash text, state text, bank_code text, authorization_url text, initialization_claimed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE application private.uba_redvault_applications%ROWTYPE; runtime private.uba_redvault_runtime%ROWTYPE; attempt private.uba_redvault_payment_attempts%ROWTYPE; attempt_order_id uuid;
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route' THEN RAISE EXCEPTION 'redvault_route_context_required'; END IF;
  SELECT order_id INTO attempt_order_id FROM private.uba_redvault_payment_attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'redvault_attempt_not_found'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('baci_order_payment:' || attempt_order_id::text, 0));
  SELECT * INTO attempt FROM private.uba_redvault_payment_attempts WHERE id = p_attempt_id FOR UPDATE;
  SELECT * INTO application FROM private.uba_redvault_applications WHERE id = attempt.application_id FOR SHARE;
  IF NOT FOUND OR application.status <> 'pending' OR application.merchant_id::text IS DISTINCT FROM auth.jwt()->>'storefront_order_merchant_id'
    OR application.customer_email IS DISTINCT FROM auth.jwt()->>'storefront_redvault_customer_email' OR application.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'redvault_customer_context_required'; END IF;
  SELECT * INTO runtime FROM private.uba_redvault_runtime WHERE partnership = 'uba_redvault' FOR SHARE;
  IF NOT FOUND OR runtime.paystack_bank_code IS NULL OR runtime.paystack_bank_code !~ '^[0-9]{3}$' THEN RAISE EXCEPTION 'redvault_bank_filter_unconfigured'; END IF;

  IF attempt.state = 'created' THEN
    UPDATE private.uba_redvault_payment_attempts SET state = 'initializing' WHERE id = attempt.id RETURNING * INTO attempt;
    RETURN QUERY SELECT attempt.id,attempt.reference,attempt.amount_kobo,attempt.currency,attempt.quote_payload_hash,attempt.state,runtime.paystack_bank_code,attempt.authorization_url,true;
    RETURN;
  END IF;
  RETURN QUERY SELECT attempt.id,attempt.reference,attempt.amount_kobo,attempt.currency,attempt.quote_payload_hash,attempt.state,runtime.paystack_bank_code,attempt.authorization_url,false;
END; $$;
ALTER FUNCTION public.claim_storefront_redvault_payment_attempt_initialization(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_storefront_redvault_payment_attempt_initialization(
  p_attempt_id uuid,
  p_state text,
  p_authorization_url text
)
RETURNS TABLE (attempt_id uuid, reference text, amount_kobo bigint, currency text, quote_payload_hash text, state text, bank_code text, authorization_url text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE application private.uba_redvault_applications%ROWTYPE; runtime private.uba_redvault_runtime%ROWTYPE; attempt private.uba_redvault_payment_attempts%ROWTYPE; attempt_order_id uuid;
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route' THEN RAISE EXCEPTION 'redvault_route_context_required'; END IF;
  IF p_state NOT IN ('initialized', 'indeterminate') THEN RAISE EXCEPTION 'redvault_attempt_state_invalid'; END IF;
  IF (p_state = 'initialized' AND (p_authorization_url IS NULL OR p_authorization_url !~ '^https://[^[:space:]]+$'))
    OR (p_state = 'indeterminate' AND p_authorization_url IS NOT NULL) THEN RAISE EXCEPTION 'redvault_attempt_url_invalid'; END IF;

  SELECT order_id INTO attempt_order_id FROM private.uba_redvault_payment_attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'redvault_attempt_not_found'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('baci_order_payment:' || attempt_order_id::text, 0));
  SELECT * INTO attempt FROM private.uba_redvault_payment_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redvault_attempt_not_found'; END IF;
  SELECT * INTO application FROM private.uba_redvault_applications WHERE id = attempt.application_id FOR SHARE;
  IF NOT FOUND OR application.status <> 'pending' OR application.merchant_id::text IS DISTINCT FROM auth.jwt()->>'storefront_order_merchant_id'
    OR application.customer_email IS DISTINCT FROM auth.jwt()->>'storefront_redvault_customer_email' OR application.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'redvault_customer_context_required'; END IF;
  SELECT * INTO runtime FROM private.uba_redvault_runtime WHERE partnership = 'uba_redvault' FOR SHARE;
  IF NOT FOUND OR runtime.paystack_bank_code IS NULL OR runtime.paystack_bank_code !~ '^[0-9]{3}$' THEN RAISE EXCEPTION 'redvault_bank_filter_unconfigured'; END IF;

  IF attempt.state = 'initializing' THEN
    UPDATE private.uba_redvault_payment_attempts
    SET state = p_state,
        authorization_url = CASE WHEN p_state = 'initialized' THEN p_authorization_url ELSE NULL END,
        initialized_at = CASE WHEN p_state = 'initialized' THEN now() ELSE initialized_at END
    WHERE id = attempt.id
    RETURNING * INTO attempt;
  ELSIF attempt.state = 'initialized' AND p_state = 'initialized' AND attempt.authorization_url = p_authorization_url THEN
    NULL;
  ELSIF attempt.state = 'indeterminate' AND p_state = 'indeterminate' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'redvault_attempt_not_mutable';
  END IF;

  RETURN QUERY SELECT attempt.id,attempt.reference,attempt.amount_kobo,attempt.currency,attempt.quote_payload_hash,attempt.state,runtime.paystack_bank_code,attempt.authorization_url;
END; $$;
ALTER FUNCTION public.record_storefront_redvault_payment_attempt_initialization(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_storefront_redvault_payment_attempt_initialization(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_storefront_redvault_payment_attempt_initialization(uuid, text, text) TO authenticated;
