-- Codex R130 P1: remove the broad VTU SELECT policy that
-- migration 20261016131000 recreated mid-chain. Migration
-- 20261012235000 deliberately dropped "Customers can view own VTU
-- transactions" (the baseline authenticated grant made every column
-- of an owned VTU row directly readable — commissions, provider
-- transaction IDs, validation references, diagnostics) in favor of
-- the narrow replay-refresh RPC; the final schema must keep it
-- absent. Migrations are append-only, so the 20261016131000 CREATE
-- stands historically and this repair removes its effect.
DROP POLICY IF EXISTS "Customers can view own VTU transactions"
ON public.vtu_transactions;
