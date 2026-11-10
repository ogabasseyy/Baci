-- Compatibility stage: deploy before the web/mobile read-path release.
-- This does NOT revoke products.cost_price yet. See the explicit cutover in
-- supabase/operations/revoke-products-cost-price.sql after client verification.
BEGIN;

-- RLS cannot hide a column on otherwise public product rows. This read-only
-- owner-rights view has its own caller-bound authorization predicate. Do not
-- enable security_invoker: the caller will intentionally lose cost SELECT.
-- Expand the current catalog into explicit columns (including existing FK
-- columns, so PostgREST can infer embedded product relationships).
DO $$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(format('p.%I', a.attname), ', ' ORDER BY a.attnum)
    INTO v_columns
  FROM pg_attribute AS a
  WHERE a.attrelid = 'public.products'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped;

  IF v_columns IS NULL THEN
    RAISE EXCEPTION 'products schema is missing';
  END IF;

  EXECUTE format(
    'CREATE VIEW public.merchant_products WITH (security_barrier = true, security_invoker = false) AS '
    'SELECT %s FROM public.products AS p '
    'WHERE public.check_staff_permission((SELECT auth.uid()), p.merchant_id, ''products'', ''view'')',
    v_columns
  );
END;
$$;

-- Supabase default privileges can otherwise make an updatable view writable.
-- Writes must continue through products and its existing write RLS policies.
REVOKE ALL ON TABLE public.merchant_products FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.merchant_products TO authenticated;
COMMENT ON VIEW public.merchant_products IS
  'Read-only product projection for the owner or active staff with products:view. Contains private cost prices; never use for public storefront reads.';

NOTIFY pgrst, 'reload schema';
COMMIT;
