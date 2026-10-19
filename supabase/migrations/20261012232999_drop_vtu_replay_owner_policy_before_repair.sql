-- Codex R130 P1: pre-positioned repair for the replay-attribute
-- owner policy. Migration 20261012233000 creates the "Customers can
-- view own VTU transactions" policy with a bare CREATE POLICY, which
-- aborts the whole migration run on environments where the policy
-- already exists but the timestamp was never recorded (manual or
-- partial application). A repair that sorts AFTER 20261012233000
-- cannot unblock those environments — the run dies before reaching
-- it — so this append-only repair sorts BEFORE it (backdated
-- timestamp, new file; no historical file is touched).
--
-- DROP ONLY, no CREATE: migration 20261012235000 deliberately
-- removed this broad policy (it made every column of an owned VTU
-- row directly readable) in favor of the narrow replay-refresh RPC.
-- The final schema must keep it absent (Codex R130 P1); this repair
-- only clears the collision so 20261012233000 can run. A companion
-- post-repair removes the copy recreated mid-chain by
-- 20261016131000.
DROP POLICY IF EXISTS "Customers can view own VTU transactions"
ON public.vtu_transactions;
