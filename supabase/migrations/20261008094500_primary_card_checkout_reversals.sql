-- Route Paystack refund/dispute webhooks to a durable reversal record.
-- charge webhooks reconcile money-in through record_collection, but a
-- refund or dispute against a checkout reference had no destination:
-- the delivery carried the ORIGINAL reference in transaction_reference
-- (which the charge path never reads) and died as noise. An ignored
-- refund is a customer charged twice — Paystack returned the money
-- while custody still settles the full amount to us. checkout_reversals
-- is the money-out counterpart of collections: one row per provider
-- event, keyed to the operation by the cross-bound reference. Against
-- an uncollected checkout the reversal abandons the operation (freeing
-- the one-unresolved slot and releasing treasury, like a customer
-- cancellation); against a collected checkout it records only, and two
-- fences keep the ledger honest: record_collection rejects a reversed
-- reference, and settle_custody_ledger_impl returns 'conflict' instead
-- of crediting. No autonomous debit is attempted — a collected
-- reversal needs an operator to reconcile the provider-side money
-- movement against custody — but the evidence is durable and the
-- double-credit is structurally impossible. The function drains
-- post-expiry like the other existing-operation evidence paths.
BEGIN;
CREATE TABLE piggyvest_primary_card.checkout_reversals (
  operation_id uuid NOT NULL REFERENCES piggyvest_primary_card.operations(id) ON DELETE RESTRICT,
  integration_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('refund','dispute')),
  provider_event_id text NOT NULL CHECK(octet_length(provider_event_id) BETWEEN 1 AND 128),
  evidence jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(operation_id,provider_event_id)
);
CREATE UNIQUE INDEX primary_card_checkout_reversals_event_idx ON piggyvest_primary_card.checkout_reversals(provider_event_id);
CREATE INDEX primary_card_checkout_reversals_integration_idx ON piggyvest_primary_card.checkout_reversals(integration_id);
ALTER TABLE piggyvest_primary_card.checkout_reversals ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_card_checkout_reversals_deny ON piggyvest_primary_card.checkout_reversals AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
CREATE FUNCTION piggyvest_primary_card.record_checkout_reversal(scope jsonb, operation_id uuid, kind text, provider_event_id text, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary_card.operations%ROWTYPE;
  existing piggyvest_primary_card.checkout_reversals%ROWTYPE;
  reservation_binding_id uuid;
BEGIN
  PERFORM piggyvest_primary_card.assert_scope(scope,true,true);
  SELECT * INTO STRICT operation FROM piggyvest_primary_card.operations WHERE id=operation_id
    AND integration_id=(scope->>'integrationId')::uuid AND merchant_id=(scope->>'merchantId')::uuid
    AND customer_id=(scope->>'customerId')::uuid AND user_id=(scope->>'userId')::uuid FOR UPDATE;
  IF kind NOT IN ('refund','dispute') OR provider_event_id IS NULL OR octet_length(provider_event_id) NOT BETWEEN 1 AND 128
    OR jsonb_typeof(payload) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(payload)) <> 6
    OR payload->>'event' NOT IN ('refund.processed','charge.dispute.create')
    OR payload->>'kind' IS DISTINCT FROM kind
    OR payload->>'transactionReference' IS DISTINCT FROM 'pvb-first-primary-'||operation_id::text
    THEN RAISE EXCEPTION 'invalid reversal evidence' USING ERRCODE='22023'; END IF;
  -- Informational fields may be JSON null (event shapes that carry no
  -- amount); when present they must be well-formed.
  IF payload->'amountKobo' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(payload->'amountKobo') IS DISTINCT FROM 'number'
    OR (payload->>'amountKobo')::numeric <> trunc((payload->>'amountKobo')::numeric)
    OR (payload->>'amountKobo')::numeric NOT BETWEEN 1 AND 9999999999) THEN RAISE EXCEPTION 'invalid reversal amount' USING ERRCODE='22023'; END IF;
  IF payload->'currency' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(payload->'currency') IS DISTINCT FROM 'string'
    OR payload->>'currency' IS DISTINCT FROM 'NGN') THEN RAISE EXCEPTION 'invalid reversal currency' USING ERRCODE='22023'; END IF;
  IF payload->'status' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(payload->'status') IS DISTINCT FROM 'string'
    OR octet_length(payload->>'status') NOT BETWEEN 1 AND 64) THEN RAISE EXCEPTION 'invalid reversal status' USING ERRCODE='22023'; END IF;
  SELECT * INTO existing FROM piggyvest_primary_card.checkout_reversals WHERE checkout_reversals.provider_event_id=record_checkout_reversal.provider_event_id;
  IF FOUND THEN
    IF existing.operation_id IS DISTINCT FROM operation.id OR existing.kind IS DISTINCT FROM kind OR existing.evidence <> payload THEN
      RAISE EXCEPTION 'reversal identity conflict' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('outcome','duplicate');
  END IF;
  PERFORM collections.operation_id FROM piggyvest_primary_card.collections WHERE collections.operation_id=operation.id FOR SHARE;
  IF NOT FOUND THEN
    IF operation.state = 'reserved' THEN
      UPDATE piggyvest_primary_card.operations SET state='abandoned',claim_token=NULL,updated_at=clock_timestamp() WHERE id=operation.id;
      IF to_regclass('piggyvest_primary_card.reservations') IS NOT NULL THEN
        SELECT reservations.treasury_binding_id INTO reservation_binding_id FROM piggyvest_primary_card.reservations
          WHERE reservations.operation_id=operation.id AND state='reserved' FOR UPDATE;
        IF FOUND THEN
          UPDATE piggyvest_primary_card.reservations SET state='released' WHERE reservations.operation_id=operation.id;
          IF to_regclass('prefunded_card.treasury_bindings') IS NOT NULL THEN
            EXECUTE 'UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo-$2 WHERE id=$1'
              USING reservation_binding_id,operation.amount_kobo;
          END IF;
        END IF;
      END IF;
    ELSIF operation.state IN ('initializing','init_unknown','ready') THEN
      PERFORM piggyvest_primary_card.record_abandonment(scope,operation.id);
    END IF;
  END IF;
  INSERT INTO piggyvest_primary_card.checkout_reversals(operation_id,integration_id,kind,provider_event_id,evidence)
    VALUES(operation.id,operation.integration_id,kind,provider_event_id,payload);
  RETURN jsonb_build_object('outcome','recorded');
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.record_collection(scope jsonb, operation_id uuid, collection jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary_card.operations%ROWTYPE;
  existing piggyvest_primary_card.collections%ROWTYPE;
  token jsonb;
BEGIN
  PERFORM piggyvest_primary_card.assert_scope(scope,true,true);
  SELECT * INTO STRICT operation FROM piggyvest_primary_card.operations WHERE id=operation_id
    AND integration_id=(scope->>'integrationId')::uuid AND merchant_id=(scope->>'merchantId')::uuid
    AND customer_id=(scope->>'customerId')::uuid AND user_id=(scope->>'userId')::uuid FOR UPDATE;
  IF jsonb_typeof(collection) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(collection)) <> 5
    OR collection->>'reference' IS DISTINCT FROM 'pvb-first-primary-'||operation_id::text
    OR jsonb_typeof(collection->'amountKobo') IS DISTINCT FROM 'number'
    OR (collection->>'amountKobo')::numeric IS DISTINCT FROM operation.amount_kobo::numeric
    OR collection->>'domain' IS DISTINCT FROM (CASE WHEN operation.environment='production' THEN 'live' ELSE 'test' END)
    OR collection->>'providerTransactionId' IS NULL OR collection->>'providerTransactionId' !~ '^[1-9][0-9]{0,19}$'
    OR (collection->>'providerTransactionId')::numeric > 18446744073709551615
    OR NOT collection ? 'token' THEN RAISE EXCEPTION 'invalid collection evidence' USING ERRCODE='22023'; END IF;
  token := NULLIF(collection->'token','null'::jsonb);
  IF token IS NOT NULL AND (operation.consent->'saveCard' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(token) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(token)) <> 4
    OR token->'reusable' IS DISTINCT FROM 'true'::jsonb OR token->>'email' IS DISTINCT FROM operation.email
    OR token->>'authorizationCode' IS NULL OR token->>'authorizationCode' !~ '^AUTH_[A-Za-z0-9_]+$'
    OR octet_length(token->>'authorizationCode') > 512
    OR token->>'customerCode' IS NULL OR token->>'customerCode' !~ '^CUS_[A-Za-z0-9_]+$'
    OR octet_length(token->>'customerCode') > 512) THEN
    RAISE EXCEPTION 'invalid saved card consent' USING ERRCODE='22023';
  END IF;
  SELECT * INTO existing FROM piggyvest_primary_card.collections stored WHERE stored.operation_id=$2;
  IF FOUND THEN
    IF existing.evidence <> collection-'token' OR existing.saved_token IS DISTINCT FROM token THEN
      RAISE EXCEPTION 'collection identity conflict' USING ERRCODE='22023';
    END IF;
    RETURN true;
  END IF;
  IF to_regclass('piggyvest_primary_card.checkout_reversals') IS NOT NULL
    AND EXISTS(SELECT 1 FROM piggyvest_primary_card.checkout_reversals WHERE checkout_reversals.operation_id=$2) THEN
    RAISE EXCEPTION 'reversed checkout collection' USING ERRCODE='22023';
  END IF;
  IF operation.state NOT IN ('initializing','init_unknown','ready') THEN
    RAISE EXCEPTION 'invalid collection state' USING ERRCODE='22023';
  END IF;
  INSERT INTO piggyvest_primary_card.collections(operation_id,integration_id,environment,provider_transaction_id,evidence,saved_token)
    VALUES(operation.id,operation.integration_id,operation.environment,collection->>'providerTransactionId',collection-'token',token);
  UPDATE piggyvest_primary_card.operations SET state='custody_pending',claim_token=NULL,updated_at=clock_timestamp() WHERE id=operation.id;
  RETURN true;
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
  IF to_regclass('piggyvest_primary_card.checkout_reversals') IS NOT NULL
    AND EXISTS(SELECT 1 FROM piggyvest_primary_card.checkout_reversals WHERE checkout_reversals.operation_id=operation.id) THEN RETURN 'conflict'; END IF;
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
REVOKE ALL ON FUNCTION piggyvest_primary_card.record_checkout_reversal(jsonb,uuid,text,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,primary_card_authorizer;
GRANT EXECUTE ON FUNCTION piggyvest_primary_card.record_checkout_reversal(jsonb,uuid,text,text,jsonb) TO primary_card_evidence;
COMMIT;
