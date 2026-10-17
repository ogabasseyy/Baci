-- Muse R128 LOW via Codex R129 P1: make the replay-attribute owner
-- policy creation idempotent. Migration 20261012233000 created it
-- with a bare CREATE POLICY; environments where the earlier
-- replay-overlay work was applied manually or partially already have
-- the policy, and the bare CREATE aborts the whole migration and
-- blocks every subsequent one. Migrations are append-only (AGENTS.md),
-- so the repair lives here — the historical file is untouched.
--
-- The policy body is verbatim from 20261012233000: customers read
-- only their own VTU transactions (user_id-linked ownership).
DROP POLICY IF EXISTS "Customers can view own VTU transactions"
ON public.vtu_transactions;

CREATE POLICY "Customers can view own VTU transactions"
ON public.vtu_transactions FOR SELECT
USING (
  customer_id IN (
    SELECT c.id
    FROM public.customers c
    WHERE c.user_id = (SELECT auth.uid())
  )
);
