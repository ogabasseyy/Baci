BEGIN;
CREATE FUNCTION prefunded_card.classify_provider_inflow(p_integration uuid,p_system text,p_event text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt prefunded_card.provider_evidence%ROWTYPE; observed jsonb; mapped record; result jsonb;
DECLARE operation prefunded_card.operations%ROWTYPE; matched uuid[];
BEGIN
  PERFORM prefunded_card.evidence_scope(p_integration,p_system);
  PERFORM integration_id FROM prefunded_card.evidence_authorities
    WHERE integration_id=p_integration AND reader_login=session_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider evidence reader refused' USING ERRCODE='42501'; END IF;
  PERFORM id FROM prefunded_card.treasury_bindings WHERE integration_id=p_integration ORDER BY id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('prefunded-evidence:'||p_integration,0));
  SELECT * INTO receipt FROM prefunded_card.provider_evidence WHERE integration_id=p_integration AND event_id=p_event FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','deferred'); END IF;
  observed:=receipt.observation;
  result:=jsonb_build_object('outcome','deferred');
  IF receipt.conflicted THEN result:=jsonb_build_object('outcome','reconciliation_required');
  ELSIF observed->>'status'='verified' THEN
    SELECT mapping.merchant_id,mapping.customer_id,mapping.goal_id INTO mapped
    FROM piggyvest_staging.wallet_goal_mappings mapping
    JOIN public.customers customer ON customer.id=mapping.customer_id AND customer.merchant_id=mapping.merchant_id
    JOIN prefunded_card.credit_routes route ON route.goal_id=mapping.goal_id AND route.integration_id=mapping.integration_id
      AND route.merchant_id=mapping.merchant_id AND route.customer_id=mapping.customer_id AND route.system_identifier=p_system
    JOIN piggyvest_savings_ledger.bindings binding ON binding.goal_id=mapping.goal_id AND binding.integration_id=mapping.integration_id
      AND binding.merchant_id=mapping.merchant_id AND binding.customer_id=mapping.customer_id
      AND binding.enabled AND binding.authorized_login=session_user
    WHERE mapping.integration_id=p_integration AND mapping.provider_wallet_id=observed->>'destinationWalletId'
      AND mapping.provider_customer_id=observed->>'destinationCustomerId';
    IF FOUND THEN
      SELECT array_agg(candidate.id ORDER BY candidate.id) INTO matched FROM prefunded_card.operations candidate WHERE candidate.integration_id=p_integration
        AND ((observed->'references') ? candidate.transfer_reference OR (observed->'references') ? candidate.collection_reference
          OR (observed->'references') ? candidate.collection_provider_transaction_id
          OR (observed->'references') ? candidate.transfer_provider_transaction_id
          OR EXISTS(SELECT 1 FROM prefunded_card.provider_aliases alias WHERE alias.operation_id=candidate.id
            AND alias.integration_id=p_integration AND (observed->'references') ? alias.provider_transaction_id));
      SELECT * INTO operation FROM prefunded_card.operations WHERE id=matched[1];
      IF cardinality(matched)>1 THEN result:=jsonb_build_object('outcome','reconciliation_required');
      ELSIF FOUND THEN
        IF operation.goal_id IS DISTINCT FROM mapped.goal_id OR operation.merchant_id IS DISTINCT FROM mapped.merchant_id
          OR operation.customer_id IS DISTINCT FROM mapped.customer_id OR operation.destination_wallet_id IS DISTINCT FROM observed->>'destinationWalletId'
          OR operation.destination_customer_id IS DISTINCT FROM observed->>'destinationCustomerId'
          OR operation.amount_kobo IS DISTINCT FROM (observed->>'amountKobo')::bigint
          OR NOT (observed->'references') ? operation.transfer_reference THEN
          result:=jsonb_build_object('outcome','reconciliation_required');
        ELSIF EXISTS(SELECT 1 FROM prefunded_card.projections WHERE operation_id=operation.id) THEN
          result:=jsonb_build_object('outcome','bridge_duplicate');
        ELSE result:=jsonb_build_object('outcome','bridge_inflight'); END IF;
      ELSIF observed->>'kind'='bank_inflow' AND observed->>'sourceWalletId'='' THEN
        result:=jsonb_build_object('outcome','bank_inflow','eventId',receipt.event_id,'integrationId',receipt.integration_id,
          'merchantId',mapped.merchant_id,'customerId',mapped.customer_id,'goalId',mapped.goal_id,
          'providerTransactionId',observed->>'providerTransactionId','destinationWalletId',observed->>'destinationWalletId',
          'destinationCustomerId',observed->>'destinationCustomerId','reference',observed->>'reference',
          'amountKobo',(observed->>'amountKobo')::bigint,'feeKobo',0,'currency',observed->>'currency');
      END IF;
    END IF;
  END IF;
  INSERT INTO prefunded_card.inflow_attributions(integration_id,event_id,result)
    VALUES(p_integration,p_event,result) ON CONFLICT(integration_id,event_id)
    DO UPDATE SET result=EXCLUDED.result,updated_at=clock_timestamp();
  RETURN result;
END $$;

CREATE FUNCTION prefunded_card.guard_evidence_identifiers() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identifiers text[]; selected_operation uuid;
BEGIN
  IF TG_TABLE_NAME='operations' THEN
    identifiers:=ARRAY[NEW.collection_reference,NEW.transfer_reference,NEW.collection_provider_transaction_id,NEW.transfer_provider_transaction_id];
    selected_operation:=NEW.id;
  ELSE identifiers:=ARRAY[NEW.provider_transaction_id]; selected_operation:=NEW.operation_id; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('prefunded-evidence:'||NEW.integration_id,0));
  IF EXISTS(SELECT 1 FROM prefunded_card.provider_evidence receipt WHERE receipt.integration_id=NEW.integration_id
    AND receipt.observation->>'status'='verified' AND receipt.observation->>'kind'='bank_inflow'
    AND (receipt.observation->'references') ?| array_remove(identifiers,NULL)
    AND NOT EXISTS(SELECT 1 FROM prefunded_card.operations operation
      WHERE operation.integration_id=NEW.integration_id AND operation.id=selected_operation
        AND (receipt.observation->'references') ? operation.transfer_reference)) THEN
    RAISE EXCEPTION 'provider identity already attributed to bank inflow' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prefunded_evidence_bridge_identifiers BEFORE INSERT OR UPDATE OF collection_provider_transaction_id,transfer_provider_transaction_id
  ON prefunded_card.operations FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_evidence_identifiers();
CREATE TRIGGER prefunded_evidence_alias_identifiers BEFORE INSERT ON prefunded_card.provider_aliases
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_evidence_identifiers();
REVOKE ALL ON FUNCTION prefunded_card.classify_provider_inflow(uuid,text,text),prefunded_card.guard_evidence_identifiers()
  FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;
COMMIT;
