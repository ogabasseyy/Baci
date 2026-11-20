\set ON_ERROR_STOP on
-- Reuse the isolated account-deletion schema setup, then explicitly apply
-- the prerequisite onboarding migrations and the onboarding-refresh migration.
\ir primary-wallet-account-deletion-detach.integration.sql
\ir ../../../../../supabase/migrations/20261007141000_piggyvest_primary_wallet_mapping_read.sql
\ir ../../../../../supabase/migrations/20261008090200_piggyvest_primary_onboarding_reclaim.sql
\ir ../../../../../supabase/migrations/20261008091400_piggyvest_primary_onboarding_dispatched_lease.sql
\ir ../../../../../supabase/migrations/20261008093000_piggyvest_primary_onboarding_rejection.sql
\ir ../../../../../supabase/migrations/20261007180000_piggyvest_primary_wallet_verification.sql
\ir ../../../../../supabase/migrations/20261007230000_primary_bank_signed_inbox.sql
\ir ../../../../../supabase/migrations/20261008093700_primary_bank_inbox_unsettled_deletion_block.sql
\ir ../../../../../supabase/migrations/20261008095500_primary_bank_deletion_requires_dva_closure.sql
\ir ../../../../../supabase/migrations/20261031230000_piggyvest_primary_onboarding_routing_pending.sql
\ir ../../../../../supabase/migrations/20261101171000_piggyvest_primary_onboarding_review_hold.sql
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS email text;
\ir ../../../../../supabase/migrations/20261101174000_piggyvest_primary_legacy_review_deletion_hold.sql
\ir ../../../../../supabase/migrations/20261101180000_piggyvest_primary_mapped_ownership_review_hold.sql
\ir ../../../../../supabase/migrations/20261101190000_piggyvest_primary_onboarding_review_classification.sql
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY);
\ir ../../../../../supabase/migrations/20261116152303_piggyvest_primary_onboarding_refresh_unknown.sql
\ir ../../../../../supabase/tests/piggyvest_primary_onboarding_refresh_unknown.sql
