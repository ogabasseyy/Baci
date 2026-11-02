\set ON_ERROR_STOP on
-- Rebuild the replay order this change runs in: the review-hold harness ends
-- with piggyvest_primary_onboarding_review_hold.sql, which COMMITs an
-- integration bound to this SESSION_USER (executor_login is UNIQUE). Then
-- apply the onboarding release prerequisite and this change's migration.
\ir primary-wallet-review-hold.integration.sql
\ir ../../../../../supabase/migrations/20261008094100_piggyvest_primary_onboarding_release.sql
\ir ../../../../../supabase/migrations/20261102045351_piggyvest_onboarding_presence.sql
-- The replay runs each SQL check in its own session.
\c
\ir ../../../../../supabase/tests/piggyvest_onboarding_presence.sql
\c
\ir ../../../../../supabase/migrations/tests/piggyvest_onboarding_presence_privileges.sql
-- The presence suite rolls back its fixture and its executor-login retirement.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM piggyvest_primary.integrations
      WHERE id = 'b2c00000-0000-4000-8000-000000000005')
    OR NOT EXISTS (SELECT 1 FROM piggyvest_primary.integrations
      WHERE id = 'a3600000-0000-4000-8000-000000000005' AND executor_login = SESSION_USER) THEN
    RAISE EXCEPTION 'presence suite leaked fixture state';
  END IF;
END $$;
SELECT 'presence harness complete' AS result;
