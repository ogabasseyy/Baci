\set ON_ERROR_STOP on
-- Reuse the isolated account-deletion schema setup, then explicitly apply
-- the prerequisite onboarding migrations and this change's new migration.
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
-- An old executor writes this no-id rejection before the compatibility
-- migration exists. Its NULL review_reason cannot rule out ambiguous creation.
INSERT INTO public.customers(id, merchant_id, user_id, email)
  VALUES ('d3600000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001',
    'd3600000-0000-4000-8000-000000000021', 'legacy-review@example.test');
CREATE ROLE legacy_review_fixture LOGIN;
GRANT piggyvest_primary_provisioner TO legacy_review_fixture;
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
  VALUES ('d3600000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001',
    'legacy-review-business', 'staging', 'legacy_review_fixture', true);
SET SESSION AUTHORIZATION legacy_review_fixture;
DO $$
DECLARE
  scope jsonb := '{"merchantId":"10000000-0000-4000-8000-000000000001","customerId":"d3600000-0000-4000-8000-000000000011","userId":"d3600000-0000-4000-8000-000000000021","integrationId":"d3600000-0000-4000-8000-000000000005","businessId":"legacy-review-business","environment":"staging"}';
  claim jsonb;
BEGIN
  claim := piggyvest_primary.claim_onboarding(scope, repeat('9', 64));
  IF claim->>'status' <> 'claimed' THEN RAISE EXCEPTION 'legacy rejection claim failed'; END IF;
  IF NOT piggyvest_primary.record_onboarding_rejection(
    scope, (claim->>'intentId')::uuid, (claim->>'claimToken')::uuid
  ) THEN RAISE EXCEPTION 'legacy rejection write failed'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM piggyvest_primary.onboarding_intents
      WHERE integration_id = 'd3600000-0000-4000-8000-000000000005'
        AND customer_id = 'd3600000-0000-4000-8000-000000000011'
        AND state = 'rejected' AND review_reason IS NULL AND provider_wallet_id IS NULL) THEN
    RAISE EXCEPTION 'legacy rejection unexpectedly has review evidence';
  END IF;
END $$;
\ir ../../../../../supabase/migrations/20261101174000_piggyvest_primary_legacy_review_deletion_hold.sql
DO $$
BEGIN
  BEGIN
    DELETE FROM public.customers WHERE id = 'd3600000-0000-4000-8000-000000000011';
    RAISE EXCEPTION 'pre-migration walletless rejection allowed deletion';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'cannot delete customer with unresolved provider onboarding' THEN RAISE; END IF;
  END;
END $$;
\ir ../../../../../supabase/migrations/20261101180000_piggyvest_primary_mapped_ownership_review_hold.sql
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY);
\ir ../../../../../supabase/tests/piggyvest_primary_onboarding_review_hold.sql
