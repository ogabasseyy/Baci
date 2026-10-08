\set ON_ERROR_STOP on
\ir primary-wallet-card-custody-inbox.integration.sql
\ir ../../../../../supabase/migrations/20261007201100_primary_card_intake_role.sql
\ir ../../../../../supabase/migrations/20261007201200_primary_card_transfer_dispatch_context.sql
GRANT SELECT ON public.signed_inbox_fixture TO baci_primary_card_transfer;
SET SESSION AUTHORIZATION baci_primary_card_transfer;
DO $$ DECLARE fixture record; context jsonb; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='fourth@example.test';
 context:=piggyvest_primary_card.dispatch_context((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id,(SELECT capability-'payloadContract'-'mappingContract' FROM public.signed_inbox_fixture));
 IF context->>'sourceWalletId'<>'owner-treasury' OR context->>'destinationWalletId'<>fixture.proof->>'destinationWalletId' OR context->>'reference'<>fixture.proof->>'reference' THEN RAISE EXCEPTION 'transfer context not immutable scoped ownership'; END IF;
 IF has_function_privilege(SESSION_USER,'piggyvest_primary_card.settle_custody(uuid,text,jsonb)','EXECUTE') OR has_function_privilege(SESSION_USER,'piggyvest_primary_card.enqueue_signed_inbox(uuid,text,jsonb,text,text)','EXECUTE') THEN RAISE EXCEPTION 'transfer role has custody/intake authority'; END IF;
 IF piggyvest_primary_card.claim_transfer((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id)->>'outcome'<>'existing' THEN RAISE EXCEPTION 'unknown transfer redispatched'; END IF;
 BEGIN
  PERFORM piggyvest_primary_card.dispatch_context((fixture.scope->>'integrationId')::uuid,'production',fixture.operation_id,(SELECT capability-'payloadContract'-'mappingContract' FROM public.signed_inbox_fixture));
  RAISE EXCEPTION 'foreign environment selected';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM piggyvest_primary_card.dispatch_context((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id,(SELECT jsonb_set(capability-'payloadContract'-'mappingContract','{contractId}','"wrong-contract"') FROM public.signed_inbox_fixture));
  RAISE EXCEPTION 'unapproved proof contract selected';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary_card.transfer_outbox SET state='dispatching',claim_token=gen_random_uuid()
 WHERE operation_id=(SELECT operation_id FROM public.custody_fixture WHERE label='fourth@example.test');
SET SESSION AUTHORIZATION baci_primary_card_transfer;
DO $$ DECLARE fixture record; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='fourth@example.test';
 IF piggyvest_primary_card.claim_transfer((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id)->>'outcome'<>'existing' THEN RAISE EXCEPTION 'stranded dispatch reclaimed for second HTTP'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF has_function_privilege('authenticated','piggyvest_primary_card.dispatch_context(uuid,text,uuid,jsonb)','EXECUTE') OR has_function_privilege('primary_card_signed_intake','piggyvest_primary_card.dispatch_context(uuid,text,uuid,jsonb)','EXECUTE') OR has_function_privilege('primary_card_custody_evidence','piggyvest_primary_card.dispatch_context(uuid,text,uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'foreign role dispatch context granted'; END IF;
END $$;
