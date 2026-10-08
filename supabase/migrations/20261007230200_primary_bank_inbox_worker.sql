BEGIN;
CREATE FUNCTION piggyvest_primary.claim_bank_inbox(p_integration uuid,p_environment text,p_scope jsonb,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE output jsonb; batch integer;
BEGIN
  PERFORM piggyvest_primary.assert_bank_inbox(p_integration,p_environment,p_scope,true);
  IF p_command IS NULL OR p_command<>jsonb_build_object('batchSize',p_command->'batchSize')
    OR jsonb_typeof(p_command->'batchSize') IS DISTINCT FROM 'number' OR p_command->>'batchSize' !~ '^[1-9][0-9]*$' THEN
    RAISE EXCEPTION 'invalid bank batch' USING ERRCODE='22023';
  END IF;
  batch:=(p_command->>'batchSize')::integer;
  IF batch NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid bank batch' USING ERRCODE='22023'; END IF;
  UPDATE piggyvest_primary.bank_signed_inbox SET state='blocked',reason='attempt_limit',claim_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
    WHERE integration_id=p_integration AND attempts>=50 AND (state='pending' OR (state='processing' AND lease_until<clock_timestamp()));
  WITH due AS (
    SELECT event_id FROM piggyvest_primary.bank_signed_inbox WHERE integration_id=p_integration AND attempts<50
      AND ((state='pending' AND available_at<=clock_timestamp()) OR (state='processing' AND lease_until<clock_timestamp()))
      ORDER BY available_at,event_id FOR UPDATE SKIP LOCKED LIMIT batch
  ), claimed AS (
    UPDATE piggyvest_primary.bank_signed_inbox stored SET state='processing',claim_token=gen_random_uuid(),
      lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1,updated_at=clock_timestamp()
    FROM due WHERE stored.integration_id=p_integration AND stored.event_id=due.event_id
    RETURNING stored.event_id,stored.claim_token,stored.payload,stored.signature,stored.body_digest,stored.attempts
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('eventId',event_id,'token',claim_token,'rawHex',encode(payload,'hex'),
    'signature',signature,'bodyDigest',body_digest,'attempts',attempts)),'[]'::jsonb) INTO output FROM claimed;
  RETURN output;
END $$;
CREATE FUNCTION piggyvest_primary.process_bank_inbox(p_integration uuid,p_environment text,p_scope jsonb,p_command jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE stored piggyvest_primary.bank_signed_inbox%ROWTYPE; envelope jsonb; detail jsonb; expected jsonb; receipt jsonb; outcome text;
BEGIN
  PERFORM piggyvest_primary.assert_bank_inbox(p_integration,p_environment,p_scope,true);
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
CREATE FUNCTION piggyvest_primary.retry_bank_inbox(p_integration uuid,p_environment text,p_scope jsonb,p_command jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary.assert_bank_inbox(p_integration,p_environment,p_scope,true);
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
REVOKE ALL ON FUNCTION piggyvest_primary.claim_bank_inbox(uuid,text,jsonb,jsonb),piggyvest_primary.process_bank_inbox(uuid,text,jsonb,jsonb),
  piggyvest_primary.retry_bank_inbox(uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role,primary_bank_signed_intake,primary_bank_inbox_worker;
GRANT EXECUTE ON FUNCTION piggyvest_primary.claim_bank_inbox(uuid,text,jsonb,jsonb),piggyvest_primary.process_bank_inbox(uuid,text,jsonb,jsonb),
  piggyvest_primary.retry_bank_inbox(uuid,text,jsonb,jsonb) TO primary_bank_inbox_worker;
COMMIT;
