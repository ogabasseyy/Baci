\set ON_ERROR_STOP on
\ir primary-wallet-card-custody-inbox.integration.sql
\ir ../../../../../supabase/migrations/20261007201100_primary_card_intake_role.sql
\ir ../../../../../supabase/migrations/20261007201300_primary_card_transfer_outbox_selector.sql
\ir ../../../../../supabase/migrations/20261008091800_primary_card_transfer_outbox_lease.sql
INSERT INTO prefunded_card.treasury_snapshots SELECT id,'snapshot-after-signed-third',2,clock_timestamp(),verified_available_kobo-consumed_kobo,'fixture_verifier',clock_timestamp() FROM prefunded_card.treasury_bindings;
UPDATE piggyvest_primary_card.reservations SET created_at=clock_timestamp()-interval '1 day';
INSERT INTO public.customers VALUES('70000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000003','sixth@example.test');
INSERT INTO piggyvest_primary.onboarding_intents(integration_id,merchant_id,customer_id,user_id,request_fingerprint,state,provider_customer_id,provider_wallet_id)
 SELECT '10000000-0000-4000-8000-000000000004',merchant_id,id,user_id,repeat('f',64),'verified',email,email||'-wallet' FROM public.customers WHERE email='sixth@example.test';
INSERT INTO public.custody_fixture(label,scope)
 SELECT customer.email,original.scope||jsonb_build_object('customerId',customer.id,'userId',customer.user_id,'email',customer.email)
 FROM public.customers customer CROSS JOIN public.card_fixture original WHERE customer.email='sixth@example.test' AND original.scope->>'email'='customer@example.test';
SET SESSION AUTHORIZATION baci_primary_card_authorizer;
DO $$ DECLARE fixture record; intent jsonb; claim jsonb; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='sixth@example.test';
 intent:=piggyvest_primary_card.reserve(fixture.scope,jsonb_build_object('idempotencyKey',fixture.scope->>'customerId','amountKobo',25000,'consent',jsonb_build_object('version','primary-wallet-card-v1','oneTimeCharge',true,'saveCard',false)));
 UPDATE public.custody_fixture SET operation_id=(intent->>'operationId')::uuid WHERE label=fixture.label;
 claim:=piggyvest_primary_card.claim_initialization(fixture.scope,(intent->>'operationId')::uuid);
 PERFORM piggyvest_primary_card.record_initialization(fixture.scope,(intent->>'operationId')::uuid,(claim->>'token')::uuid,NULL);
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION baci_primary_card_evidence;
SELECT piggyvest_primary_card.record_collection(scope,operation_id,jsonb_build_object('reference','pvb-first-primary-'||operation_id,'amountKobo',25000,'domain','test','providerTransactionId','12350','token',NULL)) FROM public.custody_fixture WHERE label='sixth@example.test';
RESET SESSION AUTHORIZATION;
GRANT SELECT ON public.signed_inbox_fixture TO baci_primary_card_transfer;
SET SESSION AUTHORIZATION baci_primary_card_transfer;
DO $$ DECLARE fixture record; capability jsonb; selected jsonb; first jsonb; second jsonb; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='sixth@example.test';
 SELECT inbox.capability-'payloadContract'-'mappingContract' INTO capability FROM public.signed_inbox_fixture inbox;
 selected:=piggyvest_primary_card.select_ready_transfers((fixture.scope->>'integrationId')::uuid,'staging',capability,1);
 IF selected->'operationIds'<>jsonb_build_array(fixture.operation_id) THEN RAISE EXCEPTION 'ready transfer not selected'; END IF;
 first:=piggyvest_primary_card.claim_transfer((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id);
 IF first->>'outcome'<>'claimed' THEN RAISE EXCEPTION 'ready transfer not claimed'; END IF;
 UPDATE public.custody_fixture SET proof=jsonb_build_object('token',first->>'token','command',first->'command') WHERE label='sixth@example.test';
 second:=piggyvest_primary_card.claim_transfer((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id);
 IF second->>'outcome'<>'existing' THEN RAISE EXCEPTION 'live claim reissued for second submission'; END IF;
 selected:=piggyvest_primary_card.select_ready_transfers((fixture.scope->>'integrationId')::uuid,'staging',capability,1);
 IF selected->'operationIds'<>'[]'::jsonb THEN RAISE EXCEPTION 'live dispatching selected'; END IF;
 IF (selected->>'dispatchingCount')::integer<1 THEN RAISE EXCEPTION 'live dispatching hidden from backlog'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary_card.transfer_outbox SET updated_at=clock_timestamp()-interval '6 minutes'
 WHERE operation_id=(SELECT operation_id FROM public.custody_fixture WHERE label='sixth@example.test');
SET SESSION AUTHORIZATION baci_primary_card_transfer;
DO $$ DECLARE fixture record; capability jsonb; selected jsonb; reclaimed jsonb; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='sixth@example.test';
 SELECT inbox.capability-'payloadContract'-'mappingContract' INTO capability FROM public.signed_inbox_fixture inbox;
 selected:=piggyvest_primary_card.select_ready_transfers((fixture.scope->>'integrationId')::uuid,'staging',capability,1);
 IF selected->'operationIds'<>jsonb_build_array(fixture.operation_id) THEN RAISE EXCEPTION 'stale dispatching never selected'; END IF;
 reclaimed:=piggyvest_primary_card.claim_transfer((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id);
 IF reclaimed->>'outcome'<>'reclaimed' THEN RAISE EXCEPTION 'stale dispatching not reclaimable'; END IF;
 IF reclaimed->>'token' IS NOT DISTINCT FROM fixture.proof->>'token' THEN RAISE EXCEPTION 'reclaim reused dead token'; END IF;
 IF reclaimed->'command'<>fixture.proof->'command' THEN RAISE EXCEPTION 'reclaim changed the provider command'; END IF;
 IF piggyvest_primary_card.record_transfer((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id,(fixture.proof->>'token')::uuid,true) THEN RAISE EXCEPTION 'dead token recorded'; END IF;
 IF NOT piggyvest_primary_card.record_transfer((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id,(reclaimed->>'token')::uuid,true) THEN RAISE EXCEPTION 'reclaimed submission not recorded'; END IF;
 IF piggyvest_primary_card.claim_transfer((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id)->>'outcome'<>'existing' THEN RAISE EXCEPTION 'submitted transfer reclaimed'; END IF;
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='fourth@example.test';
 IF piggyvest_primary_card.claim_transfer((fixture.scope->>'integrationId')::uuid,'staging',fixture.operation_id)->>'outcome'<>'existing' THEN RAISE EXCEPTION 'uncertain transfer reclaimed'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF (SELECT state FROM piggyvest_primary_card.transfer_outbox WHERE operation_id=(SELECT operation_id FROM public.custody_fixture WHERE label='sixth@example.test'))<>'submitted' THEN RAISE EXCEPTION 'reclaimed outbox not submitted'; END IF;
END $$;
