\set ON_ERROR_STOP on
\ir primary-wallet-savings-dispatch.integration.sql
\ir ../../../../../supabase/migrations/20261008092800_piggyvest_primary_savings_outflow_reconciliation_read.sql
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$
DECLARE
  integration uuid := '00000000-0000-4000-8000-000000000004';
  operation uuid := '00000000-0000-4000-8000-000000000008';
  reference text := 'pvb-save-00000000-0000-4000-8000-000000000008';
  by_reference jsonb;
BEGIN
  by_reference := piggyvest_primary.find_dispatched_savings_by_reference(integration,'staging',reference);
  IF by_reference IS NULL THEN RAISE EXCEPTION 'dispatched op not found by reference'; END IF;
  IF by_reference <> piggyvest_primary.read_dispatched_savings(integration,'staging',operation) THEN RAISE EXCEPTION 'reference read diverges from id read'; END IF;
  IF (by_reference->>'operationId')::uuid <> operation THEN RAISE EXCEPTION 'reference read wrong op'; END IF;
  IF piggyvest_primary.find_dispatched_savings_by_reference(integration,'staging','pvb-save-unknown') IS NOT NULL THEN RAISE EXCEPTION 'unknown reference matched'; END IF;
  BEGIN
    PERFORM piggyvest_primary.find_dispatched_savings_by_reference('00000000-0000-4000-8000-000000000005','staging',reference);
    RAISE EXCEPTION 'foreign integration read';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM piggyvest_primary.find_dispatched_savings_by_reference(integration,'production',reference);
    RAISE EXCEPTION 'foreign environment read';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION primary_authorizer_fixture;
DO $$
BEGIN
  BEGIN
    PERFORM piggyvest_primary.find_dispatched_savings_by_reference('00000000-0000-4000-8000-000000000004','staging','pvb-save-00000000-0000-4000-8000-000000000008');
    RAISE EXCEPTION 'authorizer read evidence row';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF has_function_privilege('authenticated','piggyvest_primary.find_dispatched_savings_by_reference(uuid,text,text)','EXECUTE') THEN RAISE EXCEPTION 'public reference read'; END IF;
END $$;
