\set ON_ERROR_STOP on
SET SESSION AUTHORIZATION baci_primary_card_transfer;
DO $$ DECLARE fixture record; capability jsonb; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='fifth@example.test';
 SELECT inbox.capability-'payloadContract'-'mappingContract' INTO capability FROM public.signed_inbox_fixture inbox;
 IF piggyvest_primary_card.claim_transfer((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id)->>'outcome'<>'existing' THEN RAISE EXCEPTION 'crashed attempt redispatched'; END IF;
 IF piggyvest_primary_card.select_ready_transfers((fixture.scope->>'integrationId')::uuid,'staging',capability,1)->'operationIds'<>'[]'::jsonb THEN RAISE EXCEPTION 'dispatching selected'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE public.custody_fixture fixture SET proof=jsonb_build_object('token',outbox.claim_token) FROM piggyvest_primary_card.transfer_outbox outbox WHERE fixture.operation_id=outbox.operation_id AND fixture.label='fifth@example.test';
SET SESSION AUTHORIZATION baci_primary_card_transfer;
DO $$ DECLARE fixture record; selected jsonb; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='fifth@example.test';
 IF NOT piggyvest_primary_card.record_transfer((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id,(fixture.proof->>'token')::uuid,false) THEN RAISE EXCEPTION 'unknown acceptance not recorded'; END IF;
 selected:=piggyvest_primary_card.select_ready_transfers((fixture.scope->>'integrationId')::uuid,'staging',(SELECT capability-'payloadContract'-'mappingContract' FROM public.signed_inbox_fixture),1);
 IF selected->'operationIds'<>'[]'::jsonb OR (selected->>'unknownCount')::integer<>1 THEN RAISE EXCEPTION 'unknown selected or hidden'; END IF;
 IF piggyvest_primary_card.claim_transfer((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id)->>'outcome'<>'existing' THEN RAISE EXCEPTION 'unknown retried'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ DECLARE fixture record; proof jsonb; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='fifth@example.test';
 proof:=piggyvest_primary_card.transfer_context((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id)||jsonb_build_object('providerTransactionId','canonical-fifth','transactionAliases',jsonb_build_array('canonical-fifth','bank-fifth'),'eventId','signed-fifth','bodyDigest',repeat('a',64),'crosswalkDigest',repeat('b',64),'observedAt',clock_timestamp(),'feeKobo',0,'currency','NGN');
 IF piggyvest_primary_card.settle_custody((fixture.scope->>'integrationId')::uuid,'staging',proof)<>'completed' THEN RAISE EXCEPTION 'signed recovery failed'; END IF;
 IF piggyvest_primary_card.settle_custody((fixture.scope->>'integrationId')::uuid,'staging',proof)<>'duplicate' THEN RAISE EXCEPTION 'signed recovery duplicate credit'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary_card.settings SET expires_at=clock_timestamp()-interval '1 second';
SET SESSION AUTHORIZATION baci_primary_card_transfer;
DO $$ BEGIN
 BEGIN
  PERFORM piggyvest_primary_card.select_ready_transfers('10000000-0000-4000-8000-000000000004','staging',(SELECT capability-'payloadContract'-'mappingContract' FROM public.signed_inbox_fixture),1);
  RAISE EXCEPTION 'expired selector accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
