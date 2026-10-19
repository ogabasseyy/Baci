-- Replace the owner VTU SELECT policy with an ownership-scoped RPC
-- (Codex R50 6rp7ND).
--
-- The 20261012233000 revision added a "Customers can view own VTU
-- transactions" SELECT policy so the replay-attribute overlay's
-- best-effort Monnify reference refresh (three columns: metadata,
-- customer_identifier, status) could pre-read over the wallet-only
-- route's authenticated user client. Combined with the baseline
-- GRANT ALL ON vtu_transactions TO authenticated, that policy lets
-- any signed-in customer query EVERY column of their rows directly
-- — internal commissions, provider transaction IDs, validation
-- references, and provider diagnostics in metadata — instead of
-- only the fields the history API projects.
--
-- This revision drops that policy and exposes exactly the three
-- refresh columns through get_vtu_replay_refresh_fields, which
-- returns zero rows for non-owner and missing rows alike (no
-- existence oracle). JWT-less service-role callers (the
-- reconciliation cron, which bypasses RLS anyway) see existing
-- rows unchanged. No other reader depends on the dropped policy:
-- the merchant dashboard route reads through the pre-existing staff
-- policy, and every other vtu_transactions reader uses the admin
-- client.
DROP POLICY IF EXISTS "Customers can view own VTU transactions"
ON public.vtu_transactions;

CREATE OR REPLACE FUNCTION public.get_vtu_replay_refresh_fields(
  p_transaction_id uuid
)
RETURNS TABLE (
  metadata jsonb,
  customer_identifier text,
  status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.metadata, t.customer_identifier, t.status
  FROM public.vtu_transactions t
  WHERE t.id = p_transaction_id
    AND (
      (SELECT auth.uid()) IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.customers c
        WHERE c.id = t.customer_id
          AND c.user_id = (SELECT auth.uid())
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_vtu_replay_refresh_fields(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_vtu_replay_refresh_fields(uuid)
TO authenticated, service_role;
