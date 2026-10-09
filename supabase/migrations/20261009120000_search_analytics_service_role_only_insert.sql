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
