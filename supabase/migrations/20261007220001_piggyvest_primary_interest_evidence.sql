BEGIN;
CREATE FUNCTION piggyvest_primary.apply_paid_interest(p_integration uuid,p_environment text,p_proof jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  mapping piggyvest_primary.paid_interest_crosswalks%ROWTYPE;
  prior piggyvest_primary.paid_interest_receipts%ROWTYPE;
  selection jsonb; financial jsonb; field text; merchant uuid; customer uuid; primary_intent uuid; consent timestamptz;
BEGIN
  PERFORM piggyvest_primary.assert_paid_interest_worker(p_integration,p_environment);
  IF jsonb_typeof(p_proof) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid paid-interest proof' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_proof))<>22 OR NOT p_proof ?& ARRAY[
    'payoutId','webhookCustomerId','sourceWalletId','accruedWalletId','destinationWalletId','envelopeDestinationWalletId',
    'reference','envelopeReference','batchId','paidAt','amountKobo','grossKobo','taxKobo','netKobo','currency',
    'crosswalkId','apiWalletId','apiCustomerId','businessId','eventId','bodyDigest','observedAt'] THEN
    RAISE EXCEPTION 'invalid paid-interest proof' USING ERRCODE='22023';
  END IF;
  FOREACH field IN ARRAY ARRAY['payoutId','webhookCustomerId','sourceWalletId','accruedWalletId','destinationWalletId',
    'reference','envelopeReference','batchId','paidAt','currency','crosswalkId','apiWalletId','apiCustomerId','businessId','eventId','bodyDigest','observedAt'] LOOP
    IF jsonb_typeof(p_proof->field) IS DISTINCT FROM 'string' OR octet_length(p_proof->>field) NOT BETWEEN 1 AND 512 THEN
      RAISE EXCEPTION 'invalid paid-interest field' USING ERRCODE='22023';
    END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['amountKobo','grossKobo','taxKobo','netKobo'] LOOP
    IF jsonb_typeof(p_proof->field) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'invalid interest amount' USING ERRCODE='22023'; END IF;
    IF (p_proof->>field)::numeric NOT BETWEEN 0 AND 9007199254740991 OR trunc((p_proof->>field)::numeric)<>(p_proof->>field)::numeric THEN
      RAISE EXCEPTION 'invalid interest amount' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF jsonb_typeof(p_proof->'envelopeDestinationWalletId') NOT IN ('string','null')
    OR p_proof->>'currency'<>'NGN' OR p_proof->>'bodyDigest' !~ '^[a-f0-9]{64}$'
    OR (p_proof->>'grossKobo')::numeric-(p_proof->>'taxKobo')::numeric<>(p_proof->>'netKobo')::numeric
    OR (p_proof->>'amountKobo')::numeric<>(p_proof->>'netKobo')::numeric THEN
    RAISE EXCEPTION 'inconsistent paid-interest economics' USING ERRCODE='22023';
  END IF;
  IF (p_proof->>'observedAt')::timestamptz<clock_timestamp()-interval '60 seconds'
    OR (p_proof->>'observedAt')::timestamptz>clock_timestamp()+interval '5 seconds'
    OR (p_proof->>'paidAt')::timestamptz>clock_timestamp()+interval '5 seconds' THEN RETURN 'prerequisite'; END IF;
  selection:=jsonb_build_object('webhookCustomerId',p_proof->'webhookCustomerId','sourceWalletId',p_proof->'sourceWalletId',
    'accruedWalletId',p_proof->'accruedWalletId','destinationWalletId',p_proof->'destinationWalletId',
    'envelopeDestinationWalletId',p_proof->'envelopeDestinationWalletId');
  SELECT * INTO mapping FROM piggyvest_primary.eligible_interest_crosswalk(p_integration,selection)
    WHERE id=(p_proof->>'crosswalkId')::uuid;
  IF NOT FOUND OR (SELECT count(*) FROM piggyvest_primary.eligible_interest_crosswalk(p_integration,selection))<>1
    OR mapping.api_wallet_id<>p_proof->>'apiWalletId' OR mapping.api_customer_id<>p_proof->>'apiCustomerId'
    OR NOT EXISTS(SELECT 1 FROM piggyvest_primary.integrations WHERE id=p_integration AND business_id=p_proof->>'businessId') THEN RETURN 'prerequisite'; END IF;
  SELECT intent.id,intent.merchant_id,intent.customer_id,choice.interest_accepted_at INTO primary_intent,merchant,customer,consent
    FROM piggyvest_primary.savings_destinations destination
    JOIN piggyvest_primary.onboarding_intents intent ON intent.id=destination.intent_id
    JOIN piggyvest_primary.goal_wallet_intents choice ON choice.integration_id=destination.integration_id AND choice.goal_id=destination.goal_id
    WHERE destination.integration_id=p_integration AND destination.goal_id=mapping.goal_id;
  IF (p_proof->>'paidAt')::timestamptz<consent THEN RETURN 'prerequisite'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('primary-interest:'||p_integration::text||':'||(p_proof->>'payoutId'),0));
  PERFORM pg_advisory_xact_lock(hashtextextended('primary-savings:'||primary_intent::text,0));
  PERFORM id FROM piggyvest_primary.paid_interest_crosswalks WHERE id=mapping.id AND enabled FOR SHARE;
  IF NOT FOUND THEN RETURN 'prerequisite'; END IF;
  PERFORM id FROM public.customer_savings_goals WHERE id=mapping.goal_id AND merchant_id=merchant AND customer_id=customer FOR UPDATE;
  IF NOT FOUND THEN RETURN 'prerequisite'; END IF;
  IF EXISTS(SELECT 1 FROM piggyvest_savings_ledger.bindings WHERE goal_id=mapping.goal_id AND merchant_id=merchant AND customer_id=customer) THEN
    RETURN 'prerequisite';
  END IF;
  IF (SELECT count(*) FROM piggyvest_primary.eligible_interest_crosswalk(p_integration,selection) WHERE id=mapping.id)<>1
    OR NOT EXISTS(SELECT 1 FROM piggyvest_primary.completion_totals(mapping.goal_id,merchant,customer) WHERE integration_id=p_integration) THEN
    RETURN 'prerequisite';
  END IF;
  financial:=p_proof-ARRAY['crosswalkId','apiWalletId','apiCustomerId','businessId','eventId','bodyDigest','observedAt'];
  financial:=jsonb_set(financial,'{paidAt}',to_jsonb((p_proof->>'paidAt')::timestamptz));
  SELECT * INTO prior FROM piggyvest_primary.paid_interest_receipts WHERE integration_id=p_integration AND payout_id=p_proof->>'payoutId';
  IF FOUND AND (prior.financial_identity IS DISTINCT FROM financial OR prior.crosswalk_id<>mapping.id
    OR prior.goal_id<>mapping.goal_id OR prior.merchant_id<>merchant OR prior.customer_id<>customer) THEN RETURN 'conflict'; END IF;
  IF EXISTS(SELECT 1 FROM piggyvest_primary.paid_interest_delivery_ids WHERE integration_id=p_integration
    AND event_id=p_proof->>'eventId' AND payout_id<>p_proof->>'payoutId') THEN RETURN 'conflict'; END IF;
  IF prior.payout_id IS NOT NULL THEN
    INSERT INTO piggyvest_primary.paid_interest_delivery_ids VALUES(p_integration,p_proof->>'eventId',prior.payout_id) ON CONFLICT DO NOTHING;
    RETURN 'duplicate';
  END IF;
  INSERT INTO piggyvest_primary.paid_interest_receipts(integration_id,payout_id,crosswalk_id,goal_id,merchant_id,customer_id,net_kobo,financial_identity,body_digest)
    VALUES(p_integration,p_proof->>'payoutId',mapping.id,mapping.goal_id,merchant,customer,(p_proof->>'netKobo')::bigint,financial,p_proof->>'bodyDigest');
  INSERT INTO piggyvest_primary.paid_interest_delivery_ids VALUES(p_integration,p_proof->>'eventId',p_proof->>'payoutId');
  UPDATE public.customer_savings_goals SET status=status WHERE id=mapping.goal_id AND merchant_id=merchant AND customer_id=customer;
  RETURN 'credited';
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.apply_paid_interest(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.apply_paid_interest(uuid,text,jsonb) TO piggyvest_primary_evidence;
COMMIT;
