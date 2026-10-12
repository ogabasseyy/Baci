BEGIN;
SELECT system_identifier::text AS evidence_system FROM pg_control_system() \gset
SELECT set_config('evidence_test.system', :'evidence_system',false);
SET LOCAL SESSION AUTHORIZATION evidence_ingestor;
SELECT prefunded_card.record_provider_evidence('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),
  public.evidence_fixture('atomic-bank','ordinary-atomic-bank','bank_inflow','{"eventCategory":"inflow_transaction"}'));
RESET SESSION AUTHORIZATION;
CREATE FUNCTION public.evidence_fail_contribution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'synthetic bank projection write failed'; END $$;
CREATE TRIGGER evidence_fail_contribution BEFORE INSERT ON public.customer_savings_contributions
  FOR EACH ROW EXECUTE FUNCTION public.evidence_fail_contribution();
SET LOCAL SESSION AUTHORIZATION projection_worker;
DO $$ BEGIN
  BEGIN
    PERFORM prefunded_card.apply_classified_inflow('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),'atomic-bank');
    RAISE EXCEPTION 'write failure not exercised';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'synthetic bank projection write failed' THEN RAISE; END IF;
  END;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM prefunded_card.bank_projections) OR EXISTS(SELECT 1 FROM piggyvest_savings_ledger.operations)
    OR EXISTS(SELECT 1 FROM public.customer_savings_contributions)
    OR EXISTS(SELECT 1 FROM public.customer_savings_goals WHERE current_amount<>0) THEN
    RAISE EXCEPTION 'bank projection partially committed'; END IF;
END $$;
DROP TRIGGER evidence_fail_contribution ON public.customer_savings_contributions;
SET LOCAL SESSION AUTHORIZATION projection_worker;
DO $$ DECLARE result text; BEGIN
  result:=prefunded_card.apply_verified_legacy_inflow('atomic-bank-transaction','atomic-bank-data','atomic-bank',
    'scratch-event-customer','scratch-private-wallet',10000,0,'ordinary-atomic-bank','atomic-bank-session','2026-09-26T12:00:00Z');
  IF result<>'recognized' THEN RAISE EXCEPTION 'stored signed bank evidence did not credit'; END IF;
  result:=prefunded_card.apply_classified_inflow('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),'atomic-bank');
  IF result<>'duplicate' THEN RAISE EXCEPTION 'bank credited more than once'; END IF;
  result:=prefunded_card.apply_verified_legacy_inflow('atomic-bank-transaction','forged-data','atomic-bank',
    'scratch-event-customer','scratch-private-wallet',10000,0,'ordinary-atomic-bank','atomic-bank-session','2026-09-26T12:00:00Z');
  IF result<>'reconciliation_required' THEN RAISE EXCEPTION 'raw caller self-attested event identity'; END IF;
  result:=prefunded_card.apply_verified_legacy_inflow('missing-transaction','missing-data','missing',
    'scratch-event-customer','scratch-private-wallet',10000,0,'ordinary-atomic-bank','missing-session','2026-09-26T12:00:00Z');
  IF result<>'deferred' THEN RAISE EXCEPTION 'unobserved raw inflow was accepted'; END IF;
END $$;
SET LOCAL SESSION AUTHORIZATION evidence_ingestor;
SELECT prefunded_card.record_provider_evidence('d91d9e87-8e0d-44de-9b84-1e1d709633d2',current_setting('evidence_test.system'),
  public.evidence_fixture('atomic-bank','ordinary-atomic-bank','bank_inflow','{"eventCategory":"inflow_transaction","amountKobo":10001}'));
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT count(*) FROM prefunded_card.bank_evidence_conflicts)<>1
    OR (SELECT count(*) FROM public.customer_savings_contributions)<>1
    OR (SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings WHERE account='principal')<>10000
    OR (SELECT current_amount FROM public.customer_savings_goals)<>100 THEN
    RAISE EXCEPTION 'bank conflict did not preserve credited principal with a durable obligation'; END IF;
END $$;
ROLLBACK;
