-- Regression: the final order and checkout-snapshot RPCs must not
-- reference variant lifecycle columns that do not exist.
DO $regression$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'private')
      AND p.proname = 'create_storefront_order_unchecked'
      AND pg_get_functiondef(p.oid) LIKE '%v.is_active%'
  ) THEN
    RAISE EXCEPTION 'order RPC still references nonexistent variant columns';
  END IF;
  IF pg_get_functiondef(
    (SELECT p.oid FROM pg_proc p
     WHERE p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
       AND p.proname = 'commerce_cart_build_checkout_snapshot' LIMIT 1)
  ) LIKE '%v.is_active%' THEN
    RAISE EXCEPTION 'snapshot RPC still references nonexistent variant columns';
  END IF;
END $regression$;

DO $regression$
BEGIN
  IF pg_get_functiondef(
    'public.commerce_cart_mutate_authorized_impl(uuid, text, integer, jsonb)'::regprocedure
  ) NOT LIKE '%cart_shared_clear_guard%' THEN
    RAISE EXCEPTION 'shared clear guard missing from mutate implementation';
  END IF;
END $regression$;

SELECT 'variant predicates ok' AS commerce_cart_variant_predicates;
