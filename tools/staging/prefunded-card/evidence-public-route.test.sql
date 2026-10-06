BEGIN;
SELECT system_identifier::text AS evidence_system FROM pg_control_system() \gset
SELECT set_config('evidence_test.system', :'evidence_system',false);
GRANT EXECUTE ON FUNCTION public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)
  TO projection_worker,evidence_ingestor;
INSERT INTO public.piggyvest_plan_wallets VALUES(
  '22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
  'legacy-customer','legacy-unenrolled-wallet');
SET LOCAL SESSION AUTHORIZATION evidence_ingestor;
DO $$ DECLARE event_key text; result text; BEGIN
  FOREACH event_key IN ARRAY ARRAY['public-envelope','public-destination'] LOOP
    result:=prefunded_card.record_provider_evidence('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),
      public.evidence_fixture(event_key,event_key||'-reference','bank_inflow',
        '{"eventCategory":"inflow_transaction","sessionId":null,"envelopeWalletId":"outer-pvb-wallet"}'));
    IF result IS DISTINCT FROM 'stored' THEN RAISE EXCEPTION 'public-route evidence not stored'; END IF;
  END LOOP;
  BEGIN
    PERFORM public.recognize_piggyvest_staging_inflow('public-envelope-transaction','public-envelope-data','public-envelope',
      'scratch-event-customer','outer-pvb-wallet',10000,0,'public-envelope-reference',NULL,'2026-09-26T12:00:00Z');
    RAISE EXCEPTION 'ingestion login unexpectedly projected principal';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SET LOCAL SESSION AUTHORIZATION projection_worker;
DO $$ DECLARE result text; BEGIN
  result:=public.recognize_piggyvest_staging_inflow('missing-transaction','missing-data','missing-event',
    'scratch-event-customer','scratch-private-wallet',10000,0,'missing-reference',NULL,'2026-09-26T12:00:00Z');
  IF result IS DISTINCT FROM 'deferred' THEN RAISE EXCEPTION 'missing evidence did not defer enrolled credit'; END IF;
  result:=public.recognize_piggyvest_staging_inflow('public-envelope-transaction','public-envelope-data','public-envelope',
    'scratch-event-customer','outer-pvb-wallet',10001,0,'public-envelope-reference',NULL,'2026-09-26T12:00:00Z');
  IF result IS DISTINCT FROM 'reconciliation_required' THEN RAISE EXCEPTION 'mismatched public amount accepted'; END IF;
  result:=public.recognize_piggyvest_staging_inflow('public-envelope-transaction','public-envelope-data','public-envelope',
    'scratch-event-customer','legacy-unenrolled-wallet',10000,0,'public-envelope-reference',NULL,'2026-09-26T12:00:00Z');
  IF result IS DISTINCT FROM 'reconciliation_required' THEN RAISE EXCEPTION 'enrolled evidence fell through to legacy wallet'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM prefunded_card.bank_projections)
    OR EXISTS(SELECT 1 FROM public.customer_savings_contributions)
    OR EXISTS(SELECT 1 FROM public.piggyvest_inflow_credits)
    OR EXISTS(SELECT 1 FROM piggyvest_savings_ledger.operations) THEN
    RAISE EXCEPTION 'refused public inflows changed financial state';
  END IF;
END $$;
SET LOCAL SESSION AUTHORIZATION projection_worker;
DO $$ DECLARE result text; BEGIN
  result:=public.recognize_piggyvest_staging_inflow('public-envelope-transaction','public-envelope-data','public-envelope',
    'scratch-event-customer','outer-pvb-wallet',10000,0,'public-envelope-reference',NULL,'2026-09-26T12:00:00Z');
  IF result IS DISTINCT FROM 'recognized' THEN RAISE EXCEPTION 'public wrapper failed genuine envelope wallet and absent session'; END IF;
  result:=public.recognize_piggyvest_staging_inflow('public-envelope-transaction','public-envelope-data','public-envelope',
    'scratch-event-customer','scratch-private-wallet',10000,0,'public-envelope-reference',NULL,'2026-09-26T12:00:00Z');
  IF result IS DISTINCT FROM 'duplicate' THEN RAISE EXCEPTION 'public retry double-credited destination'; END IF;
  result:=prefunded_card.apply_classified_inflow('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),'public-envelope');
  IF result IS DISTINCT FROM 'duplicate' THEN RAISE EXCEPTION 'direct replay double-credited public receipt'; END IF;
  result:=public.recognize_piggyvest_staging_inflow('public-destination-transaction','public-destination-data','public-destination',
    'scratch-event-customer','scratch-private-wallet',10000,0,'public-destination-reference',NULL,'2026-09-26T12:00:00Z');
  IF result IS DISTINCT FROM 'recognized' THEN RAISE EXCEPTION 'public wrapper did not route enrolled destination'; END IF;
  result:=public.recognize_piggyvest_staging_inflow('legacy-transaction','legacy-data','legacy-event',
    'legacy-customer','legacy-unenrolled-wallet',10000,0,'legacy-reference',NULL,'2026-09-26T12:00:00Z');
  IF result IS DISTINCT FROM 'recognized' THEN RAISE EXCEPTION 'unenrolled wallet lost existing legacy path'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT count(*) FROM prefunded_card.bank_projections)<>2
    OR (SELECT count(*) FROM public.customer_savings_contributions)<>2
    OR (SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings WHERE account='principal') IS DISTINCT FROM 20000
    OR (SELECT current_amount FROM public.customer_savings_goals) IS DISTINCT FROM 200
    OR (SELECT count(*) FROM public.piggyvest_inflow_credits)<>1
    OR NOT EXISTS(SELECT 1 FROM public.piggyvest_inflow_credits WHERE provider_transaction_id='legacy-transaction') THEN
    RAISE EXCEPTION 'public wrapper violated canonical/legacy attribution or exactly-once credit';
  END IF;
END $$;
ROLLBACK;
