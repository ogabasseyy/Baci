-- Reconcile the historical deny-all policy when the policy exists but its
-- migration ledger row is missing, without changing the fail-closed contract.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'quiz_event_results_v2'
      AND policyname = 'quiz_event_results_v2_no_direct_client_access'
  ) THEN
    CREATE POLICY quiz_event_results_v2_no_direct_client_access
      ON public.quiz_event_results_v2
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END;
$$;
