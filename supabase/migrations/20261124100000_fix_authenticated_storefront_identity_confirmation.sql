-- Keep the advisory lock helper's guest confirmation limited to guest calls.
-- Authenticated RPC callers may omit p_user_id; the unchecked body normalizes
-- that omission from auth.uid(), so this pre-lock wrapper must do the same.
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
  -- let the caller retry with a fresh identity snapshot. auth.uid() is the
  -- effective identity when an authenticated caller omits p_user_id.
  IF auth.uid() IS NULL AND p_user_id IS NULL THEN
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
