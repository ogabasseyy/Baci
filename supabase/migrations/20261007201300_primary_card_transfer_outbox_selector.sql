BEGIN;
CREATE FUNCTION piggyvest_primary_card.select_ready_transfers(integration_id uuid, environment text, capability jsonb, maximum integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected jsonb; unknown_count bigint; dispatching_count bigint; treasury_policy piggyvest_primary_card.treasury_policy%ROWTYPE; binding record; treasury_ready boolean;
BEGIN
  IF maximum IS NULL OR maximum NOT IN (0,1) THEN RAISE EXCEPTION 'bounded selection required' USING ERRCODE='22023'; END IF;
  PERFORM piggyvest_primary_card.assert_worker($1,$2,false);
  PERFORM settings.integration_id FROM piggyvest_primary_card.settings settings
    JOIN piggyvest_primary_card.inbox_capabilities approved ON approved.integration_id=settings.integration_id
    WHERE settings.integration_id=$1 AND approved.enabled AND capability-'expiresAt'=jsonb_build_object(
      'contractId',approved.contract_id,'evidenceIssuer',approved.evidence_issuer,
      'treasuryWebhookCustomerId',approved.treasury_webhook_customer_id,'transactionCustomerId',approved.transaction_customer_id,
      'merchantId',settings.merchant_id,'businessId',settings.business_id)
      AND (capability->>'expiresAt')::timestamptz=settings.expires_at FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer proof contract unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT treasury_policy FROM piggyvest_primary_card.treasury_policy stored WHERE stored.integration_id=$1 AND enabled FOR SHARE;
  EXECUTE 'SELECT * FROM prefunded_card.treasury_bindings WHERE id=$1 FOR UPDATE' INTO STRICT binding USING treasury_policy.treasury_binding_id;
  EXECUTE 'SELECT prefunded_card.treasury_reservation_ready($1)' INTO treasury_ready USING treasury_policy.treasury_binding_id;
  IF treasury_ready IS DISTINCT FROM true OR binding.authorized_login<>treasury_policy.owner_login OR binding.source_wallet_id<>treasury_policy.source_wallet_id THEN
    RAISE EXCEPTION 'transfer treasury unavailable' USING ERRCODE='42501';
  END IF;
  SELECT count(*) FILTER(WHERE outbox.state='unknown'),count(*) FILTER(WHERE outbox.state='dispatching') INTO unknown_count,dispatching_count
    FROM piggyvest_primary_card.transfer_outbox outbox JOIN piggyvest_primary_card.operations operation ON operation.id=outbox.operation_id
    WHERE operation.integration_id=$1 AND operation.environment=$2 AND operation.state='custody_pending';
  SELECT coalesce(jsonb_agg(candidate.id),'[]'::jsonb) INTO selected FROM (
    SELECT operation.id FROM piggyvest_primary_card.transfer_outbox outbox
    JOIN piggyvest_primary_card.operations operation ON operation.id=outbox.operation_id
    JOIN piggyvest_primary_card.settings settings ON settings.integration_id=operation.integration_id
    JOIN piggyvest_primary_card.treasury_policy policy ON policy.integration_id=operation.integration_id
    JOIN piggyvest_primary_card.reservations reservation ON reservation.operation_id=operation.id
    JOIN piggyvest_primary_card.collections collection ON collection.operation_id=operation.id
    JOIN public.customers customer ON customer.id=operation.customer_id
    WHERE operation.integration_id=$1 AND operation.environment=$2 AND operation.state='custody_pending'
      AND outbox.state='ready' AND reservation.state='reserved'
      AND operation.merchant_id=settings.merchant_id AND operation.business_id=settings.business_id
      AND customer.merchant_id=operation.merchant_id AND customer.user_id=operation.user_id
      AND reservation.source_wallet_id=policy.source_wallet_id
      AND reservation.treasury_binding_id=policy.treasury_binding_id
      AND EXISTS(SELECT 1 FROM piggyvest_primary.onboarding_intents mapping WHERE mapping.customer_id=operation.customer_id
        AND mapping.integration_id=operation.integration_id AND mapping.merchant_id=operation.merchant_id AND mapping.user_id=operation.user_id
        AND mapping.provider_wallet_id=operation.destination_wallet_id AND mapping.provider_customer_id=operation.destination_customer_id AND mapping.state='verified')
    ORDER BY outbox.updated_at,operation.id LIMIT maximum
  ) candidate;
  RETURN jsonb_build_object('operationIds',selected,'unknownCount',unknown_count,'dispatchingCount',dispatching_count);
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary_card.select_ready_transfers(uuid,text,jsonb,integer) FROM PUBLIC,anon,authenticated,service_role,primary_card_signed_intake,primary_card_custody_evidence,primary_card_authorizer,primary_card_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary_card.select_ready_transfers(uuid,text,jsonb,integer) TO primary_card_transfer_worker;
COMMIT;
