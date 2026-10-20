-- The entrypoint body squash (20261020090000) pins owner + EXECUTE grants
-- in its pre/post-image guards because pg_get_functiondef omits them while
-- CREATE OR REPLACE preserves them. Pin the same 20260828 shape here so a
-- future migration that re-grants either SECURITY DEFINER entrypoint fails
-- loudly in replay. No body hashes are pinned here: fix1/fix3 will
-- legitimately change bodies, while owner and grants must stay put.
-- NOTE: the guards' not-found fail-closed branch is owned by the Vitest
-- structural test over the migration text (a SQL suite cannot invoke the
-- migration's guard logic); this file asserts live-catalog state only.
DO $$ DECLARE
  v_checked_oid oid;
  v_unchecked_oid oid;
BEGIN
  SELECT p.oid INTO v_checked_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.proname = 'create_storefront_order'
    AND p.pronargs = 24
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_merchant_id uuid, p_customer_email text, p_customer_name text, p_items jsonb, p_customer_phone text, p_shipping_fee numeric, p_discount_amount numeric, p_tax_amount numeric, p_payment_method text, p_payment_status text, p_shipping_status text, p_shipping_address jsonb, p_source text, p_notes text, p_ad_tracking jsonb, p_selected_quote_id uuid, p_shipping_provider text, p_tracking_number text, p_user_id uuid, p_tax_basis text, p_gift_wrapping_fee numeric, p_expected_total numeric, p_checkout_idempotency_key text, p_checkout_request_hash text';
  IF v_checked_oid IS NULL THEN
    RAISE EXCEPTION 'create_storefront_order(24) not found';
  END IF;

  SELECT p.oid INTO v_unchecked_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.proname = 'create_storefront_order_unchecked'
    AND p.pronargs = 24
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_merchant_id uuid, p_customer_email text, p_customer_name text, p_items jsonb, p_customer_phone text, p_shipping_fee numeric, p_discount_amount numeric, p_tax_amount numeric, p_payment_method text, p_payment_status text, p_shipping_status text, p_shipping_address jsonb, p_source text, p_notes text, p_ad_tracking jsonb, p_selected_quote_id uuid, p_shipping_provider text, p_tracking_number text, p_user_id uuid, p_tax_basis text, p_gift_wrapping_fee numeric, p_expected_total numeric, p_checkout_idempotency_key text, p_checkout_request_hash text';
  IF v_unchecked_oid IS NULL THEN
    RAISE EXCEPTION 'create_storefront_order_unchecked(24) not found';
  END IF;

  IF pg_catalog.pg_get_userbyid((SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_checked_oid)) <> 'postgres' THEN
    RAISE EXCEPTION 'checked entry point owner drifted from postgres';
  END IF;
  IF pg_catalog.pg_get_userbyid((SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_unchecked_oid)) <> 'postgres' THEN
    RAISE EXCEPTION 'unchecked entry point owner drifted from postgres';
  END IF;

  -- Exact ACL pins (mirrors the migration guards): any extra grantee,
  -- privilege, grantor, or grant-option bit fails. NULL proacl explodes
  -- to zero rows, so the cardinality also rejects default PUBLIC EXECUTE.
  IF (SELECT count(*)
      FROM pg_catalog.aclexplode((SELECT proacl FROM pg_catalog.pg_proc WHERE oid = v_checked_oid))) <> 4
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode((SELECT proacl FROM pg_catalog.pg_proc WHERE oid = v_checked_oid)) AS a
        WHERE a.privilege_type <> 'EXECUTE'
          OR a.is_grantable
          OR a.grantor <> 'postgres'::regrole
          OR a.grantee NOT IN ('postgres'::regrole, 'anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
      ) THEN
    RAISE EXCEPTION 'checked entry point ACL differs (want exactly postgres/anon/authenticated/service_role EXECUTE, no grant option)';
  END IF;

  IF (SELECT count(*)
      FROM pg_catalog.aclexplode((SELECT proacl FROM pg_catalog.pg_proc WHERE oid = v_unchecked_oid))) <> 1
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode((SELECT proacl FROM pg_catalog.pg_proc WHERE oid = v_unchecked_oid)) AS a
        WHERE a.privilege_type <> 'EXECUTE'
          OR a.is_grantable
          OR a.grantor <> 'postgres'::regrole
          OR a.grantee <> 'postgres'::regrole
      ) THEN
    RAISE EXCEPTION 'unchecked entry point ACL differs (want owner-only EXECUTE, no grant option)';
  END IF;
END;
$$;
