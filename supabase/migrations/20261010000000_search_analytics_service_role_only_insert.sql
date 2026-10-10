-- #3581: make the submissions endpoint the only ingestion path for
-- search_analytics. The endpoint insert now uses a branded service-role
-- client with fully server-derived values, so drop the open INSERT policy
-- and revoke every direct write grant from the PostgREST roles. Only the
-- SELECT grant backing the retained merchant SELECT policy is kept; the
-- service_role grant is intentionally untouched.
DROP POLICY IF EXISTS "Anyone can insert search analytics"
  ON public.search_analytics;
REVOKE ALL ON public.search_analytics FROM anon, authenticated;
GRANT SELECT ON public.search_analytics TO authenticated;
-- popular_searches is security_invoker over this table: its baseline anon
-- grant now suggests public reads that fail on the revoked underlying
-- table. Revoke it so the permission state is not half-open. The
-- aggregate GROUP BY view is not insertable, but authenticated retains
-- baseline INSERT/UPDATE/DELETE grants on it; revoke those too so no
-- PostgREST role advertises writes the least-privilege posture forbids.
REVOKE ALL ON public.popular_searches FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.popular_searches
  FROM authenticated;
