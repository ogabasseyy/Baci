-- #3581: make the submissions endpoint the only ingestion path for
-- search_analytics. The endpoint insert now uses a service-role client with
-- fully server-derived values, so drop the open INSERT policy and revoke
-- direct INSERT from the PostgREST roles. Merchant SELECT (policy + grants)
-- and the service_role grant are intentionally untouched.
DROP POLICY IF EXISTS "Anyone can insert search analytics"
  ON public.search_analytics;
REVOKE INSERT ON public.search_analytics FROM anon, authenticated;
