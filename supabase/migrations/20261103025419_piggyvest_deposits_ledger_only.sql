-- PiggyVest is the system of record for money. A PiggyVest deposit (bank
-- transfer or card funding) is now recorded in the PiggyVest receipt
-- ledger (piggyvest_primary.inflow_receipts) only. It no longer adds to the
-- legacy wallet row (public.customer_wallets) or writes a legacy wallet
-- transaction, so old and new money can never be counted twice.
--
-- What stays the same: every identity, duplicate, conflict, event-reuse,
-- verified-mapping and authority check in both functions. Only the legacy
-- credit is removed, so the receipt row keeps the same shape with
-- wallet_transaction_id left empty (the column is already nullable).
-- Refunds, savings holds and releases are separate paths and are untouched.
--
-- Row-variable hydration: the SELECT * ... INTO <record/row variable> and
-- SELECT alias.* INTO statements below only load a whole row of the function's
-- own table into a local PL/pgSQL variable (unchanged from the prior function
-- bodies). They never return, log or expose columns to a caller, so they are
-- not the client-facing select('*') the repository forbids.
--
-- A guard trigger then rejects any later attempt to write a deposit row
-- (either deposit source) to the legacy wallet transaction history, so a future function edit
-- cannot quietly bring the old behaviour back.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- A ledger-only receipt has no legacy wallet transaction. The account
-- deletion migration already made this nullable; restating it keeps this
-- migration self-sufficient and is a no-op where it is already nullable.
ALTER TABLE piggyvest_primary.inflow_receipts
  ALTER COLUMN wallet_transaction_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION piggyvest_primary.apply_inflow(integration_id uuid, receipt jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  binding piggyvest_primary.integrations%ROWTYPE;
  intent piggyvest_primary.onboarding_intents%ROWTYPE;
  existing piggyvest_primary.inflow_receipts%ROWTYPE;
  identity jsonb;
  receipt_id uuid := gen_random_uuid();
  amount numeric;
  field text;
BEGIN
  SELECT integration.* INTO binding FROM piggyvest_primary.integrations integration
    JOIN piggyvest_primary.inflow_authorities authority ON authority.integration_id=integration.id
    WHERE integration.id=$1 AND integration.enabled AND authority.enabled AND (authority.executor_login=SESSION_USER OR EXISTS(SELECT 1 FROM piggyvest_primary.bank_inbox_authorities bank
      WHERE bank.integration_id=integration.id AND bank.enabled AND bank.worker_login=SESSION_USER
        AND bank.environment=integration.environment AND bank.business_id=integration.business_id AND bank.merchant_id=integration.merchant_id
        AND pg_has_role(SESSION_USER,'primary_bank_inbox_worker','MEMBER'))) FOR SHARE OF integration,authority;
  IF NOT FOUND THEN RAISE EXCEPTION 'inflow authority unavailable' USING ERRCODE='42501'; END IF;
  IF receipt IS NULL OR jsonb_typeof(receipt)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(receipt))<>13
    OR NOT receipt ?& ARRAY['eventId','providerTransactionId','providerCustomerId','providerWalletId','eventDataId','amountKobo','feeKobo','currency','reference','sessionId','creditedAt','financialFingerprint','bodyDigest']
    OR receipt->>'currency'<>'NGN' OR receipt->>'amountKobo' !~ '^[1-9][0-9]*$' OR receipt->>'feeKobo' !~ '^[0-9]+$'
    OR receipt->>'financialFingerprint' !~ '^[a-f0-9]{64}$' OR receipt->>'bodyDigest' !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid inflow receipt' USING ERRCODE='22023';
  END IF;
  FOREACH field IN ARRAY ARRAY['eventId','providerTransactionId','providerCustomerId','providerWalletId','eventDataId','currency','reference','creditedAt','financialFingerprint','bodyDigest'] LOOP
    IF jsonb_typeof(receipt->field) IS DISTINCT FROM 'string' OR octet_length(receipt->>field) NOT BETWEEN 1 AND 512 THEN
      RAISE EXCEPTION 'invalid inflow field' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF jsonb_typeof(receipt->'amountKobo') IS DISTINCT FROM 'number' OR jsonb_typeof(receipt->'feeKobo') IS DISTINCT FROM 'number'
    OR jsonb_typeof(receipt->'sessionId') NOT IN ('string','null') THEN RAISE EXCEPTION 'invalid inflow amount or session' USING ERRCODE='22023'; END IF;
  amount := (receipt->>'amountKobo')::numeric/100;
  IF amount>=100000000 THEN RAISE EXCEPTION 'inflow amount outside ledger range' USING ERRCODE='22023'; END IF;
  PERFORM (receipt->>'creditedAt')::timestamptz;
  SELECT candidate.* INTO intent FROM piggyvest_primary.onboarding_intents candidate
    JOIN public.customers customer ON customer.id=candidate.customer_id AND customer.merchant_id=candidate.merchant_id AND customer.user_id=candidate.user_id
    WHERE candidate.integration_id=binding.id AND candidate.merchant_id=binding.merchant_id AND candidate.provider_customer_id=receipt->>'providerCustomerId'
      AND candidate.provider_wallet_id=receipt->>'providerWalletId' AND candidate.state IN ('accepted','verified') FOR SHARE OF candidate,customer;
  IF NOT FOUND THEN RETURN 'unmapped'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('piggyvest-primary-custody:'||binding.id::text,0));
  identity := receipt-ARRAY['eventId','bodyDigest','financialFingerprint'];
  SELECT stored.* INTO existing FROM piggyvest_primary.inflow_receipts stored
    LEFT JOIN piggyvest_primary.custody_transaction_aliases alias ON alias.receipt_id=stored.id
    WHERE stored.integration_id=binding.id AND (alias.provider_transaction_id=receipt->>'providerTransactionId' OR stored.provider_transaction_id=receipt->>'providerTransactionId');
  IF FOUND THEN
    IF existing.intent_id<>intent.id THEN RETURN 'conflict'; END IF;
    IF existing.financial_identity->>'custodyKind'='card' THEN
      IF existing.financial_identity->'amountKobo' IS DISTINCT FROM receipt->'amountKobo'
        OR existing.financial_identity->'feeKobo' IS DISTINCT FROM receipt->'feeKobo'
        OR existing.financial_identity->'currency' IS DISTINCT FROM receipt->'currency'
        OR existing.financial_identity->'providerCustomerId' IS DISTINCT FROM receipt->'providerCustomerId'
        OR existing.financial_identity->'providerWalletId' IS DISTINCT FROM receipt->'providerWalletId' THEN RETURN 'conflict'; END IF;
    ELSIF existing.financial_identity<>identity THEN RETURN 'conflict'; END IF;
    RETURN 'duplicate';
  END IF;
  -- Event identity is independent of the transaction reference: a provider
  -- retry that reuses the event ID for a NEW transaction must never
  -- credit twice. The lookup above keys only on the transaction ID (or
  -- its aliases), so fence the reused event for review instead.
  IF EXISTS(SELECT 1 FROM piggyvest_primary.inflow_receipts stored
    WHERE stored.integration_id=binding.id AND stored.event_id=receipt->>'eventId'
      AND stored.provider_transaction_id IS DISTINCT FROM receipt->>'providerTransactionId')
  THEN RETURN 'conflict'; END IF;
  IF intent.state IS DISTINCT FROM 'verified' THEN RETURN 'prerequisite'; END IF;
  IF EXISTS(SELECT 1 FROM piggyvest_primary_card.operations operation WHERE operation.integration_id=binding.id
    AND operation.customer_id=intent.customer_id AND operation.merchant_id=intent.merchant_id
    AND operation.state='custody_pending' AND operation.amount_kobo=(receipt->>'amountKobo')::bigint) THEN RETURN 'prerequisite'; END IF;
  INSERT INTO piggyvest_primary.inflow_receipts(id,integration_id,intent_id,provider_transaction_id,event_id,body_digest,financial_identity,wallet_transaction_id)
    VALUES(receipt_id,binding.id,intent.id,receipt->>'providerTransactionId',receipt->>'eventId',receipt->>'bodyDigest',identity,NULL);
  INSERT INTO piggyvest_primary.custody_transaction_aliases(integration_id,provider_transaction_id,receipt_id) VALUES(binding.id,receipt->>'providerTransactionId',receipt_id);
  RETURN 'credited';
END $$;

CREATE OR REPLACE FUNCTION piggyvest_primary_card.settle_custody_ledger_impl(target_integration_id uuid, environment text, proof jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary_card.operations%ROWTYPE;
  reservation piggyvest_primary_card.reservations%ROWTYPE;
  policy piggyvest_primary_card.treasury_policy%ROWTYPE;
  prior piggyvest_primary_card.settlements%ROWTYPE;
  receipt piggyvest_primary.inflow_receipts%ROWTYPE;
  binding record;
  context jsonb;
  aliases text[];
  receipts uuid[];
  mapping_id uuid;
  resolved_receipt_id uuid;
  amount numeric;
  identity jsonb;
  field text;
BEGIN
  PERFORM piggyvest_primary_card.assert_worker($1,$2,true);
  IF jsonb_typeof(proof) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(proof))<>20 THEN RAISE EXCEPTION 'invalid custody proof' USING ERRCODE='22023'; END IF;
  IF proof->>'inboxToken' IS NULL OR proof->>'inboxToken' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RAISE EXCEPTION 'invalid custody proof' USING ERRCODE='22023'; END IF;
  context := piggyvest_primary_card.transfer_context($1,$2,(proof->>'operationId')::uuid);
  IF NOT proof @> context OR proof->>'currency' IS DISTINCT FROM 'NGN' OR proof->'feeKobo' IS DISTINCT FROM '0'::jsonb
    OR proof->>'bodyDigest' IS NULL OR proof->>'bodyDigest' !~ '^[a-f0-9]{64}$'
    OR proof->>'crosswalkDigest' IS NULL OR proof->>'crosswalkDigest' !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(proof->'transactionAliases') IS DISTINCT FROM 'array'
    OR jsonb_array_length(proof->'transactionAliases') NOT BETWEEN 1 AND 8 THEN RAISE EXCEPTION 'invalid custody economics' USING ERRCODE='22023'; END IF;
  FOREACH field IN ARRAY ARRAY['providerTransactionId','eventId','observedAt'] LOOP
    IF jsonb_typeof(proof->field) IS DISTINCT FROM 'string' OR octet_length(proof->>field) NOT BETWEEN 1 AND 512 THEN RAISE EXCEPTION 'invalid custody identity' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'transactionAliases') value WHERE jsonb_typeof(value)<>'string' OR octet_length(value#>>'{}') NOT BETWEEN 1 AND 512) THEN RAISE EXCEPTION 'invalid custody aliases' USING ERRCODE='22023'; END IF;
  SELECT array_agg(DISTINCT value ORDER BY value) INTO aliases FROM jsonb_array_elements_text(proof->'transactionAliases') value;
  IF cardinality(aliases)<>jsonb_array_length(proof->'transactionAliases') OR NOT (proof->>'providerTransactionId'=ANY(aliases)) THEN RAISE EXCEPTION 'incomplete custody aliases' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('piggyvest-primary-custody:'||$1::text,0));
  SELECT * INTO STRICT operation FROM piggyvest_primary_card.operations WHERE id=(proof->>'operationId')::uuid FOR UPDATE;
  SELECT * INTO prior FROM piggyvest_primary_card.settlements WHERE settlements.operation_id=operation.id;
  IF FOUND THEN
    IF prior.proof-ARRAY['eventId','bodyDigest','crosswalkDigest','observedAt','inboxToken'] <> proof-ARRAY['eventId','bodyDigest','crosswalkDigest','observedAt','inboxToken'] THEN RETURN 'conflict'; END IF;
    RETURN 'duplicate';
  END IF;
  IF to_regclass('piggyvest_primary_card.checkout_reversals') IS NOT NULL
    AND EXISTS(SELECT 1 FROM piggyvest_primary_card.checkout_reversals
      WHERE checkout_reversals.operation_id=operation.id AND (resolution IS NULL OR resolution='lost')) THEN RETURN 'conflict'; END IF;
  IF (proof->>'observedAt')::timestamptz<clock_timestamp()-interval '60 seconds' OR (proof->>'observedAt')::timestamptz>clock_timestamp()+interval '5 seconds' THEN RAISE EXCEPTION 'stale custody observation' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT reservation FROM piggyvest_primary_card.reservations WHERE reservations.operation_id=operation.id AND state='reserved' FOR UPDATE;
  SELECT * INTO STRICT policy FROM piggyvest_primary_card.treasury_policy WHERE treasury_policy.integration_id=$1 AND enabled FOR SHARE;
  PERFORM operation_id FROM piggyvest_primary_card.collections WHERE operation_id=operation.id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'uncollected custody' USING ERRCODE='42501'; END IF;
  PERFORM operation_id FROM piggyvest_primary_card.transfer_outbox WHERE operation_id=operation.id AND state IN ('dispatching','submitted','unknown') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'undispatched custody' USING ERRCODE='42501'; END IF;
  IF reservation.treasury_binding_id<>policy.treasury_binding_id OR reservation.source_wallet_id<>policy.source_wallet_id THEN RAISE EXCEPTION 'changed treasury policy' USING ERRCODE='42501'; END IF;
  EXECUTE 'SELECT * FROM prefunded_card.treasury_bindings WHERE id=$1 FOR UPDATE' INTO STRICT binding USING reservation.treasury_binding_id;
  IF binding.authorized_login<>policy.owner_login OR binding.source_wallet_id<>reservation.source_wallet_id
    OR binding.merchant_id<>operation.merchant_id OR binding.expected_business_id<>operation.business_id OR binding.currency<>'NGN'
    OR binding.reserved_kobo<operation.amount_kobo THEN RAISE EXCEPTION 'custody treasury conflict' USING ERRCODE='42501'; END IF;
  SELECT id INTO STRICT mapping_id FROM piggyvest_primary.onboarding_intents WHERE onboarding_intents.integration_id=$1
    AND customer_id=operation.customer_id AND merchant_id=operation.merchant_id AND user_id=operation.user_id
    AND provider_wallet_id=operation.destination_wallet_id AND provider_customer_id=operation.destination_customer_id AND state='verified' FOR SHARE;
  SELECT array_agg(DISTINCT stored.id) INTO receipts FROM piggyvest_primary.inflow_receipts stored
    LEFT JOIN piggyvest_primary.custody_transaction_aliases alias ON alias.receipt_id=stored.id
    WHERE stored.integration_id=$1 AND (stored.provider_transaction_id=ANY(aliases) OR alias.provider_transaction_id=ANY(aliases));
  IF cardinality(receipts)>1 THEN RETURN 'conflict'; END IF;
  identity := jsonb_build_object('custodyKind','card','providerTransactionId',proof->>'providerTransactionId','providerCustomerId',operation.destination_customer_id,
    'providerWalletId',operation.destination_wallet_id,'amountKobo',operation.amount_kobo,'feeKobo',0,'currency','NGN','reference',reservation.transfer_reference);
  IF cardinality(receipts)=1 THEN
    SELECT * INTO STRICT receipt FROM piggyvest_primary.inflow_receipts WHERE id=receipts[1];
    IF receipt.intent_id<>mapping_id OR NOT receipt.financial_identity @> (identity-ARRAY['custodyKind','providerTransactionId','reference']) THEN RETURN 'conflict'; END IF;
    resolved_receipt_id := receipt.id;
    PERFORM operation_id FROM piggyvest_primary_card.settlements WHERE settlements.receipt_id=resolved_receipt_id;
    IF FOUND THEN RETURN 'conflict'; END IF;
  ELSE
    amount := operation.amount_kobo::numeric/100;
    IF amount>=100000000 THEN RAISE EXCEPTION 'custody amount outside ledger range' USING ERRCODE='22023'; END IF;
    resolved_receipt_id := gen_random_uuid();
    INSERT INTO piggyvest_primary.inflow_receipts(id,integration_id,intent_id,provider_transaction_id,event_id,body_digest,financial_identity,wallet_transaction_id)
      VALUES(resolved_receipt_id,$1,mapping_id,proof->>'providerTransactionId',proof->>'eventId',proof->>'bodyDigest',identity,NULL);
  END IF;
  INSERT INTO piggyvest_primary.custody_transaction_aliases(integration_id,provider_transaction_id,receipt_id)
    SELECT $1,alias,resolved_receipt_id FROM unnest(aliases) alias ON CONFLICT(integration_id,provider_transaction_id) DO NOTHING;
  IF EXISTS(SELECT 1 FROM piggyvest_primary.custody_transaction_aliases stored WHERE stored.integration_id=$1 AND stored.provider_transaction_id=ANY(aliases) AND stored.receipt_id<>resolved_receipt_id) THEN RAISE EXCEPTION 'custody alias conflict' USING ERRCODE='23514'; END IF;
  EXECUTE 'UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo-$2,consumed_kobo=consumed_kobo+$2 WHERE id=$1' USING reservation.treasury_binding_id,operation.amount_kobo;
  UPDATE piggyvest_primary_card.reservations SET state='consumed' WHERE reservations.operation_id=operation.id;
  UPDATE piggyvest_primary_card.transfer_outbox SET state='completed',claim_token=NULL,updated_at=clock_timestamp() WHERE operation_id=operation.id;
  INSERT INTO piggyvest_primary_card.settlements(operation_id,receipt_id,proof) VALUES(operation.id,resolved_receipt_id,proof);
  INSERT INTO piggyvest_primary_card.receivables(operation_id,amount_kobo) VALUES(operation.id,operation.amount_kobo);
  INSERT INTO piggyvest_primary_card.completion_outbox(operation_id) VALUES(operation.id);
  UPDATE piggyvest_primary_card.operations SET state='completed',updated_at=clock_timestamp() WHERE id=operation.id;
  RETURN 'completed';
END $$;

CREATE FUNCTION piggyvest_primary.reject_deposit_wallet_credit()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'PiggyVest deposits are recorded in the PiggyVest ledger only'
    USING ERRCODE = '23514';
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.reject_deposit_wallet_credit()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER reject_piggyvest_deposit_wallet_credit
  BEFORE INSERT OR UPDATE OF source_type ON public.customer_wallet_transactions
  FOR EACH ROW
  WHEN (NEW.source_type IN ('piggyvest_primary_inflow', 'piggyvest_primary_card_custody'))
  EXECUTE FUNCTION piggyvest_primary.reject_deposit_wallet_credit();

COMMIT;
