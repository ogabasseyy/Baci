\ir ../../../../../supabase/migrations/20261108153000_restrict_piggyvest_card_internal_routines.sql
\ir ../../../../../supabase/tests/piggyvest_card_internal_routine_grants.sql
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE fixture record; BEGIN
 FOR fixture IN SELECT scope, operation_id FROM public.custody_fixture LOOP
  IF (piggyvest_primary_card.read_operation(fixture.scope,fixture.operation_id)->>'operationId') IS DISTINCT FROM fixture.operation_id::text THEN
   RAISE EXCEPTION 'card operation unreadable after internal ACL change';
  END IF;
 END LOOP;
END $$;
RESET SESSION AUTHORIZATION;
