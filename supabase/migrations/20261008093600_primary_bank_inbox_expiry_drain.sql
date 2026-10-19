BEGIN;
-- Drain bank deposits past the deposit deadline. Intake enqueues only
-- owned (existing verified) mappings and the worker processes only
-- enqueued rows, so both are drain-only by construction: requiring
-- expires_at freshness in assert_bank_inbox 503s signed deposits into
-- existing wallets until provider retries exhaust, stranding money
-- with no local credit. Add a drain overload that skips the freshness
-- check while keeping every other binding — including the presented
-- expiresAt equality, so a caller cannot substitute a different
-- deadline — and route readiness, enqueue, claim, process, and retry
-- through it. The drain also drops the role-validity-against-deadline
-- pin (validity must cover the drain window); sessions still fail
-- closed on expired validity. The shared inflow ledger authorizes the
-- bank worker through the same authority row with its own freshness
-- check: drop it there too (rebased on the 092500 verified-mapping
-- version, not the 07230100 original), or claimed deposits would fail
-- at credit time after draining through intake. Decommission sequence:
-- close the provider-side virtual accounts (stops new deposits at the
-- source — hiding app UI cannot, customers keep saved details),
-- extend role validity to cover the drain, let intake+worker clear
-- in-flight deposits, then revoke the roles. enabled=false remains
-- the emergency stop (brief disables are retry-safe).
CREATE FUNCTION piggyvest_primary.assert_bank_inbox(p_integration uuid,p_environment text,p_scope jsonb,p_worker boolean,p_drain boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE expected_role text := CASE WHEN p_worker THEN 'primary_bank_inbox_worker' ELSE 'primary_bank_signed_intake' END;
BEGIN
  IF NOT piggyvest_primary.bank_role_safe(p_worker) THEN RAISE EXCEPTION 'bank capability privileges unsafe' USING ERRCODE='42501'; END IF;
  IF p_scope IS NULL OR p_scope<>jsonb_build_object('merchantId',p_scope->'merchantId','businessId',p_scope->'businessId','expiresAt',p_scope->'expiresAt') THEN
    RAISE EXCEPTION 'invalid bank scope' USING ERRCODE='22023';
  END IF;
  PERFORM binding.integration_id FROM piggyvest_primary.bank_inbox_authorities binding
    JOIN piggyvest_primary.integrations integration ON integration.id=binding.integration_id
    JOIN pg_roles login ON login.rolname=SESSION_USER
    WHERE binding.integration_id=p_integration AND binding.enabled AND integration.enabled
      AND binding.environment=p_environment AND integration.environment=p_environment
      AND binding.merchant_id=integration.merchant_id AND binding.business_id=integration.business_id
      AND binding.merchant_id=(p_scope->>'merchantId')::uuid AND binding.business_id=p_scope->>'businessId'
      AND binding.expires_at=(p_scope->>'expiresAt')::timestamptz AND (p_drain OR binding.expires_at>clock_timestamp())
      AND SESSION_USER=CASE WHEN p_worker THEN binding.worker_login ELSE binding.intake_login END
      AND login.rolcanlogin AND NOT login.rolsuper AND NOT login.rolbypassrls AND NOT login.rolcreaterole AND NOT login.rolcreatedb AND NOT login.rolreplication
      AND login.rolvaliduntil>clock_timestamp() AND (p_drain OR login.rolvaliduntil<=binding.expires_at)
      AND pg_has_role(SESSION_USER,expected_role,'MEMBER')
      AND NOT EXISTS(SELECT 1 FROM pg_auth_members membership JOIN pg_roles parent ON parent.oid=membership.roleid
        WHERE membership.member=login.oid AND parent.rolname<>expected_role)
    FOR SHARE OF binding,integration;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank inbox authority unavailable' USING ERRCODE='42501'; END IF;
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary.assert_bank_inbox(p_integration uuid,p_environment text,p_scope jsonb,p_worker boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary.assert_bank_inbox(p_integration,p_environment,p_scope,p_worker,false);
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.assert_bank_inbox(uuid,text,jsonb,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role,primary_bank_signed_intake,primary_bank_inbox_worker;
CREATE OR REPLACE FUNCTION piggyvest_primary.bank_inbox_readiness(p_integration uuid,p_environment text,p_scope jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary.assert_bank_inbox(p_integration,p_environment,p_scope,SESSION_USER='baci_primary_bank_worker',true);
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary.enqueue_bank_inbox(p_integration uuid,p_environment text,p_scope jsonb,p_command jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE payload bytea; envelope jsonb; fingerprint text; stored piggyvest_primary.bank_signed_inbox%ROWTYPE; owned boolean; ambiguous boolean;
BEGIN
  PERFORM piggyvest_primary.assert_bank_inbox(p_integration,p_environment,p_scope,false,true);
  IF p_command IS NULL OR p_command<>jsonb_build_object('rawHex',p_command->'rawHex','signature',p_command->'signature')
    OR p_command->>'rawHex' !~ '^[a-f0-9]+$' OR length(p_command->>'rawHex') NOT BETWEEN 2 AND 131072
    OR length(p_command->>'rawHex')%2<>0 OR p_command->>'signature' !~ '^[a-f0-9]{128}$' THEN
    RAISE EXCEPTION 'invalid signed bank bytes' USING ERRCODE='22023';
  END IF;
  payload:=decode(p_command->>'rawHex','hex'); envelope:=convert_from(payload,'UTF8')::jsonb;
  IF envelope->>'eventType' IS DISTINCT FROM 'bank-transfer.inflow.success'
    OR jsonb_typeof(envelope->'eventId') IS DISTINCT FROM 'string' OR octet_length(envelope->>'eventId') NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'invalid bank envelope' USING ERRCODE='22023';
  END IF;
  SELECT EXISTS(SELECT 1 FROM piggyvest_primary.onboarding_intents intent JOIN public.customers customer
    ON customer.id=intent.customer_id AND customer.merchant_id=intent.merchant_id AND customer.user_id=intent.user_id
    WHERE intent.integration_id=p_integration AND intent.merchant_id=(p_scope->>'merchantId')::uuid
      AND intent.provider_wallet_id=envelope->>'pvb_wallet' AND intent.provider_customer_id=envelope->>'customer_id'
      AND intent.state IN ('accepted','verified')) INTO owned;
  SELECT EXISTS(SELECT 1 FROM piggyvest_primary.onboarding_intents intent WHERE intent.integration_id=p_integration
    AND intent.merchant_id=(p_scope->>'merchantId')::uuid
    AND (intent.provider_wallet_id=envelope->>'pvb_wallet' OR intent.provider_customer_id=envelope->>'customer_id')) INTO ambiguous;
  IF NOT owned AND NOT ambiguous THEN RETURN 'not_handled'; END IF;
  fingerprint:=encode(sha256(payload),'hex');
  INSERT INTO piggyvest_primary.bank_signed_inbox(integration_id,event_id,payload,signature,body_digest,state,reason)
    VALUES(p_integration,envelope->>'eventId',payload,p_command->>'signature',fingerprint,
      CASE WHEN owned THEN 'pending' ELSE 'blocked' END,CASE WHEN owned THEN NULL ELSE 'financial_conflict' END) ON CONFLICT DO NOTHING;
  IF FOUND THEN RETURN CASE WHEN owned THEN 'accepted' ELSE 'conflict' END; END IF;
  SELECT * INTO STRICT stored FROM piggyvest_primary.bank_signed_inbox WHERE integration_id=p_integration AND event_id=envelope->>'eventId' FOR UPDATE;
  IF stored.body_digest=fingerprint THEN RETURN CASE WHEN stored.state='blocked' THEN 'conflict' ELSE 'duplicate' END; END IF;
  INSERT INTO piggyvest_primary.bank_signed_inbox_conflicts(integration_id,event_id,body_digest,payload,signature)
    VALUES(p_integration,envelope->>'eventId',fingerprint,payload,p_command->>'signature') ON CONFLICT DO NOTHING;
  UPDATE piggyvest_primary.bank_signed_inbox SET state='blocked',reason='event_conflict',claim_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
    WHERE integration_id=p_integration AND event_id=envelope->>'eventId';
  RETURN 'conflict';
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary.claim_bank_inbox(p_integration uuid,p_environment text,p_scope jsonb,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE output jsonb; batch integer;
BEGIN
  PERFORM piggyvest_primary.assert_bank_inbox(p_integration,p_environment,p_scope,true,true);
  IF p_command IS NULL OR p_command<>jsonb_build_object('batchSize',p_command->'batchSize')
    OR jsonb_typeof(p_command->'batchSize') IS DISTINCT FROM 'number' OR p_command->>'batchSize' !~ '^[1-9][0-9]*$' THEN
    RAISE EXCEPTION 'invalid bank batch' USING ERRCODE='22023';
  END IF;
  batch:=(p_command->>'batchSize')::integer;
  IF batch NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid bank batch' USING ERRCODE='22023'; END IF;
  UPDATE piggyvest_primary.bank_signed_inbox SET state='blocked',reason='attempt_limit',claim_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
    WHERE integration_id=p_integration AND attempts>=50 AND reason IS DISTINCT FROM 'prerequisite'
      AND (state='pending' OR (state='processing' AND lease_until<clock_timestamp()));
  WITH due AS (
    SELECT event_id FROM piggyvest_primary.bank_signed_inbox WHERE integration_id=p_integration AND (attempts<50 OR reason='prerequisite')
      AND ((state='pending' AND available_at<=clock_timestamp()) OR (state='processing' AND lease_until<clock_timestamp()))
      ORDER BY available_at,event_id FOR UPDATE SKIP LOCKED LIMIT batch
  ), claimed AS (
    UPDATE piggyvest_primary.bank_signed_inbox stored SET state='processing',claim_token=gen_random_uuid(),
      lease_until=clock_timestamp()+interval '60 seconds',
      attempts=stored.attempts+CASE WHEN stored.reason='prerequisite' THEN 0 ELSE 1 END,updated_at=clock_timestamp()
    FROM due WHERE stored.integration_id=p_integration AND stored.event_id=due.event_id
    RETURNING stored.event_id,stored.claim_token,stored.payload,stored.signature,stored.body_digest,stored.attempts
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('eventId',event_id,'token',claim_token,'rawHex',encode(payload,'hex'),
    'signature',signature,'bodyDigest',body_digest,'attempts',attempts)),'[]'::jsonb) INTO output FROM claimed;
  RETURN output;
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary.process_bank_inbox(p_integration uuid,p_environment text,p_scope jsonb,p_command jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE stored piggyvest_primary.bank_signed_inbox%ROWTYPE; envelope jsonb; detail jsonb; expected jsonb; receipt jsonb; outcome text;
BEGIN
  PERFORM piggyvest_primary.assert_bank_inbox(p_integration,p_environment,p_scope,true,true);
  IF p_command IS NULL OR p_command<>jsonb_build_object('eventId',p_command->'eventId','token',p_command->'token','receipt',p_command->'receipt')
    OR jsonb_typeof(p_command->'receipt') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid bank processing' USING ERRCODE='22023'; END IF;
  SELECT * INTO stored FROM piggyvest_primary.bank_signed_inbox WHERE integration_id=p_integration AND event_id=p_command->>'eventId'
    AND state='processing' AND claim_token=(p_command->>'token')::uuid AND lease_until>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank claim unavailable' USING ERRCODE='42501'; END IF;
  envelope:=convert_from(stored.payload,'UTF8')::jsonb; detail:=envelope->'eventData'; receipt:=p_command->'receipt';
  IF envelope->>'eventType' IS DISTINCT FROM 'bank-transfer.inflow.success'
    OR envelope->>'customer_id' IS DISTINCT FROM detail->>'customer_id' THEN RAISE EXCEPTION 'invalid bank receipt' USING ERRCODE='22023'; END IF;
  expected:=jsonb_build_object('eventId',envelope->'eventId','providerTransactionId',detail->'transaction_id',
    'providerCustomerId',envelope->'customer_id','providerWalletId',envelope->'pvb_wallet','eventDataId',detail->'id',
    'amountKobo',detail->'amount','feeKobo',detail->'fee','currency',detail->'currency','reference',detail->'reference',
    'sessionId',coalesce(detail->'session_id','null'::jsonb),
    'creditedAt',to_char(date_trunc('milliseconds',(detail->>'timestamp')::timestamptz) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'bodyDigest',stored.body_digest);
  IF receipt-'financialFingerprint'<>expected THEN RAISE EXCEPTION 'bank proof differs from signed bytes' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM piggyvest_primary.onboarding_intents intent JOIN public.customers customer
    ON customer.id=intent.customer_id AND customer.merchant_id=intent.merchant_id AND customer.user_id=intent.user_id
    WHERE intent.integration_id=p_integration AND intent.merchant_id=(p_scope->>'merchantId')::uuid AND intent.state='verified'
      AND intent.provider_wallet_id=receipt->>'providerWalletId' AND intent.provider_customer_id=receipt->>'providerCustomerId') THEN
    outcome:='prerequisite';
  ELSE outcome:=piggyvest_primary.apply_inflow_environment(p_integration,p_environment,receipt); END IF;
  IF outcome='unmapped' THEN outcome:='prerequisite'; END IF;
  IF outcome NOT IN ('credited','duplicate','conflict','prerequisite') THEN RAISE EXCEPTION 'invalid bank ledger outcome'; END IF;
  UPDATE piggyvest_primary.bank_signed_inbox SET
    state=CASE WHEN outcome IN ('credited','duplicate') THEN 'processed' WHEN outcome='conflict' THEN 'blocked' ELSE 'pending' END,
    reason=CASE WHEN outcome IN ('credited','duplicate') THEN NULL WHEN outcome='conflict' THEN 'financial_conflict' ELSE 'prerequisite' END,
    claim_token=NULL,lease_until=NULL,available_at=clock_timestamp()+make_interval(secs=>least(900,attempts*30)),updated_at=clock_timestamp()
    WHERE integration_id=p_integration AND event_id=stored.event_id;
  RETURN outcome;
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary.retry_bank_inbox(p_integration uuid,p_environment text,p_scope jsonb,p_command jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary.assert_bank_inbox(p_integration,p_environment,p_scope,true,true);
  IF p_command IS NULL OR p_command<>jsonb_build_object('eventId',p_command->'eventId','token',p_command->'token','reason',p_command->'reason')
    OR p_command->>'reason' IS NULL OR p_command->>'reason' NOT IN ('io_retry','invalid_receipt') THEN
    RAISE EXCEPTION 'invalid bank retry' USING ERRCODE='22023';
  END IF;
  UPDATE piggyvest_primary.bank_signed_inbox SET
    state=CASE WHEN p_command->>'reason'='invalid_receipt' THEN 'blocked' ELSE 'pending' END,
    reason=p_command->>'reason',claim_token=NULL,lease_until=NULL,
    available_at=clock_timestamp()+make_interval(secs=>least(900,attempts*30)),updated_at=clock_timestamp()
  WHERE integration_id=p_integration AND event_id=p_command->>'eventId' AND state='processing'
    AND claim_token=(p_command->>'token')::uuid AND lease_until>clock_timestamp();
  RETURN FOUND;
END $$;
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
  IF intent.state IS DISTINCT FROM 'verified' THEN RETURN 'prerequisite'; END IF;
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
COMMIT;
