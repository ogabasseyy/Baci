-- The results snapshot is intentionally RPC-only. Keep a deny-all policy as
-- defense in depth and to make that access model explicit to database tooling.

CREATE POLICY quiz_event_results_v2_no_direct_client_access
  ON public.quiz_event_results_v2
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
