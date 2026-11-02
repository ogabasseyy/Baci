\set ON_ERROR_STOP on
\ir primary-wallet-review-hold.integration.sql
\ir ../../../../../supabase/migrations/20261101223000_piggyvest_primary_onboarding_recovery_read.sql
UPDATE piggyvest_primary.integrations SET executor_login = executor_login || '-retired' WHERE executor_login = SESSION_USER;
\ir ../../../../../supabase/tests/piggyvest_primary_onboarding_recovery.sql
