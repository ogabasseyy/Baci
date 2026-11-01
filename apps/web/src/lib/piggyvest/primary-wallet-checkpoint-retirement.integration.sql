\set ON_ERROR_STOP on
\ir primary-wallet-savings-reconciliation-checkpoint.integration.sql
DO $$ BEGIN
  IF NOT has_function_privilege('piggyvest_primary_evidence',
    'piggyvest_primary.claim_savings_reconciliation_checkpoint(uuid,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'historical fixture no longer reproduces the extra worker grant';
  END IF;
END $$;
\ir ../../../../../supabase/migrations/20261101224000_piggyvest_retire_reconciliation_checkpoint_grants.sql
\ir ../../../../../supabase/tests/piggyvest_retired_reconciliation_checkpoint_grants.sql
