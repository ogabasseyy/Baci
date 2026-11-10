-- RELEASE GATE: merge/apply only after the protected-read web/mobile release is
-- verified and the owner approves the old-client impact. This is the separate
-- activation stage, not part of the additive compatibility release.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.merchant_products') IS NULL THEN
    RAISE EXCEPTION 'Deploy and verify the protected product read path first';
  END IF;
END;
$$;

-- Column REVOKE alone cannot override a table-level grant. PUBLIC and explicit
-- column grants must also be removed, including grants left by previous fixes.
REVOKE SELECT ON TABLE public.products FROM PUBLIC, anon, authenticated;
REVOKE SELECT (cost_price) ON TABLE public.products FROM PUBLIC, anon, authenticated;
DO $$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO v_columns
  FROM pg_attribute AS a
  WHERE a.attrelid = 'public.products'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attname <> 'cost_price';
  IF v_columns IS NULL THEN
    RAISE EXCEPTION 'products has no public columns';
  END IF;
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.products TO anon, authenticated', v_columns);

  -- Fail and roll back if role inheritance or another grant still exposes cost.
  IF has_column_privilege('anon', 'public.products', 'cost_price', 'SELECT')
     OR has_column_privilege('authenticated', 'public.products', 'cost_price', 'SELECT') THEN
    RAISE EXCEPTION 'An inherited products.cost_price grant remains; inspect role memberships before proceeding';
  END IF;
END;
$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
