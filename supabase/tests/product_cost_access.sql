-- Disposable full-schema regression; no persistent fixture or permission changes.
BEGIN;
\ir product_cost_access.fixture.inc.sql
\ir product_cost_access.helpers.inc.sql
DO $$
DECLARE role_name text; privilege_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.merchant_products'::regclass
    AND relowner='postgres'::regrole AND 'security_barrier=true'=ANY(reloptions)
    AND NOT ('security_invoker=true'=ANY(reloptions))) THEN
    RAISE EXCEPTION 'merchant_products must be owner-backed security-barrier view';
  END IF;
  IF has_table_privilege('anon','public.merchant_products','SELECT')
    OR NOT has_table_privilege('authenticated','public.merchant_products','SELECT') THEN
    RAISE EXCEPTION 'merchant_products SELECT role grants incorrect';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c,
    LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    WHERE c.oid='public.merchant_products'::regclass AND a.grantee=0) THEN
    RAISE EXCEPTION 'merchant_products must have no PUBLIC grants';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(role_name,'public.merchant_products',privilege_name) THEN
        RAISE EXCEPTION 'view privilege % leaked to %',privilege_name,role_name;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',true);
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.assert_cost_query_denied('SELECT cost_price FROM public.merchant_products');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_cost_rows(6,0); -- shopper
SELECT pg_temp.assert_cost_rows(1,3); -- owner, all statuses
SELECT pg_temp.assert_cost_rows(2,0); -- different merchant owner
SELECT pg_temp.assert_cost_rows(3,3); -- permitted active staff
SELECT pg_temp.assert_cost_rows(4,0); -- explicitly denied active staff
SELECT pg_temp.assert_cost_rows(5,0); -- suspended despite permission
SELECT pg_temp.assert_cost_query_denied('UPDATE public.merchant_products SET cost_price=1 WHERE false');
SELECT pg_temp.assert_cost_query_denied('DELETE FROM public.merchant_products WHERE false');
SELECT pg_temp.assert_cost_query_denied('INSERT INTO public.merchant_products(id) VALUES (NULL)');
RESET ROLE;
-- Permission changes must take effect without waiting for a JWT refresh.
UPDATE public.staff_members SET status='suspended'
WHERE user_id='ca570000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_cost_rows(3,0);
RESET ROLE;
UPDATE public.staff_members SET status='active'
WHERE user_id='ca570000-0000-4000-8000-000000000003';
-- Revoke phase is included separately after deliberately creating both ACL bypasses.
\ir product_cost_access.revoke.inc.sql
ROLLBACK;
