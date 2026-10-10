BEGIN;
UPDATE public.customer_wallets SET available_balance=9999999999.99 WHERE customer_id='30000000-0000-4000-8000-000000000002';
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ DECLARE fixture record; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='third@example.test';
 BEGIN
  PERFORM piggyvest_primary_card.settle_custody((fixture.scope->>'integrationId')::uuid,'staging',fixture.proof);
  RAISE EXCEPTION 'wallet overflow accepted';
 EXCEPTION WHEN numeric_value_out_of_range THEN NULL; END;
 BEGIN
  PERFORM piggyvest_primary_card.settle_custody((fixture.scope->>'integrationId')::uuid,'staging',jsonb_set(fixture.proof,'{observedAt}',to_jsonb((now()-interval '2 minutes')::text)));
  RAISE EXCEPTION 'stale proof accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM piggyvest_primary_card.settle_custody((fixture.scope->>'integrationId')::uuid,'staging',jsonb_set(fixture.proof,'{amountKobo}','24999'));
  RAISE EXCEPTION 'wrong amount accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF (SELECT count(*) FROM piggyvest_primary.inflow_receipts)<>1 OR EXISTS(SELECT 1 FROM piggyvest_primary_card.settlements) THEN RAISE EXCEPTION 'partial credit escaped rollback'; END IF;
 IF (SELECT reserved_kobo FROM prefunded_card.treasury_bindings)<>60000 OR (SELECT consumed_kobo FROM prefunded_card.treasury_bindings)<>20000 THEN RAISE EXCEPTION 'failed credit debited treasury'; END IF;
 IF EXISTS(SELECT 1 FROM piggyvest_primary_card.transfer_outbox WHERE state<>'unknown') OR EXISTS(SELECT 1 FROM piggyvest_primary_card.receivables) THEN RAISE EXCEPTION 'failed credit completed outbox'; END IF;
END $$;
ROLLBACK;
BEGIN;
UPDATE piggyvest_primary_card.operations SET state='init_unknown' WHERE customer_id='30000000-0000-4000-8000-000000000002';
SET SESSION AUTHORIZATION fixture_bank_inflow;
DO $$ DECLARE fixture record; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='third@example.test';
 IF piggyvest_primary.apply_inflow_environment((fixture.scope->>'integrationId')::uuid,'staging',fixture.bank)<>'credited' THEN RAISE EXCEPTION 'first local bank receipt failed'; END IF;
 IF piggyvest_primary.apply_inflow_environment((fixture.scope->>'integrationId')::uuid,'staging',jsonb_set(fixture.bank,'{providerTransactionId}',to_jsonb('canonical-'||fixture.label)))<>'credited' THEN RAISE EXCEPTION 'second unrelated local receipt failed'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
UPDATE piggyvest_primary_card.operations SET state='custody_pending' WHERE customer_id='30000000-0000-4000-8000-000000000002';
SET SESSION AUTHORIZATION baci_primary_card_custody;
DO $$ DECLARE fixture record; BEGIN
 SELECT * INTO fixture FROM public.custody_fixture WHERE label='third@example.test';
 IF piggyvest_primary_card.settle_custody((fixture.scope->>'integrationId')::uuid,'staging',fixture.proof)<>'conflict' THEN RAISE EXCEPTION 'multiple credited receipts merged as completed'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM piggyvest_primary_card.settlements) OR (SELECT reserved_kobo FROM prefunded_card.treasury_bindings)<>60000 THEN RAISE EXCEPTION 'alias conflict completed or debited'; END IF;
END $$;
ROLLBACK;
