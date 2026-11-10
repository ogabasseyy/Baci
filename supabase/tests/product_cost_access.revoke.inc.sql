-- Include-only: the parent suite owns the transaction.
-- Simulate grants that a table-only or role-only revoke would accidentally retain.
GRANT SELECT ON public.products TO PUBLIC;
GRANT SELECT(cost_price) ON public.products TO PUBLIC, anon, authenticated;
-- The operation acknowledgement is set by the suite, never by application code.
SELECT set_config('baci.product_cost_access_cutover','web-and-mobile-admin-verified',true);
\ir ../operations/revoke-products-cost-price.inc.sql
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_table_privilege(role_name,'public.products','SELECT')
      OR has_column_privilege(role_name,'public.products','cost_price','SELECT') THEN
      RAISE EXCEPTION 'cost SELECT survived revocation for %',role_name;
    END IF;
    IF NOT has_column_privilege(role_name,'public.products','price','SELECT') THEN
      RAISE EXCEPTION 'public price SELECT was lost for %',role_name;
    END IF;
  END LOOP;
END;
$$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',true);
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.assert_cost_query_denied('SELECT cost_price FROM public.products');
SELECT pg_temp.assert_cost_query_denied('SELECT * FROM public.products');
SELECT pg_temp.assert_cost_query_denied('SELECT to_jsonb(p) FROM public.products p');
SELECT pg_temp.assert_cost_query_denied('SELECT id FROM public.products WHERE cost_price>0');
SELECT pg_temp.assert_cost_query_denied('SELECT id FROM public.products ORDER BY cost_price');
DO $$ BEGIN
  IF NOT EXISTS(SELECT id,name,price FROM public.products
    WHERE id='ca570000-0000-4000-8000-000000000201') THEN
    RAISE EXCEPTION 'anon lost safe active product read';
  END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','ca570000-0000-4000-8000-000000000006',true);
SELECT pg_temp.assert_cost_query_denied('SELECT cost_price FROM public.products');
SELECT pg_temp.assert_cost_query_denied('SELECT * FROM public.products');
SELECT pg_temp.assert_cost_query_denied('SELECT to_jsonb(p) FROM public.products p');
SELECT pg_temp.assert_cost_query_denied('SELECT id FROM public.products WHERE cost_price>0');
SELECT pg_temp.assert_cost_query_denied('SELECT id FROM public.products ORDER BY cost_price');
DO $$ BEGIN
  IF NOT EXISTS(SELECT id,name,price FROM public.products
    WHERE id='ca570000-0000-4000-8000-000000000201') THEN
    RAISE EXCEPTION 'shopper lost safe active product read';
  END IF;
END $$;
SELECT pg_temp.assert_cost_rows(1,3);
SELECT pg_temp.assert_cost_query_denied('SELECT cost_price FROM public.products');
SELECT pg_temp.assert_cost_rows(3,3);
SELECT pg_temp.assert_cost_rows(4,0);
SELECT pg_temp.assert_cost_rows(5,0);
SELECT pg_temp.assert_cost_rows(6,0);
RESET ROLE;
