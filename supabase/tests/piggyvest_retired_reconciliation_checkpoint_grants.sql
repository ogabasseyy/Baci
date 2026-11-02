BEGIN;
DO $$
DECLARE principal text; routine regprocedure;
BEGIN
  FOREACH routine IN ARRAY ARRAY[
    'piggyvest_primary.claim_savings_reconciliation_checkpoint(uuid,text,uuid)'::regprocedure,
    'piggyvest_primary.save_savings_reconciliation_checkpoint(uuid,text,jsonb)'::regprocedure,
    'piggyvest_primary.finish_savings_reconciliation_checkpoint(uuid,text,jsonb)'::regprocedure
  ] LOOP
    FOREACH principal IN ARRAY ARRAY['public','anon','authenticated','service_role','piggyvest_primary_evidence'] LOOP
      IF has_function_privilege(principal, routine, 'EXECUTE') THEN
        RAISE EXCEPTION 'retired checkpoint capability remains granted to %: %', principal, routine;
      END IF;
    END LOOP;
  END LOOP;
  IF to_regclass('piggyvest_primary.savings_reconciliation_checkpoints') IS NULL THEN
    RAISE EXCEPTION 'historical checkpoint evidence was removed';
  END IF;
END $$;
ROLLBACK;
