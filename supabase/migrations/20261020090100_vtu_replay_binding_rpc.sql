-- Replay binding RPC for the wallet-only checkout (epic #3694
-- Phase 2).
--
-- There is deliberately NO buyer SELECT policy on
-- vtu_transactions: a policy would let any signed-in customer
-- query every column of their rows directly (commissions,
-- provider diagnostics, metadata balances/PINs), reopening the
-- exposure that 20261012235000 deliberately removed (Codex P1, PR
-- #3741). The replay binding needs exactly four columns, so it
-- reads through this ownership-scoped RPC instead — the
-- get_vtu_replay_refresh_fields precedent: zero rows for
-- non-owners and missing rows alike (no existence oracle).
-- JWT-less service-role callers (server paths) see existing rows
-- unchanged.

CREATE OR REPLACE FUNCTION public.get_vtu_replay_binding(
  p_transaction_id uuid
)
RETURNS TABLE (
  id uuid,
  customer_id uuid,
  merchant_id uuid,
  status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id, t.customer_id, t.merchant_id, t.status
  FROM public.vtu_transactions AS t
  WHERE t.id = p_transaction_id
    AND (
      (SELECT auth.uid()) IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.customers AS c
        WHERE c.id = t.customer_id
          AND c.user_id = (SELECT auth.uid())
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_vtu_replay_binding(uuid)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_vtu_replay_binding(uuid)
TO authenticated, service_role;

COMMENT ON FUNCTION public.get_vtu_replay_binding(uuid) IS
  'Phase 2 (#3694): owner-scoped 4-column replay binding. No buyer SELECT policy exists by design — direct reads stay default-deny.';
