-- REGRESSION TEST (behaviour): an interest-inclusive refund never breaks the daily reconciliation
-- (migration 20261103085004_piggyvest_goal_cancel_refund). Fixture and
-- helpers live in the included part; registered in the replay registry folder
-- 20261103085004_piggyvest_goal_cancel_refund.
\set ON_ERROR_STOP on
\ir piggyvest_goal_cancel_behaviour.fixture.inc.sql

DO $behaviour$
DECLARE
  c_goal constant text := 'f3860000-0000-4000-8000-000000000005';
  c_invented constant text := 'f3860000-0000-4000-8000-0000000000ee';
  c_other constant text := 'f3860000-0000-4000-8000-0000000000ef';
  v_scope jsonb := pg_temp.gc_scope();
  v_issue jsonb;
  v_issue2 jsonb;
  v_op text;
  v_op2 text;
  v_result jsonb;
  v_text text;
BEGIN
  -- 100000 kobo funded, 101000 kobo refunded (the goal earned interest the
  -- books never recorded). The expected provider balance floors at 0 instead
  -- of going negative, so one legitimate refund can not invalidate the whole
  -- reconciliation snapshot, and the cancelled goal expects exactly 0.
  PERFORM pg_temp.gc_fund('f4', 100000);
  v_result := piggyvest_primary.read_daily_reconciliation(
    'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', '{"staleAfterSeconds":60}'::jsonb);
  PERFORM pg_temp.gc_assert(v_result -> 'wallets' =
    '[{"walletId":"synthetic-goalcancel-goal-wallet","expectedKobo":100000}]'::jsonb,
    'funded goal expected balance wrong before the cancel: ' || (v_result -> 'wallets')::text);
  v_op := pg_temp.gc_reserved('interest');
  PERFORM pg_temp.gc_assert(piggyvest_primary.manage_goal_cancel(v_scope, v_op::uuid, 'dispatch', 101000),
    'dispatch refused');
  PERFORM pg_temp.gc_assert(
    pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"amountKobo":101000}'::jsonb) = 'confirmed',
    'the interest-inclusive refund was not settled');
  PERFORM pg_temp.gc_assert(pg_temp.gc_goal('status') = 'cancelled' AND pg_temp.gc_wallet() = 1000,
    'the interest-inclusive refund did not cancel the goal, or changed the legacy wallet');
  v_result := piggyvest_primary.read_daily_reconciliation(
    'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', '{"staleAfterSeconds":60}'::jsonb);
  PERFORM pg_temp.gc_assert(v_result -> 'wallets' =
    '[{"walletId":"synthetic-goalcancel-goal-wallet","expectedKobo":0}]'::jsonb,
    '100000 funded and 101000 refunded did not expect 0: ' || (v_result -> 'wallets')::text);
END
$behaviour$;

ROLLBACK;
