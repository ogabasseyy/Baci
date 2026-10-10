BEGIN;
SELECT system_identifier::text AS evidence_system FROM pg_control_system() \gset
SELECT set_config('evidence_test.system', :'evidence_system',false);
SET LOCAL SESSION AUTHORIZATION evidence_ingestor;
DO $$ DECLARE event_key text; result text; BEGIN
  FOREACH event_key IN ARRAY ARRAY['nullable-wrapper','nullable-direct'] LOOP
    result:=prefunded_card.record_provider_evidence('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),
      public.evidence_fixture(event_key,event_key||'-reference','bank_inflow',
        '{"eventCategory":"inflow_transaction","sessionId":null,"envelopeWalletId":"outer-pvb-wallet"}'));
    IF result IS DISTINCT FROM 'stored' THEN RAISE EXCEPTION 'nullable bank evidence was not stored'; END IF;
  END LOOP;
  PERFORM prefunded_card.record_provider_evidence('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),
    public.evidence_fixture('observed-session','observed-session-reference','bank_inflow'));
  PERFORM prefunded_card.record_provider_evidence('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),
    public.evidence_fixture('missing-data','missing-data-reference','bank_inflow','{"sessionId":null,"eventDataId":null}'));
  PERFORM prefunded_card.record_provider_evidence('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),
    public.evidence_fixture('missing-time','missing-time-reference','bank_inflow','{"sessionId":null,"creditedAt":null}'));
END $$;
SET LOCAL SESSION AUTHORIZATION projection_worker;
DO $$ DECLARE result text; event_key text; BEGIN
  result:=prefunded_card.apply_verified_legacy_inflow('nullable-wrapper-transaction','nullable-wrapper-data','nullable-wrapper',
    'scratch-event-customer','outer-pvb-wallet',10000,0,'nullable-wrapper-reference','invented-session','2026-09-26T12:00:00Z');
  IF result IS DISTINCT FROM 'reconciliation_required' THEN RAISE EXCEPTION 'caller invented an absent session'; END IF;
  result:=prefunded_card.apply_verified_legacy_inflow('observed-session-transaction','observed-session-data','observed-session',
    'scratch-event-customer','scratch-private-wallet',10000,0,'observed-session-reference',NULL,'2026-09-26T12:00:00Z');
  IF result IS DISTINCT FROM 'reconciliation_required' THEN RAISE EXCEPTION 'caller erased an observed session'; END IF;
  FOREACH event_key IN ARRAY ARRAY['missing-data','missing-time'] LOOP
    result:=prefunded_card.apply_verified_legacy_inflow(event_key||'-transaction',event_key||'-data',event_key,
      'scratch-event-customer','scratch-private-wallet',10000,0,event_key||'-reference',NULL,'2026-09-26T12:00:00Z');
    IF result IS DISTINCT FROM 'deferred' THEN RAISE EXCEPTION 'nullable session weakened required event data or timestamp'; END IF;
  END LOOP;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM prefunded_card.bank_projections) OR EXISTS(SELECT 1 FROM public.customer_savings_contributions)
    OR EXISTS(SELECT 1 FROM piggyvest_savings_ledger.operations)
    OR EXISTS(SELECT 1 FROM public.customer_savings_goals WHERE current_amount<>0) THEN
    RAISE EXCEPTION 'refused legacy evidence changed financial state'; END IF;
END $$;
SET LOCAL SESSION AUTHORIZATION projection_worker;
DO $$ DECLARE result text; BEGIN
  result:=prefunded_card.apply_verified_legacy_inflow('nullable-wrapper-transaction','nullable-wrapper-data','nullable-wrapper',
    'scratch-event-customer','outer-pvb-wallet',10000,0,'nullable-wrapper-reference',NULL,'2026-09-26T12:00:00Z');
  IF result IS DISTINCT FROM 'recognized' THEN RAISE EXCEPTION 'verified bank without session was not recognized by legacy adapter'; END IF;
  result:=prefunded_card.apply_classified_inflow('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),'nullable-wrapper');
  IF result IS DISTINCT FROM 'duplicate' THEN RAISE EXCEPTION 'legacy nullable bank receipt credited twice'; END IF;
  result:=prefunded_card.apply_classified_inflow('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),'nullable-direct');
  IF result IS DISTINCT FROM 'applied' THEN RAISE EXCEPTION 'direct projector refused verified bank without session'; END IF;
  result:=prefunded_card.apply_verified_legacy_inflow('nullable-direct-transaction','nullable-direct-data','nullable-direct',
    'scratch-event-customer','outer-pvb-wallet',10000,0,'nullable-direct-reference',NULL,'2026-09-26T12:00:00Z');
  IF result IS DISTINCT FROM 'duplicate' THEN RAISE EXCEPTION 'direct nullable bank receipt credited twice'; END IF;
  result:=prefunded_card.apply_verified_legacy_inflow('nullable-direct-transaction','nullable-direct-data','nullable-direct',
    'scratch-event-customer','outer-pvb-wallet',10000,0,'nullable-direct-reference','','2026-09-26T12:00:00Z');
  IF result IS DISTINCT FROM 'reconciliation_required' THEN RAISE EXCEPTION 'empty session treated as null'; END IF;
  result:=prefunded_card.apply_verified_legacy_inflow('observed-session-transaction','observed-session-data','observed-session',
    'scratch-event-customer','scratch-private-wallet',10000,0,'observed-session-reference','observed-session-session','2026-09-26T12:00:00Z');
  IF result IS DISTINCT FROM 'recognized' THEN RAISE EXCEPTION 'matching observed session stopped working'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT count(*) FROM prefunded_card.bank_projections)<>3
    OR (SELECT count(*) FROM public.customer_savings_contributions)<>3
    OR (SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings WHERE account='principal') IS DISTINCT FROM 30000
    OR (SELECT current_amount FROM public.customer_savings_goals) IS DISTINCT FROM 300 THEN
    RAISE EXCEPTION 'nullable session projector and adapter did not preserve one economic credit per receipt'; END IF;
END $$;
ROLLBACK;
