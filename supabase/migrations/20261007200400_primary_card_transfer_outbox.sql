BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='primary_card_transfer_worker') THEN CREATE ROLE primary_card_transfer_worker NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='primary_card_custody_evidence') THEN CREATE ROLE primary_card_custody_evidence NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA piggyvest_primary_card TO primary_card_transfer_worker,primary_card_custody_evidence;
CREATE FUNCTION piggyvest_primary_card.assert_worker(integration_id uuid, environment text, custody boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM config.integration_id FROM piggyvest_primary_card.settings config
  JOIN piggyvest_primary_card.treasury_policy policy ON policy.integration_id=config.integration_id
  JOIN piggyvest_primary.integrations integration ON integration.id=config.integration_id
  WHERE config.integration_id=$1 AND config.environment=$2 AND config.enabled AND integration.enabled
    AND config.expires_at>clock_timestamp() AND policy.enabled AND integration.environment=config.environment
    AND integration.business_id=config.business_id AND integration.merchant_id=config.merchant_id
    AND SESSION_USER=CASE WHEN custody THEN policy.custody_login ELSE policy.transfer_login END
  FOR SHARE OF config,policy,integration;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer authority unavailable' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION piggyvest_primary_card.transfer_context(integration_id uuid, environment text, operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation piggyvest_primary_card.operations%ROWTYPE; reservation piggyvest_primary_card.reservations%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary_card.assert_worker($1,$2,true);
  SELECT * INTO STRICT operation FROM piggyvest_primary_card.operations WHERE id=$3 AND operations.integration_id=$1 AND operations.environment=$2 AND state IN ('custody_pending','completed');
  SELECT * INTO STRICT reservation FROM piggyvest_primary_card.reservations WHERE reservations.operation_id=$3;
  PERFORM customer.id FROM public.customers customer JOIN piggyvest_primary.onboarding_intents mapping ON mapping.customer_id=customer.id
    WHERE customer.id=operation.customer_id AND customer.merchant_id=operation.merchant_id AND customer.user_id=operation.user_id
      AND mapping.integration_id=operation.integration_id AND mapping.merchant_id=operation.merchant_id AND mapping.user_id=operation.user_id
      AND mapping.provider_wallet_id=operation.destination_wallet_id AND mapping.provider_customer_id=operation.destination_customer_id AND mapping.state='verified' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'custody ownership unavailable' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('operationId',operation.id,'integrationId',operation.integration_id,'merchantId',operation.merchant_id,
    'customerId',operation.customer_id,'environment',operation.environment,'businessId',operation.business_id,'amountKobo',operation.amount_kobo,
    'sourceWalletId',reservation.source_wallet_id,'destinationWalletId',operation.destination_wallet_id,
    'destinationCustomerId',operation.destination_customer_id,'reference',reservation.transfer_reference);
END $$;
CREATE FUNCTION piggyvest_primary_card.claim_transfer(integration_id uuid, environment text, operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE outbox piggyvest_primary_card.transfer_outbox%ROWTYPE; command jsonb; binding record; policy piggyvest_primary_card.treasury_policy%ROWTYPE; ready boolean;
BEGIN
  PERFORM piggyvest_primary_card.assert_worker($1,$2,false);
  SELECT * INTO STRICT outbox FROM piggyvest_primary_card.transfer_outbox WHERE transfer_outbox.operation_id=$3 FOR UPDATE;
  SELECT jsonb_build_object('operationId',operation.id,'sourceWalletId',reservation.source_wallet_id,
    'destinationWalletId',operation.destination_wallet_id,'amountKobo',operation.amount_kobo,'reference',reservation.transfer_reference,'currency','NGN')
    INTO command FROM piggyvest_primary_card.operations operation JOIN piggyvest_primary_card.reservations reservation ON reservation.operation_id=operation.id
    JOIN piggyvest_primary_card.collections collection ON collection.operation_id=operation.id
    WHERE operation.id=$3 AND operation.integration_id=$1 AND operation.environment=$2 AND operation.state='custody_pending' AND reservation.state='reserved';
  IF command IS NULL THEN RETURN jsonb_build_object('outcome','existing'); END IF;
  IF outbox.state<>'ready' THEN RETURN jsonb_build_object('outcome','existing'); END IF;
  SELECT * INTO STRICT policy FROM piggyvest_primary_card.treasury_policy WHERE treasury_policy.integration_id=$1 AND enabled FOR SHARE;
  EXECUTE 'SELECT * FROM prefunded_card.treasury_bindings WHERE id=$1 FOR UPDATE' INTO STRICT binding USING policy.treasury_binding_id;
  EXECUTE 'SELECT prefunded_card.treasury_reservation_ready($1)' INTO ready USING policy.treasury_binding_id;
  IF ready IS DISTINCT FROM true OR binding.authorized_login<>policy.owner_login OR binding.source_wallet_id<>command->>'sourceWalletId'
    OR policy.source_wallet_id<>command->>'sourceWalletId' THEN RAISE EXCEPTION 'transfer treasury unavailable' USING ERRCODE='42501'; END IF;
  UPDATE piggyvest_primary_card.transfer_outbox SET state='dispatching',claim_token=gen_random_uuid(),updated_at=clock_timestamp()
    WHERE transfer_outbox.operation_id=$3 RETURNING * INTO outbox;
  RETURN jsonb_build_object('outcome','claimed','token',outbox.claim_token,'command',command);
END $$;
CREATE FUNCTION piggyvest_primary_card.record_transfer(integration_id uuid, environment text, operation_id uuid, token uuid, submitted boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary_card.assert_worker($1,$2,false);
  PERFORM id FROM piggyvest_primary_card.operations WHERE id=$3 AND operations.integration_id=$1 AND operations.environment=$2;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer ownership unavailable' USING ERRCODE='42501'; END IF;
  UPDATE piggyvest_primary_card.transfer_outbox SET state=CASE WHEN submitted IS true THEN 'submitted' ELSE 'unknown' END,claim_token=NULL,updated_at=clock_timestamp()
    WHERE transfer_outbox.operation_id=$3 AND state='dispatching' AND claim_token=token;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary_card.assert_worker(uuid,text,boolean),piggyvest_primary_card.transfer_context(uuid,text,uuid),piggyvest_primary_card.claim_transfer(uuid,text,uuid),piggyvest_primary_card.record_transfer(uuid,text,uuid,uuid,boolean)
  FROM PUBLIC,anon,authenticated,service_role,primary_card_authorizer,primary_card_evidence,primary_card_transfer_worker,primary_card_custody_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary_card.claim_transfer(uuid,text,uuid),piggyvest_primary_card.record_transfer(uuid,text,uuid,uuid,boolean) TO primary_card_transfer_worker;
GRANT EXECUTE ON FUNCTION piggyvest_primary_card.transfer_context(uuid,text,uuid) TO primary_card_custody_evidence;
COMMIT;
