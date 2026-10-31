-- PiggyVest transfer-engine function ownership manifest.
--
-- One row per engine function: (name in schema piggyvest_primary, owner task,
-- rule). It is the single source of truth for two checks:
--   * .github/scripts/piggyvest-hook-ownership.mjs (CI) reads the rows below
--     and fails a migration that redefines, alters or drops a function without
--     the owner's "-- piggyvest-engine-owner: <task>" marker, defines a
--     define_once function a second time, or gives any function other than a
--     b_writer a body that touches the wallet tables or the B-effect writer;
--   * supabase/tests/piggyvest_primary_engine_schema.sql loads this file (\ir)
--     and checks the catalog against it.
-- Rules:
--   stub        declared as a no-op by P5-engine-schema; only the owner may
--               replace it ('none' means nobody may)
--   dispatcher  engine routing to per-purpose sub-hooks; owned by the engine
--   b_writer    the only functions that may write customer_wallets and
--               customer_wallet_transactions for transfers
--   define_once not declared here; the owner defines it exactly once
-- Keep one row per line in the exact shape below: the CI parser reads them.

CREATE TEMP TABLE pv_engine_ownership (
  function_name text PRIMARY KEY,
  owner_task text NOT NULL,
  rule text NOT NULL CHECK (rule IN ('stub', 'dispatcher', 'b_writer', 'define_once'))
) ON COMMIT DROP;

INSERT INTO pv_engine_ownership (function_name, owner_task, rule) VALUES
  ('on_settled_collect', 'P5-engine-schema', 'dispatcher'),
  ('on_failed_collect', 'P5-engine-schema', 'dispatcher'),
  ('on_settled_disbursement', 'P5-engine-schema', 'dispatcher'),
  ('on_settled_goal_forfeit', 'P5-engine-schema', 'dispatcher'),
  ('on_failed_goal_forfeit', 'P5-engine-schema', 'dispatcher'),
  ('on_settled_collect_vtu', 'none', 'stub'),
  ('on_failed_collect_vtu', 'none', 'stub'),
  ('on_settled_collect_imei', 'none', 'stub'),
  ('on_failed_collect_imei', 'none', 'stub'),
  ('on_settled_collect_checkout', 'P6-checkout-collect-outcome', 'stub'),
  ('on_failed_collect_checkout', 'P6-checkout-collect-outcome', 'stub'),
  ('on_refund_confirmed', 'P6-checkout-refund-records', 'stub'),
  ('on_settled_disbursement_obligation', 'P5-obligation-disbursement', 'stub'),
  ('on_failed_disbursement', 'P5-obligation-disbursement', 'stub'),
  ('on_settled_legacy_migration', 'P5-transfer-settle', 'stub'),
  ('on_failed_legacy_migration', 'P5-transfer-fail-attempts', 'stub'),
  ('on_settled_legacy_goal_migration', 'P8-legacy-goal-move', 'stub'),
  ('on_failed_legacy_goal_migration', 'P8-legacy-goal-move', 'stub'),
  ('on_settled_goal_purchase', 'P7-goal-purchase-settle', 'stub'),
  ('on_failed_goal_purchase', 'P7-goal-tender-hold', 'stub'),
  ('on_settled_goal_leftover', 'P7-goal-purchase-settle', 'stub'),
  ('on_failed_goal_leftover', 'P7-goal-purchase-settle', 'stub'),
  ('on_settled_goal_refund', 'P7-goal-refund-settle', 'stub'),
  ('on_failed_goal_refund', 'P7-goal-refund-settle', 'stub'),
  ('on_settled_goal_forfeit_cancel_interest', 'P7-goal-refund-settle', 'stub'),
  ('on_failed_goal_forfeit_cancel_interest', 'P7-goal-refund-settle', 'stub'),
  ('on_settled_goal_forfeit_post_exit_interest', 'P7-goal-post-exit-interest', 'stub'),
  ('on_failed_goal_forfeit_post_exit_interest', 'P7-goal-post-exit-interest', 'stub'),
  ('on_settled_goal_sweep', 'P7-goal-retire-sweep', 'stub'),
  ('on_failed_goal_sweep', 'P7-goal-retire-sweep', 'stub'),
  ('on_settled_support_payout', 'P5-support-payout-command', 'stub'),
  ('on_failed_support_payout', 'P5-support-payout-command', 'stub'),
  ('on_settled_treasury_sweep', 'P5-treasury-approvals-sweep', 'stub'),
  ('on_failed_treasury_sweep', 'P5-treasury-approvals-sweep', 'stub'),
  ('on_settled_interest_sweep', 'P5-misrouted-interest-resolve', 'stub'),
  ('on_failed_interest_sweep', 'P5-misrouted-interest-resolve', 'stub'),
  ('enqueue_misrouted_interest_sweep', 'P5-misrouted-interest-resolve', 'stub'),
  ('session_may_write_b', 'P5-legacy-write-backstop', 'stub'),
  ('request_b_effect', 'P5-engine-schema', 'b_writer'),
  ('apply_b_effect', 'P5-engine-schema', 'b_writer'),
  ('apply_requested_b_effects', 'P5-engine-schema', 'b_writer'),
  ('settle_attempt', 'P5-transfer-settle', 'define_once'),
  ('fail_attempt', 'P5-transfer-fail-attempts', 'define_once');
