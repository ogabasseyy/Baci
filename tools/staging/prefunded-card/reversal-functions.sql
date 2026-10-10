BEGIN;
CREATE FUNCTION prefunded_card.lock_reversal_operation(p_operation uuid,p_system text)
RETURNS prefunded_card.operations LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_scoped_operation(p_operation);
  PERFORM prefunded_card.require_credit_route(operation,p_system);
  PERFORM goal.id FROM public.customer_savings_goals goal
    JOIN public.customers customer ON customer.id=goal.customer_id AND customer.merchant_id=goal.merchant_id
    WHERE goal.id=operation.goal_id AND goal.merchant_id=operation.merchant_id AND goal.customer_id=operation.customer_id
    FOR SHARE OF goal,customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'prefunded reversal ownership refused' USING ERRCODE='42501'; END IF;
  RETURN operation;
END $$;
CREATE FUNCTION prefunded_card.read_reversal_context(p_operation uuid,p_system text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  operation:=prefunded_card.lock_reversal_operation(p_operation,p_system);
  RETURN jsonb_build_object('request',prefunded_card.request_for_operation(operation),
    'collectionTransactionId',operation.collection_provider_transaction_id);
END $$;

CREATE FUNCTION prefunded_card.record_collection_reversal(p_system text,p_evidence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE; existing prefunded_card.collection_reversal_events%ROWTYPE;
DECLARE binding prefunded_card.treasury_bindings%ROWTYPE; obligation prefunded_card.collection_reversal_obligations%ROWTYPE;
DECLARE event_key text; outcome text:='recorded'; field_name text;
BEGIN
  IF p_evidence IS NULL OR jsonb_typeof(p_evidence)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_evidence))<>14
    OR NOT p_evidence ?& ARRAY['operationId','integrationId','merchantId','customerId','goalId','treasuryBindingId',
      'savedMethodId','eventId','collectionReference','collectionTransactionId','collectionAmountKobo','currency','providerStatus','domain'] THEN
    RAISE EXCEPTION 'invalid prefunded reversal evidence' USING ERRCODE='22023';
  END IF;
  FOR field_name IN SELECT jsonb_object_keys(p_evidence) LOOP
    IF jsonb_typeof(p_evidence->field_name) IS DISTINCT FROM
      (CASE WHEN field_name='collectionAmountKobo' THEN 'number' ELSE 'string' END) THEN
      RAISE EXCEPTION 'invalid prefunded reversal field' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF (p_evidence->>'collectionAmountKobo') !~ '^[1-9][0-9]{0,15}$'
    OR (p_evidence->>'collectionAmountKobo')::numeric>9007199254740991
    OR (p_evidence->>'collectionTransactionId') !~ '^[1-9][0-9]{0,19}$'
    OR (p_evidence->>'collectionTransactionId')::numeric>18446744073709551615
    OR (p_evidence->>'eventId') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    OR (p_evidence->>'collectionReference') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    OR p_evidence->>'currency'<>'NGN' OR p_evidence->>'providerStatus'<>'reversed' OR p_evidence->>'domain'<>'test' THEN
    RAISE EXCEPTION 'invalid prefunded reversal values' USING ERRCODE='22023';
  END IF;
  operation:=prefunded_card.lock_reversal_operation((p_evidence->>'operationId')::uuid,p_system);
  IF operation.integration_id::text IS DISTINCT FROM p_evidence->>'integrationId'
    OR operation.merchant_id::text IS DISTINCT FROM p_evidence->>'merchantId'
    OR operation.customer_id::text IS DISTINCT FROM p_evidence->>'customerId'
    OR operation.goal_id::text IS DISTINCT FROM p_evidence->>'goalId'
    OR operation.treasury_binding_id::text IS DISTINCT FROM p_evidence->>'treasuryBindingId'
    OR operation.saved_method_id::text IS DISTINCT FROM p_evidence->>'savedMethodId'
    OR operation.collection_reference IS DISTINCT FROM p_evidence->>'collectionReference'
    OR operation.amount_kobo IS DISTINCT FROM (p_evidence->>'collectionAmountKobo')::bigint
    OR (operation.collection_provider_transaction_id IS NOT NULL AND
      operation.collection_provider_transaction_id IS DISTINCT FROM p_evidence->>'collectionTransactionId') THEN
    RAISE EXCEPTION 'prefunded reversal evidence scope refused' USING ERRCODE='42501';
  END IF;
  event_key:=p_evidence->>'eventId';
  INSERT INTO prefunded_card.collection_reversal_events(integration_id,event_id,operation_id,evidence,verified_by)
    VALUES(operation.integration_id,event_key,operation.id,p_evidence,session_user) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO STRICT existing FROM prefunded_card.collection_reversal_events
      WHERE integration_id=operation.integration_id AND event_id=event_key;
    IF existing.operation_id IS DISTINCT FROM operation.id OR existing.evidence IS DISTINCT FROM p_evidence THEN
      RAISE EXCEPTION 'prefunded reversal event conflict' USING ERRCODE='23505';
    END IF;
    outcome:='duplicate';
  END IF;
  SELECT * INTO STRICT binding FROM prefunded_card.treasury_bindings WHERE id=operation.treasury_binding_id;
  INSERT INTO prefunded_card.collection_reversal_obligations(operation_id,integration_id,merchant_id,customer_id,goal_id,
    treasury_binding_id,first_event_id,collection_amount_kobo,transfer_status_at_recording,transfer_transaction_id_at_recording,
    projection_status_at_recording,exposure,reserved_kobo_at_recording,consumed_kobo_at_recording)
    VALUES(operation.id,operation.integration_id,operation.merchant_id,operation.customer_id,operation.goal_id,
      operation.treasury_binding_id,event_key,operation.amount_kobo,operation.transfer_status,operation.transfer_provider_transaction_id,
      operation.projection_status,CASE operation.transfer_status WHEN 'not_started' THEN 'transfer_not_started'
        WHEN 'verified_success' THEN 'transfer_completed' WHEN 'verified_failed' THEN 'transfer_failed'
        ELSE 'transfer_in_flight' END,binding.reserved_kobo,binding.consumed_kobo) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT obligation FROM prefunded_card.collection_reversal_obligations WHERE operation_id=operation.id;
  IF operation.collection_status<>'reversed' THEN
    UPDATE prefunded_card.operations SET collection_status='reversed',
      collection_provider_transaction_id=p_evidence->>'collectionTransactionId',
      projection_status=CASE WHEN projection_status='applied' THEN 'applied' ELSE 'reconciliation_required' END
      WHERE id=operation.id;
  END IF;
  RETURN jsonb_build_object('operationId',operation.id,'eventId',event_key,'outcome',outcome,
    'obligation',obligation.obligation,'exposure',obligation.exposure);
END $$;
REVOKE ALL ON FUNCTION prefunded_card.lock_reversal_operation(uuid,text),prefunded_card.read_reversal_context(uuid,text),
  prefunded_card.record_collection_reversal(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
