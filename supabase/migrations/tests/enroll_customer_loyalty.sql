-- Runtime regression contract for the #3165 loyalty migrations
-- (20261010000001_enroll_customer_loyalty,
--  20261010000002_loyalty_status,
--  20261010000003_award_purchase_points_row_lock,
--  20261010000004_calculate_loyalty_tier_order,
--  20261010000005_redeem_loyalty_reward,
--  20261010000006_adjust_loyalty_points).
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
--   supabase/migrations/tests/enroll_customer_loyalty.sql
--
-- Wrapper: the cases live in focused parts (repository 300-line limit),
-- all running in this single transaction (rolled back at the end).

\ir enroll_customer_loyalty_setup.sql
\ir enroll_customer_loyalty_enrollment.sql
\ir enroll_customer_loyalty_referrals.sql
\ir enroll_customer_loyalty_status.sql
\ir enroll_customer_loyalty_redemption.sql
\ir enroll_customer_loyalty_reconciliation.sql
\ir enroll_customer_loyalty_projection.sql
\ir enroll_customer_loyalty_adjustment.sql

ROLLBACK;
