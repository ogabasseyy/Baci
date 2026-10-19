BEGIN;
SELECT system_identifier::text AS evidence_system FROM pg_control_system() \gset
SELECT set_config('evidence_test.system', :'evidence_system',false);
SET LOCAL SESSION AUTHORIZATION projection_worker;
SELECT prefunded_card.reserve(public.evidence_command('70000000-0000-4000-8000-000000000001','bridge-1'));
SELECT prefunded_card.claim_collection('70000000-0000-4000-8000-000000000001',0);
SELECT prefunded_card.record_collection('70000000-0000-4000-8000-000000000001',1,'verified_success',
  '{"reference":"bridge-1-collection","amountKobo":10000,"currency":"NGN","savedMethodId":"60000000-0000-4000-8000-000000000001","providerTransactionId":"charge-1"}');
SELECT prefunded_card.claim_transfer('70000000-0000-4000-8000-000000000001',0);
DO $$ BEGIN
  BEGIN
    PERFORM prefunded_card.record_provider_evidence('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),public.evidence_fixture('forged','bridge-1'));
    RAISE EXCEPTION 'reader forged provider receipt';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL SESSION AUTHORIZATION evidence_ingestor;
DO $$ DECLARE stored text; BEGIN
  BEGIN
    PERFORM prefunded_card.record_provider_evidence('d91d9e87-8e0d-44de-9b84-1e1d709633d2','1',public.evidence_fixture('wrong-db','bridge-1'));
    RAISE EXCEPTION 'wrong database accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  stored:=prefunded_card.record_provider_evidence('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),
    public.evidence_fixture('wrong-owner','bridge-1','internal_transfer','{"destinationCustomerId":"other-customer"}'));
  IF stored<>'deferred' THEN RAISE EXCEPTION 'unmapped customer accepted'; END IF;
  stored:=prefunded_card.record_provider_evidence('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),
    public.evidence_fixture('bridge-event','bridge-1'));
  IF stored<>'stored' THEN RAISE EXCEPTION 'independent receipt not stored'; END IF;
  PERFORM prefunded_card.record_provider_evidence('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),
    public.evidence_fixture('bank-event','external-bank-1','bank_inflow'));
  PERFORM prefunded_card.record_provider_evidence('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),
    public.evidence_fixture('bank-bridge-alias','bridge-1','bank_inflow'));
  PERFORM prefunded_card.record_provider_evidence('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),
    public.evidence_fixture('unknown-event','unknown','bank_inflow','{"status":"deferred","kind":"unknown"}'));
END $$;
SET LOCAL SESSION AUTHORIZATION projection_worker;
DO $$ DECLARE result jsonb; BEGIN
  result:=prefunded_card.read_transfer_evidence('70000000-0000-4000-8000-000000000001',current_setting('evidence_test.system'));
  IF result->>'outcome'<>'verified_success' OR result#>>'{evidence,providerTransactionId}'<>'bridge-event-transaction'
    THEN RAISE EXCEPTION 'independent transfer evidence not verified'; END IF;
  result:=prefunded_card.classify_provider_inflow('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),'bank-event');
  IF result->>'outcome'<>'bank_inflow' OR result->>'goalId'<>'33333333-3333-4333-8333-333333333333'
    THEN RAISE EXCEPTION 'ordinary bank inflow blocked'; END IF;
  result:=prefunded_card.classify_provider_inflow('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),'bank-bridge-alias');
  IF result->>'outcome'<>'bridge_inflight' THEN RAISE EXCEPTION 'inflight card transfer miscredited'; END IF;
  result:=prefunded_card.classify_provider_inflow('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),'unknown-event');
  IF result->>'outcome'<>'deferred' THEN RAISE EXCEPTION 'unknown inflow guessed'; END IF;
  BEGIN
    PERFORM prefunded_card.reserve(public.evidence_command('70000000-0000-4000-8000-000000000002','external-bank-1'));
    RAISE EXCEPTION 'bank identifier reused by future bridge';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT count(*) FROM prefunded_card.inflow_attributions WHERE result->>'outcome'='deferred')<>1 THEN
    RAISE EXCEPTION 'deferred classification not durable'; END IF;
  IF EXISTS(SELECT 1 FROM prefunded_card.operations WHERE transfer_reference='external-bank-1') THEN
    RAISE EXCEPTION 'refused bridge left an operation'; END IF;
  IF EXISTS(SELECT 1 FROM public.customer_savings_contributions) THEN
    RAISE EXCEPTION 'classification silently credited money'; END IF;
END $$;
ROLLBACK;
