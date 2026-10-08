\set ON_ERROR_STOP on
\ir primary-wallet-card-transfer.integration.sql
\ir ../../../../../supabase/migrations/20261007201300_primary_card_transfer_outbox_selector.sql
UPDATE piggyvest_primary_card.reservations SET created_at=clock_timestamp()-interval '1 day';
INSERT INTO prefunded_card.treasury_snapshots SELECT id,'snapshot-after-signed-third',2,clock_timestamp(),verified_available_kobo-consumed_kobo,'fixture_verifier',clock_timestamp() FROM prefunded_card.treasury_bindings;
INSERT INTO public.customers VALUES('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003','fifth@example.test');
INSERT INTO piggyvest_primary.onboarding_intents(integration_id,merchant_id,customer_id,user_id,request_fingerprint,state,provider_customer_id,provider_wallet_id)
 SELECT '10000000-0000-4000-8000-000000000004',merchant_id,id,user_id,repeat('e',64),'verified',email,email||'-wallet' FROM public.customers WHERE email='fifth@example.test';
INSERT INTO public.custody_fixture(label,scope)
 SELECT customer.email,original.scope||jsonb_build_object('customerId',customer.id,'userId',customer.user_id,'email',customer.email)
 FROM public.customers customer CROSS JOIN public.card_fixture original WHERE customer.email='fifth@example.test' AND original.scope->>'email'='customer@example.test';
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE fixture record; intent jsonb; claim jsonb; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='fifth@example.test';
 intent:=piggyvest_primary_card.reserve(fixture.scope,jsonb_build_object('idempotencyKey',fixture.scope->>'customerId','amountKobo',25000,'consent',jsonb_build_object('version','primary-wallet-card-v1','oneTimeCharge',true,'saveCard',false)));
 UPDATE public.custody_fixture SET operation_id=(intent->>'operationId')::uuid WHERE label=fixture.label;
 claim:=piggyvest_primary_card.claim_initialization(fixture.scope,(intent->>'operationId')::uuid);
 PERFORM piggyvest_primary_card.record_initialization(fixture.scope,(intent->>'operationId')::uuid,(claim->>'token')::uuid,NULL);
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_card_evidence;
SELECT piggyvest_primary_card.record_collection(scope,operation_id,jsonb_build_object('reference','pvb-first-primary-'||operation_id,'amountKobo',25000,'domain','test','providerTransactionId','12349','token',NULL)) FROM public.custody_fixture WHERE label='fifth@example.test';
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_card_transfer;
DO $$ DECLARE capability jsonb; selected jsonb; fixture record; BEGIN
 SELECT inbox.capability-'payloadContract'-'mappingContract' INTO capability FROM public.signed_inbox_fixture inbox;
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='fifth@example.test';
 selected:=piggyvest_primary_card.select_ready_transfers((fixture.scope->>'integrationId')::uuid,'staging',capability,1);
 IF selected->'operationIds'<>jsonb_build_array(fixture.operation_id) OR (selected->>'dispatchingCount')::integer<>1 OR (selected->>'unknownCount')::integer<>0 THEN RAISE EXCEPTION 'selector included completed/ambiguous work or lost visible backlog'; END IF;
 IF piggyvest_primary_card.select_ready_transfers((fixture.scope->>'integrationId')::uuid,'staging',capability,0)->'operationIds'<>'[]'::jsonb THEN RAISE EXCEPTION 'readiness selected financial work'; END IF;
 IF has_table_privilege(SESSION_USER,'piggyvest_primary_card.transfer_outbox','SELECT') THEN RAISE EXCEPTION 'selector requires direct table authority'; END IF;
 BEGIN
  PERFORM piggyvest_primary_card.select_ready_transfers((fixture.scope->>'integrationId')::uuid,'staging',capability,2);
  RAISE EXCEPTION 'unbounded selector accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM piggyvest_primary_card.select_ready_transfers((fixture.scope->>'integrationId')::uuid,'production',capability,1);
  RAISE EXCEPTION 'foreign environment selected';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM piggyvest_primary_card.select_ready_transfers((fixture.scope->>'integrationId')::uuid,'staging',jsonb_set(capability,'{contractId}','"unapproved"'),1);
  RAISE EXCEPTION 'unapproved crosswalk selected';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
BEGIN;
INSERT INTO prefunded_card.treasury_snapshots SELECT id,'stale-selector-snapshot',3,clock_timestamp()-interval '16 minutes',verified_available_kobo-consumed_kobo,'fixture_verifier',clock_timestamp() FROM prefunded_card.treasury_bindings;
SET SESSION AUTHORIZATION baci_primary_card_transfer;
DO $$ BEGIN
 BEGIN
  PERFORM piggyvest_primary_card.select_ready_transfers('10000000-0000-4000-8000-000000000004','staging',(SELECT capability-'payloadContract'-'mappingContract' FROM public.signed_inbox_fixture),0);
  RAISE EXCEPTION 'stale treasury readiness acknowledged';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
ROLLBACK;
UPDATE piggyvest_primary.onboarding_intents SET provider_wallet_id='wrong-wallet' WHERE customer_id='50000000-0000-4000-8000-000000000002';
SET SESSION AUTHORIZATION baci_primary_card_transfer;
DO $$ BEGIN
 IF piggyvest_primary_card.select_ready_transfers('10000000-0000-4000-8000-000000000004','staging',(SELECT capability-'payloadContract'-'mappingContract' FROM public.signed_inbox_fixture),1)->'operationIds'<>'[]'::jsonb THEN RAISE EXCEPTION 'unverified ownership selected'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary.onboarding_intents SET provider_wallet_id='fifth@example.test-wallet' WHERE customer_id='50000000-0000-4000-8000-000000000002';
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','primary_card_signed_intake','primary_card_custody_evidence','primary_card_authorizer','primary_card_evidence'] LOOP
  IF has_function_privilege(role_name,'piggyvest_primary_card.select_ready_transfers(uuid,text,jsonb,integer)','EXECUTE') THEN RAISE EXCEPTION 'foreign selector grant: %',role_name; END IF;
 END LOOP;
END $$;
