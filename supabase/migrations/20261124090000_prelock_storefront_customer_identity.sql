-- Resolve and acquire the complete customer identity lock set before the
-- checkout body takes its email lock. Guest checkout can match a registered
-- customer by phone or email; without this pre-lock, the order INSERT trigger
-- would acquire that customer's user lock after checkout already held email,
-- opposite to authenticated checkout's user-then-email order.
CREATE OR REPLACE FUNCTION private.lock_storefront_order_entrypoint_identity(
  p_merchant_id uuid,
  p_user_id uuid,
  p_customer_email text,
  p_customer_phone text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := coalesce(auth.uid(), p_user_id);
  v_customer_id uuid;
  v_confirmed_customer_id uuid;
  v_confirmed_user_id uuid;
  v_email text := nullif(lower(btrim(p_customer_email)), '');
  v_phone text := nullif(btrim(p_customer_phone), '');
BEGIN
  IF v_phone IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(p_merchant_id::text), pg_catalog.hashtext(v_phone)
    );
  END IF;

  IF v_user_id IS NULL AND v_phone IS NOT NULL THEN
    SELECT c.id, c.user_id INTO v_customer_id, v_user_id
    FROM public.customers c
    WHERE c.merchant_id = p_merchant_id AND c.phone = v_phone
    ORDER BY c.id
    LIMIT 1;
  END IF;

  IF v_user_id IS NULL AND v_customer_id IS NULL AND v_email IS NOT NULL THEN
    SELECT c.id, c.user_id INTO v_customer_id, v_user_id
    FROM public.customers c
    WHERE c.merchant_id = p_merchant_id AND lower(c.email) = v_email
    ORDER BY c.id
    LIMIT 1;
  END IF;

  IF v_user_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_merchant_id::text || ':' || v_user_id::text, 0)
    );
  END IF;

  IF v_email IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_merchant_id::text || ':' || v_email, 1)
    );
  END IF;

  -- The preliminary guest lookup intentionally happens before the email lock
  -- so we can respect user-before-email ordering. Confirm it again once all
  -- locks are held; if customer identity changed in between, fail safely and
  -- let the caller retry with a fresh identity snapshot.
  IF p_user_id IS NULL THEN
    IF v_phone IS NOT NULL THEN
      SELECT c.id, c.user_id INTO v_confirmed_customer_id, v_confirmed_user_id
      FROM public.customers c
      WHERE c.merchant_id = p_merchant_id AND c.phone = v_phone
      ORDER BY c.id
      LIMIT 1;
    END IF;
    IF v_confirmed_customer_id IS NULL AND v_email IS NOT NULL THEN
      SELECT c.id, c.user_id INTO v_confirmed_customer_id, v_confirmed_user_id
      FROM public.customers c
      WHERE c.merchant_id = p_merchant_id AND lower(c.email) = v_email
      ORDER BY c.id
      LIMIT 1;
    END IF;
    IF v_confirmed_customer_id IS DISTINCT FROM v_customer_id
      OR v_confirmed_user_id IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'customer_identity_changed_retry';
    END IF;
  END IF;
END;
$$;

ALTER FUNCTION private.lock_storefront_order_entrypoint_identity(uuid, uuid, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.lock_storefront_order_entrypoint_identity(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.create_storefront_order(
  p_merchant_id uuid,
  p_customer_email text,
  p_customer_name text,
  p_items jsonb,
  p_customer_phone text DEFAULT NULL::text,
  p_shipping_fee numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT 0,
  p_tax_amount numeric DEFAULT 0,
  p_payment_method text DEFAULT 'card'::text,
  p_payment_status text DEFAULT 'unpaid'::text,
  p_shipping_status text DEFAULT 'pending'::text,
  p_shipping_address jsonb DEFAULT NULL::jsonb,
  p_source text DEFAULT 'online_store'::text,
  p_notes text DEFAULT NULL::text,
  p_ad_tracking jsonb DEFAULT NULL::jsonb,
  p_selected_quote_id uuid DEFAULT NULL::uuid,
  p_shipping_provider text DEFAULT NULL::text,
  p_tracking_number text DEFAULT NULL::text,
  p_user_id uuid DEFAULT NULL::uuid,
  p_tax_basis text DEFAULT 'exclusive'::text,
  p_gift_wrapping_fee numeric DEFAULT 0,
  p_expected_total numeric DEFAULT NULL::numeric,
  p_checkout_idempotency_key text DEFAULT NULL::text,
  p_checkout_request_hash text DEFAULT NULL::text
)
RETURNS TABLE(
  id uuid, order_number text, tracking_token text, subtotal numeric,
  shipping_fee numeric, discount_amount numeric, tax_amount numeric,
  total numeric, customer_id uuid, customer_email text, customer_name text,
  customer_phone text, payment_status text, shipping_status text,
  payment_method text, shipping_address jsonb, merchant_id uuid,
  tax_basis text, gift_wrapping_fee numeric, idempotency_replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.lock_storefront_order_entrypoint_identity(
    p_merchant_id, p_user_id, p_customer_email, p_customer_phone
  );

  PERFORM pg_catalog.set_config(
    'baci.storefront_order_replay_context', 'create_storefront_order', true
  );

  RETURN QUERY
  SELECT *
  FROM private.create_storefront_order_unchecked(
    p_merchant_id, p_customer_email, p_customer_name, p_items,
    p_customer_phone, p_shipping_fee, p_discount_amount, p_tax_amount,
    p_payment_method, p_payment_status, p_shipping_status, p_shipping_address,
    p_source, p_notes, p_ad_tracking, p_selected_quote_id,
    p_shipping_provider, p_tracking_number, p_user_id, p_tax_basis,
    p_gift_wrapping_fee, p_expected_total, p_checkout_idempotency_key,
    p_checkout_request_hash
  );
END;
$$;

ALTER FUNCTION private.create_storefront_order(
  uuid, text, text, jsonb, text, numeric, numeric, numeric, text, text, text,
  jsonb, text, text, jsonb, uuid, text, text, uuid, text, numeric, numeric,
  text, text
) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION private.create_storefront_order(
  uuid, text, text, jsonb, text, numeric, numeric, numeric, text, text, text,
  jsonb, text, text, jsonb, uuid, text, text, uuid, text, numeric, numeric,
  text, text
) TO anon, authenticated, service_role;
