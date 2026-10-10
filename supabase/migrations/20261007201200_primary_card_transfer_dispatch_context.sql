BEGIN;
CREATE FUNCTION piggyvest_primary_card.dispatch_context(integration_id uuid, environment text, operation_id uuid, capability jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation piggyvest_primary_card.operations%ROWTYPE; reservation piggyvest_primary_card.reservations%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary_card.assert_worker($1,$2,false);
  PERFORM settings.integration_id FROM piggyvest_primary_card.settings settings
    JOIN piggyvest_primary_card.inbox_capabilities approved ON approved.integration_id=settings.integration_id
    WHERE settings.integration_id=$1 AND approved.enabled AND capability-'expiresAt'=jsonb_build_object(
      'contractId',approved.contract_id,'evidenceIssuer',approved.evidence_issuer,
      'treasuryWebhookCustomerId',approved.treasury_webhook_customer_id,'transactionCustomerId',approved.transaction_customer_id,
      'merchantId',settings.merchant_id,'businessId',settings.business_id)
      AND (capability->>'expiresAt')::timestamptz=settings.expires_at FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer proof contract unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT operation FROM piggyvest_primary_card.operations WHERE id=$3 AND operations.integration_id=$1 AND operations.environment=$2 AND state IN ('custody_pending','completed');
  SELECT * INTO STRICT reservation FROM piggyvest_primary_card.reservations WHERE reservations.operation_id=$3;
  PERFORM customer.id FROM public.customers customer JOIN piggyvest_primary.onboarding_intents mapping ON mapping.customer_id=customer.id
    WHERE customer.id=operation.customer_id AND customer.merchant_id=operation.merchant_id AND customer.user_id=operation.user_id
      AND mapping.integration_id=operation.integration_id AND mapping.merchant_id=operation.merchant_id AND mapping.user_id=operation.user_id
      AND mapping.provider_wallet_id=operation.destination_wallet_id AND mapping.provider_customer_id=operation.destination_customer_id AND mapping.state='verified' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer ownership unavailable' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('operationId',operation.id,'integrationId',operation.integration_id,'merchantId',operation.merchant_id,
    'customerId',operation.customer_id,'environment',operation.environment,'businessId',operation.business_id,'amountKobo',operation.amount_kobo,
    'sourceWalletId',reservation.source_wallet_id,'destinationWalletId',operation.destination_wallet_id,
    'destinationCustomerId',operation.destination_customer_id,'reference',reservation.transfer_reference);
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary_card.dispatch_context(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role,primary_card_signed_intake,primary_card_custody_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary_card.dispatch_context(uuid,text,uuid,jsonb) TO primary_card_transfer_worker;
COMMIT;
