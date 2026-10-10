-- Runtime regression contract for the #3165 loyalty migrations
-- (20261009120000_enroll_customer_loyalty,
--  20261009120001_loyalty_status,
--  20261009120002_award_purchase_points_row_lock,
--  20261009120003_calculate_loyalty_tier_order,
--  20261009120004_redeem_loyalty_reward).
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

ROLLBACK;
