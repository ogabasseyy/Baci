-- Buyer SELECT policy for vtu_transactions (epic #3694 Phase 2:
-- wallet-only checkout off service-role).
--
-- A signed-in buyer sees ONLY their own rows (via the linked
-- customers row). Merchant/staff policies are untouched (permissive
-- policies OR together). There is deliberately NO buyer
-- INSERT/UPDATE/DELETE policy on this table: fulfillment credits
-- row money columns (merchant_commission, customer_cashback), so
-- direct writes would be a mint primitive — every buyer write goes
-- through an ownership-verifying SECURITY DEFINER RPC instead
-- (replay-overlay precedent). RLS stays default-deny for writes.
--
-- The (SELECT auth.uid()) scalar initplans once per statement
-- (customer_rls_auth_initplan_parity precedent); without it the
-- EXISTS re-evaluates per row.

CREATE POLICY vtu_transactions_buyer_select
  ON public.vtu_transactions
  FOR SELECT
  TO authenticated
  USING (
    customer_id IN (
      SELECT c.id
      FROM public.customers AS c
      WHERE c.user_id = (SELECT auth.uid())
    )
  );

COMMENT ON POLICY vtu_transactions_buyer_select ON public.vtu_transactions IS
  'Phase 2 (#3694): buyers SELECT their own VTU rows only. No buyer write policy exists by design — writes go through ownership-verifying RPCs.';
