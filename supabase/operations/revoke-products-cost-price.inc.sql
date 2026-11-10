-- Include-only cutover body. Entry point or regression suite owns the transaction.
DO $$
BEGIN
  IF current_setting('baci.product_cost_access_cutover', true)
       IS DISTINCT FROM 'web-and-mobile-admin-verified' THEN
    RAISE EXCEPTION 'Product cost cutover requires verified web and mobile-admin rollout and explicit production approval';
  END IF;
  IF to_regclass('public.merchant_products') IS NULL THEN
    RAISE EXCEPTION 'Deploy the merchant product read view first';
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
