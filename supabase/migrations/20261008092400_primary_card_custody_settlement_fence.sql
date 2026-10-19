-- Fence custody settlement on the live inbox claim. A conflicting
-- redelivery moves the original inbox row to blocked/proof_conflict and
-- clears its claim token, but the worker settles (settle_custody) before
-- it finishes (finish_signed_inbox), and each executor call commits
-- separately — so an in-flight holder could credit the wallet and then
-- merely fail its finish acknowledgement. Bind settlement atomically to
-- the claim: the proof now carries the inbox claim token (20 keys), and
-- settle_custody locks the inbox row and requires processing state with
-- the matching token and body digest before running the ledger. The
-- token joins the duplicate-compare exclusions so a reclaimed retry of
-- an already-settled event still reports duplicate, not conflict.
BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.settle_custody(target_integration_id uuid, environment text, proof jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE outcome text; inbox piggyvest_primary_card.signed_inbox%ROWTYPE;
BEGIN
  IF jsonb_typeof(proof->'inboxToken') IS DISTINCT FROM 'string'
    OR proof->>'inboxToken' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR jsonb_typeof(proof->'eventId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'invalid custody proof' USING ERRCODE='22023'; END IF;
  SELECT * INTO inbox FROM piggyvest_primary_card.signed_inbox WHERE integration_id=$1 AND event_id=proof->>'eventId' FOR UPDATE;
  IF NOT FOUND OR inbox.state IS DISTINCT FROM 'processing'
    OR inbox.claim_token IS DISTINCT FROM (proof->>'inboxToken')::uuid
    OR inbox.body_digest IS DISTINCT FROM proof->>'bodyDigest'
    THEN RAISE EXCEPTION 'signed inbox claim unavailable' USING ERRCODE='42501'; END IF;
  outcome := piggyvest_primary_card.settle_custody_ledger_impl($1,$2,$3);
  IF outcome IN ('completed','duplicate') THEN
    INSERT INTO piggyvest_primary_card.signed_custody_observations(integration_id,event_id,body_digest,operation_id)
      VALUES($1,proof->>'eventId',proof->>'bodyDigest',(proof->>'operationId')::uuid) ON CONFLICT(integration_id,event_id,body_digest) DO NOTHING;
    IF EXISTS(SELECT 1 FROM piggyvest_primary_card.signed_custody_observations WHERE integration_id=$1 AND event_id=proof->>'eventId'
      AND body_digest=proof->>'bodyDigest' AND operation_id<>(proof->>'operationId')::uuid) THEN RAISE EXCEPTION 'signed observation conflict' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN outcome;
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
  transaction_id uuid;
  wallet_id uuid;
  balance numeric;
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
    resolved_receipt_id := gen_random_uuid(); transaction_id := gen_random_uuid();
    INSERT INTO public.customer_wallets(customer_id,merchant_id,available_balance,total_earned) VALUES(operation.customer_id,operation.merchant_id,amount,0)
      ON CONFLICT(customer_id) DO UPDATE SET available_balance=public.customer_wallets.available_balance+EXCLUDED.available_balance,updated_at=clock_timestamp()
      WHERE public.customer_wallets.merchant_id=EXCLUDED.merchant_id RETURNING id,available_balance INTO wallet_id,balance;
    IF NOT FOUND THEN RAISE EXCEPTION 'custody wallet ownership mismatch' USING ERRCODE='42501'; END IF;
    INSERT INTO public.customer_wallet_transactions(id,wallet_id,customer_id,merchant_id,type,amount,balance_after,source_type,source_id,description)
      VALUES(transaction_id,wallet_id,operation.customer_id,operation.merchant_id,'credit',amount,balance,'piggyvest_primary_card_custody',resolved_receipt_id,'PiggyVest card funding');
    INSERT INTO piggyvest_primary.inflow_receipts(id,integration_id,intent_id,provider_transaction_id,event_id,body_digest,financial_identity,wallet_transaction_id)
      VALUES(resolved_receipt_id,$1,mapping_id,proof->>'providerTransactionId',proof->>'eventId',proof->>'bodyDigest',identity,transaction_id);
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
COMMIT;
