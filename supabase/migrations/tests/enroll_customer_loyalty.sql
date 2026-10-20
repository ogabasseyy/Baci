-- Runtime regression contract for the #3165 loyalty migrations
-- (20261009235959_loyalty_reward_classification,
--  20261010000001_enroll_customer_loyalty,
--  20261010000002_loyalty_status,
--  20261010000003_award_purchase_points_row_lock,
--  20261010000004_calculate_loyalty_tier_order,
--  20261010000005_redeem_loyalty_reward,
--  20261010000006_adjust_loyalty_points,
--  20261010000007_credit_loyalty_referral,
--  20261010000008_loyalty_redemption_idempotency,
--  20261010000009_loyalty_checkout_bridge,
--  20261010000010_reserve_rdm_discount_code_prefix,
--  20261010000011_snapshot_redemption_minimum,
--  20261010000012_wallet_credit_loyalty_redemption,
--  20261010000013_loyalty_ngn_merchant_guard,
--  20261010000014_release_loyalty_claim_on_cancel,
--  20261010000015_loyalty_transactions_receipts,
--  20261010000016_loyalty_redemption_currency,
--  20261010000017_loyalty_redemption_max_percentage,
--  20261010000018_consume_loyalty_redemption,
--  20261010000019_loyalty_redemption_identity_snapshots,
--  20261010000020_consume_loyalty_redemption_attempt_key,
--  20261010000021_loyalty_checkout_order_wrapper,
--  20261010000022_loyalty_ngn_eligibility).
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
--   supabase/migrations/tests/enroll_customer_loyalty.sql
--
-- Wrapper: the cases live in focused parts (repository 300-line limit),
-- all running in this single transaction (rolled back at the end).

\ir enroll_customer_loyalty_setup.sql
\ir enroll_customer_loyalty_classification.sql
\ir enroll_customer_loyalty_overflow_users.sql
\ir enroll_customer_loyalty_enrollment.sql
\ir enroll_customer_loyalty_award.sql
\ir enroll_customer_loyalty_award_ladder.sql
\ir enroll_customer_loyalty_referrals.sql
\ir enroll_customer_loyalty_status.sql
\ir enroll_customer_loyalty_status_cap.sql
\ir enroll_customer_loyalty_status_ngn.sql
\ir enroll_customer_loyalty_redemption.sql
\ir enroll_customer_loyalty_redemption_snapshot.sql
\ir enroll_customer_loyalty_redemption_limits.sql
\ir enroll_customer_loyalty_redemption_idempotency.sql
\ir enroll_customer_loyalty_checkout_bridge.sql
\ir enroll_customer_loyalty_checkout_bridge_identity.sql
\ir enroll_customer_loyalty_checkout_bridge_replay.sql
\ir enroll_customer_loyalty_checkout_bridge_zero.sql
\ir enroll_customer_loyalty_reconciliation.sql
\ir enroll_customer_loyalty_projection.sql
\ir enroll_customer_loyalty_adjustment.sql
\ir enroll_customer_loyalty_redemption_guards.sql
\ir enroll_customer_loyalty_consume.sql
\ir enroll_customer_loyalty_consume_minimum.sql
\ir enroll_customer_loyalty_status_receipts.sql
\ir enroll_customer_loyalty_cancel_reuse.sql
\ir enroll_customer_loyalty_rdm_collisions.sql
\ir enroll_customer_loyalty_rdm_release.sql
\ir enroll_customer_loyalty_resolver_anon_revoked.sql

ROLLBACK;
