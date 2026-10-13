-- Narrow the bank-inflow custody hold to the matching card transfer.
-- Previously any custody_pending or reconciliation_required operation
-- deferred every bank deposit for the customer. reconciliation_required is
-- terminal (no function transitions out of it and status() short-circuits),
-- so holding on it deferred unrelated deposits indefinitely with zero
-- protective value. For transient custody_pending operations the hold now
-- requires the receipt amount to equal the operation amount: settlement
-- adopts a recorded receipt only on exact economic identity, so a receipt
-- that cannot be adopted gains nothing from deferral, while a matching
-- card leg still waits for alias registration. Same-amount unrelated
-- deposits still defer briefly (safe direction) and credit after
-- settlement; a wrong-amount card leg credits immediately and surfaces as
-- a settlement conflict for operator attention instead of silently
-- completing.
BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary.apply_inflow(integration_id uuid, receipt jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  binding piggyvest_primary.integrations%ROWTYPE;
  intent piggyvest_primary.onboarding_intents%ROWTYPE;
  existing piggyvest_primary.inflow_receipts%ROWTYPE;
  identity jsonb;
  receipt_id uuid := gen_random_uuid();
  transaction_id uuid := gen_random_uuid();
  wallet_id uuid;
  balance numeric;
  amount numeric;
  field text;
BEGIN
  SELECT integration.* INTO binding FROM piggyvest_primary.integrations integration
    JOIN piggyvest_primary.inflow_authorities authority ON authority.integration_id=integration.id
    WHERE integration.id=$1 AND integration.enabled AND authority.enabled AND (authority.executor_login=SESSION_USER OR EXISTS(SELECT 1 FROM piggyvest_primary.bank_inbox_authorities bank
      WHERE bank.integration_id=integration.id AND bank.enabled AND bank.worker_login=SESSION_USER
        AND bank.environment=integration.environment AND bank.business_id=integration.business_id AND bank.merchant_id=integration.merchant_id
        AND bank.expires_at>clock_timestamp() AND pg_has_role(SESSION_USER,'primary_bank_inbox_worker','MEMBER'))) FOR SHARE OF integration,authority;
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
  IF EXISTS(SELECT 1 FROM piggyvest_primary_card.operations operation WHERE operation.integration_id=binding.id
    AND operation.customer_id=intent.customer_id AND operation.merchant_id=intent.merchant_id
    AND operation.state='custody_pending' AND operation.amount_kobo=(receipt->>'amountKobo')::bigint) THEN RETURN 'prerequisite'; END IF;
  INSERT INTO public.customer_wallets(customer_id,merchant_id,available_balance,total_earned) VALUES(intent.customer_id,intent.merchant_id,amount,0)
    ON CONFLICT(customer_id) DO UPDATE SET available_balance=public.customer_wallets.available_balance+EXCLUDED.available_balance,updated_at=clock_timestamp()
    WHERE public.customer_wallets.merchant_id=EXCLUDED.merchant_id RETURNING id,available_balance INTO wallet_id,balance;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet ownership mismatch' USING ERRCODE='42501'; END IF;
  INSERT INTO public.customer_wallet_transactions(id,wallet_id,customer_id,merchant_id,type,amount,balance_after,source_type,source_id,description)
    VALUES(transaction_id,wallet_id,intent.customer_id,intent.merchant_id,'credit',amount,balance,'piggyvest_primary_inflow',receipt_id,'PiggyVest bank transfer');
  INSERT INTO piggyvest_primary.inflow_receipts(id,integration_id,intent_id,provider_transaction_id,event_id,body_digest,financial_identity,wallet_transaction_id)
    VALUES(receipt_id,binding.id,intent.id,receipt->>'providerTransactionId',receipt->>'eventId',receipt->>'bodyDigest',identity,transaction_id);
  INSERT INTO piggyvest_primary.custody_transaction_aliases(integration_id,provider_transaction_id,receipt_id) VALUES(binding.id,receipt->>'providerTransactionId',receipt_id);
  RETURN 'credited';
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.apply_inflow(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role,piggyvest_primary_evidence,primary_card_custody_evidence;
COMMIT;
