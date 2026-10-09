-- Runtime regression contract for 20261009120000_enroll_customer_loyalty.sql.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
--   supabase/migrations/tests/enroll_customer_loyalty.sql
--
-- Wrapper: the cases live in focused parts (repository 300-line limit),
-- all running in this single transaction (rolled back at the end).

\ir enroll_customer_loyalty_setup.sql
\ir enroll_customer_loyalty_enrollment.sql
\ir enroll_customer_loyalty_referrals.sql
\ir enroll_customer_loyalty_status.sql

ROLLBACK;
