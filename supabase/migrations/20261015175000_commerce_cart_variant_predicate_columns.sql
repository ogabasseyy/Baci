-- Remove nonexistent variant lifecycle columns from the final order
-- and checkout-snapshot RPCs: product_variants has no is_active,
-- status, deleted_at, or archived_at columns (availability is the
-- is_inventory_anchor policy), so the first planned execution of these
-- joins would raise undefined_column and block order creation. The
-- definitions are patched textually, preserving every later amendment.
DO $repair$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition
  FROM pg_proc p
  WHERE p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'private')
    AND p.proname = 'create_storefront_order_unchecked'
  LIMIT 1;
  IF definition IS NULL OR position('v.is_active' IN definition) = 0 THEN
    RETURN;
  END IF;
  definition := replace(definition,
    'AND coalesce(v.is_active,true) AND v.status=''active'' AND v.deleted_at IS NULL AND v.archived_at IS NULL',
    '');
  IF position('v.is_active' IN definition) <> 0 THEN
    RAISE EXCEPTION 'variant predicate patch did not apply to create_storefront_order_unchecked';
  END IF;
  EXECUTE definition;
END $repair$;

DO $repair$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition
  FROM pg_proc p
  WHERE p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    AND p.proname = 'commerce_cart_build_checkout_snapshot'
  LIMIT 1;
  IF definition IS NULL OR position('v.is_active' IN definition) = 0 THEN
    RETURN;
  END IF;
  definition := replace(definition,
    'AND coalesce(v.is_active, true)
            AND v.status = ''active''
            AND v.deleted_at IS NULL
            AND v.archived_at IS NULL
            ', '');
  IF position('v.is_active' IN definition) <> 0 THEN
    RAISE EXCEPTION 'variant predicate patch did not apply to commerce_cart_build_checkout_snapshot';
  END IF;
  EXECUTE definition;
END $repair$;
