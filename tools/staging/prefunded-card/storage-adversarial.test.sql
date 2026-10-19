CREATE FUNCTION prefunded_card_test.command_for(sequence integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT prefunded_card_test.command3() || jsonb_build_object(
    'operationId','70000000-0000-4000-8000-' || lpad(sequence::text,12,'0'),
    'requestFingerprint','fingerprint-test-' || sequence,
    'idempotencyKey','idempotency-test-' || sequence,
    'collectionReference','collection-test-' || sequence,
    'transferReference','transfer-test-' || sequence,'amountKobo',1000);
$$;

BEGIN;
GRANT USAGE ON SCHEMA prefunded_card,prefunded_card_test TO prefunded_worker;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA prefunded_card,prefunded_card_test TO prefunded_worker;
SET SESSION AUTHORIZATION prefunded_worker;
DO $$ DECLARE statement text; BEGIN
  FOREACH statement IN ARRAY ARRAY[
    'SELECT prefunded_card.reserve(prefunded_card_test.command3())',
    'SELECT prefunded_card.claim_collection(''70000000-0000-4000-8000-000000000003'',0)',
    'SELECT prefunded_card.claim_transfer(''70000000-0000-4000-8000-000000000003'',0)',
    'SELECT prefunded_card.record_collection(''70000000-0000-4000-8000-000000000001'',1,''unknown'',NULL)',
    'SELECT prefunded_card.record_transfer(''70000000-0000-4000-8000-000000000002'',1,''unknown'',NULL)',
    'SELECT prefunded_card.claim_reconciliation(''70000000-0000-4000-8000-000000000001'',60)',
    'SELECT prefunded_card.complete_reconciliation(''70000000-0000-4000-8000-000000000001'',''90000000-0000-4000-8000-000000000001'',1,''collection'',''verified_failed'',''{}'')'
  ] LOOP
    BEGIN
      EXECUTE statement;
      RAISE EXCEPTION 'wrong session unexpectedly authorized';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END $$;
RESET SESSION AUTHORIZATION;
ROLLBACK;

BEGIN;
DO $$ DECLARE mutation text; BEGIN
  FOREACH mutation IN ARRAY ARRAY[
    'UPDATE piggyvest_savings_ledger.bindings SET enabled=false',
    'UPDATE piggyvest_staging.integrations SET enabled=false',
    'UPDATE public.customer_saved_payment_methods SET is_active=false',
    'UPDATE public.customer_savings_goals SET status=''cancelled''',
    'UPDATE prefunded_card.treasury_bindings SET enabled=false',
    'UPDATE prefunded_card.treasury_bindings SET verified_at=now()-interval ''1 day'''
  ] LOOP
    BEGIN
      EXECUTE mutation;
      PERFORM prefunded_card.claim_collection('70000000-0000-4000-8000-000000000003',0);
      RAISE EXCEPTION 'revoked eligibility accepted a new send';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END $$;
ROLLBACK;

BEGIN;
DO $$ DECLARE first_claim jsonb; second_claim jsonb; outcome text; reserved_before bigint;
  evidence jsonb:=jsonb_build_object('reference','collection-1','amountKobo',10000,'currency','NGN',
    'savedMethodId','60000000-0000-4000-8000-000000000001','providerTransactionId','verified-failed-1');
BEGIN
  first_claim:=prefunded_card.claim_reconciliation('70000000-0000-4000-8000-000000000001',60);
  PERFORM prefunded_card_test.assert(first_claim->>'outcome'='verify_only','verification is not dispatch authority');
  UPDATE prefunded_card.operations SET verification_lease_expires_at=now()-interval '1 second'
    WHERE id='70000000-0000-4000-8000-000000000001';
  outcome:=prefunded_card.complete_reconciliation('70000000-0000-4000-8000-000000000001',
    (first_claim->>'token')::uuid,(first_claim->>'fence')::bigint,'collection','verified_failed',evidence);
  PERFORM prefunded_card_test.assert(outcome='stale','expired verifier rejected');
  second_claim:=prefunded_card.claim_reconciliation('70000000-0000-4000-8000-000000000001',60);
  outcome:=prefunded_card.complete_reconciliation('70000000-0000-4000-8000-000000000001',
    (first_claim->>'token')::uuid,(first_claim->>'fence')::bigint,'collection','verified_failed',evidence);
  PERFORM prefunded_card_test.assert(outcome='stale','superseded verifier rejected');
  UPDATE piggyvest_savings_ledger.bindings SET enabled=false;
  UPDATE public.customer_saved_payment_methods SET is_active=false;
  UPDATE public.customer_savings_goals SET status='cancelled';
  UPDATE prefunded_card.treasury_bindings SET enabled=false,verified_at=now()-interval '1 day';
  SELECT reserved_kobo INTO reserved_before FROM prefunded_card.treasury_bindings;
  outcome:=prefunded_card.complete_reconciliation('70000000-0000-4000-8000-000000000001',
    (second_claim->>'token')::uuid,(second_claim->>'fence')::bigint,'collection','verified_failed',evidence);
  PERFORM prefunded_card_test.assert(outcome='verified_failed','historical outcome survives revocation');
  PERFORM prefunded_card_test.assert((SELECT reserved_kobo=reserved_before-10000 FROM prefunded_card.treasury_bindings),'failure releases once');
  outcome:=prefunded_card.complete_reconciliation('70000000-0000-4000-8000-000000000001',
    (second_claim->>'token')::uuid,(second_claim->>'fence')::bigint,'collection','verified_failed',evidence);
  PERFORM prefunded_card_test.assert(outcome='stale','completed verification cannot release twice');
  PERFORM prefunded_card_test.assert((SELECT reserved_kobo=reserved_before-10000 FROM prefunded_card.treasury_bindings),'duplicate preserves reservation');
END $$;
ROLLBACK;

BEGIN;
SELECT prefunded_card.claim_collection('70000000-0000-4000-8000-000000000003',0);
SELECT prefunded_card_test.assert(prefunded_card.record_collection('70000000-0000-4000-8000-000000000003',1,NULL,
  jsonb_build_object('reference','collection-3','amountKobo',10000,'currency','NGN',
    'savedMethodId','60000000-0000-4000-8000-000000000001','providerTransactionId','null-status-3'))='reconciliation_required',
  'NULL terminal status must not mark collection failed or successful');
SELECT prefunded_card_test.assert((SELECT reserved_kobo=30000 FROM prefunded_card.treasury_bindings),'NULL does not release capacity');
ROLLBACK;

BEGIN;
SELECT prefunded_card.claim_collection('70000000-0000-4000-8000-000000000003',0);
SELECT prefunded_card_test.assert(prefunded_card.record_collection('70000000-0000-4000-8000-000000000003',1,'verified_success',
  '{"amountKobo":"not-a-number"}')='reconciliation_required','malformed collection evidence is bounded');
UPDATE prefunded_card.operations SET transfer_status='dispatching' WHERE id='70000000-0000-4000-8000-000000000002';
SELECT prefunded_card_test.assert(prefunded_card.record_transfer('70000000-0000-4000-8000-000000000002',1,'verified_success',
  '{"amountKobo":9007199254740992}')='reconciliation_required','overflow transfer evidence is bounded');
DO $$ DECLARE claim jsonb; BEGIN
  claim:=prefunded_card.claim_reconciliation('70000000-0000-4000-8000-000000000001',60);
  PERFORM prefunded_card_test.assert(prefunded_card.complete_reconciliation('70000000-0000-4000-8000-000000000001',
    (claim->>'token')::uuid,(claim->>'fence')::bigint,'collection','verified_success','{"amountKobo":null}')='reconciliation_required',
    'malformed verifier evidence is bounded');
END $$;
SELECT prefunded_card_test.assert((SELECT reserved_kobo=30000 AND consumed_kobo=0 FROM prefunded_card.treasury_bindings),'malformed evidence never changes float');
ROLLBACK;
