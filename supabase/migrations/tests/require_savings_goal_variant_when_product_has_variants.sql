-- USAGE:
--   psql $DATABASE_URL -f supabase/migrations/tests/require_savings_goal_variant_when_product_has_variants.sql
-- Do not run against a shared or production database.

BEGIN;

SELECT 1 / CASE
  WHEN EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'enforce_customer_savings_goal_variant'
      AND prosecdef = false
      AND COALESCE(proconfig, ARRAY[]::text[]) @> ARRAY['search_path=']
  )
  THEN 1
  ELSE 0
END;

SELECT 1 / CASE
  WHEN EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_customer_savings_goals_require_variant'
  )
  THEN 1
  ELSE 0
END;

ROLLBACK;
