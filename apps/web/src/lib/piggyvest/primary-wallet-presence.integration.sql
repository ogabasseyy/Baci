\set ON_ERROR_STOP on
-- Rebuild the replay order this change runs in: the review-hold harness ends
-- with piggyvest_primary_onboarding_review_hold.sql, which COMMITs an
-- integration bound to this SESSION_USER (executor_login is UNIQUE). Then
-- apply the onboarding release prerequisite and this change's migration.
\ir primary-wallet-review-hold.integration.sql
\ir ../../../../../supabase/migrations/20261008094100_piggyvest_primary_onboarding_release.sql
-- The replay baseline grants no default EXECUTE on this schema, so its ACL
-- suite alone cannot prove the migration's REVOKE. Seed hostile default
-- privileges first: every grantee the REVOKE names would otherwise keep
-- EXECUTE, and the catalog-only ACL suite below fails on each one.
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA piggyvest_primary
  GRANT EXECUTE ON FUNCTIONS TO service_role, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER
  GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
\ir ../../../../../supabase/migrations/20261102121549_piggyvest_onboarding_presence.sql
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA piggyvest_primary
  REVOKE EXECUTE ON FUNCTIONS FROM service_role, anon, authenticated;
-- The replay runs each SQL check in its own session.
\c
\ir ../../../../../supabase/tests/piggyvest_onboarding_presence.sql
\c
\ir ../../../../../supabase/migrations/tests/piggyvest_onboarding_presence_privileges.sql
-- The presence suite rolls back its fixture and its executor-login retirement.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM piggyvest_primary.integrations
      WHERE id IN ('b2c00000-0000-4000-8000-000000000005',
        'b2c00000-0000-4000-8000-000000000006', 'b2c00000-0000-4000-8000-000000000007'))
    OR EXISTS (SELECT 1 FROM public.merchants
      WHERE id = 'b2c00000-0000-4000-8000-000000000003')
    OR NOT EXISTS (SELECT 1 FROM piggyvest_primary.integrations
      WHERE id = 'a3600000-0000-4000-8000-000000000005' AND executor_login = SESSION_USER) THEN
    RAISE EXCEPTION 'presence suite leaked fixture state';
  END IF;
END $$;
SELECT 'presence harness complete' AS result;
