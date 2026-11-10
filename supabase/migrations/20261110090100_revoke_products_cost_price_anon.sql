-- ============================================================================
-- Contain products.cost_price: anon column-grant allow-list
-- ============================================================================
-- LIVE LEAK (confirmed on production 2026-11-10): anon holds table-level SELECT
-- on public.products and the only SELECT policy exposes every active row, so
-- anyone with the public key can read every merchant's cost_price.
--
-- Same approach as the merchants containment (20260713150000): a table-level
-- grant is NOT narrowed by a column REVOKE, so the table-level SELECT is
-- removed and every column EXCEPT cost_price is granted back explicitly. The
-- list is built from the live catalog, so columns that exist in production but
-- not in this repo's history are still granted and no storefront read breaks.
--
-- SCOPE: anon only. The `authenticated` role (merchants, staff AND logged-in
-- shoppers) still has cost_price; closing that needs a merchant-only read path
-- and a mobile-admin release first (see the containment report).
--
-- PREREQUISITES (deploy order): the web build that no longer selects
-- cost_price as the shopper and uses get_negotiation_cost_floor_price
-- (20261110090000) must be live BEFORE this migration is applied.
--
-- NOTE: columns added to public.products in future are NOT readable by anon
-- until a migration grants them explicitly.
-- ============================================================================

BEGIN;

REVOKE SELECT ON TABLE public.products FROM anon;

DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO v_cols
  FROM pg_attribute a
  WHERE a.attrelid = 'public.products'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname <> 'cost_price';

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'public.products has no grantable columns';
  END IF;

  EXECUTE format('GRANT SELECT (%s) ON TABLE public.products TO anon', v_cols);
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
