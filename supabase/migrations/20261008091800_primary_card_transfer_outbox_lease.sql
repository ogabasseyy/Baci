-- Reclaim transfer-dispatch claims whose holder died between claim and
-- provider submission. A claimed outbox row stayed 'dispatching' forever:
-- claim_transfer returned 'existing' for every non-'ready' row and the
-- selector only picked 'ready' rows, so a crashed worker left the
-- customer charged (collection succeeded) with no treasury transfer ever
-- submitted and no signed custody event able to arrive.
-- Two coordinated changes, mirroring the initialization claim lease:
-- 1. claim_transfer re-issues the token for a 'dispatching' claim older
--    than five minutes (dwarfs the five-second provider timeout, so an
--    unrecorded claim that old implies a dead holder) and reports the
--    distinct outcome 'reclaimed' so the worker verifies the provider
--    reference before resubmitting. Fresher claims keep 'existing' so
--    concurrent workers share one submission. The command is rebuilt from
--    the same rows, so a reclaim reuses the identical provider reference.
--    Treasury, custody, and reservation bindings are re-validated before
--    any reclaim, exactly as for a fresh claim.
-- 2. select_ready_transfers also selects stale 'dispatching' rows: without
--    selection no worker would ever call claim on them and the lease
--    would be dead code. Row locking still serializes overlapping
--    workers; the loser sees a fresh claim and gets 'existing'.
BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.claim_transfer(integration_id uuid, environment text, operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE outbox piggyvest_primary_card.transfer_outbox%ROWTYPE; command jsonb; binding record; policy piggyvest_primary_card.treasury_policy%ROWTYPE; ready boolean; stale boolean;
BEGIN
  PERFORM piggyvest_primary_card.assert_worker($1,$2,false);
  SELECT * INTO STRICT outbox FROM piggyvest_primary_card.transfer_outbox WHERE transfer_outbox.operation_id=$3 FOR UPDATE;
  SELECT jsonb_build_object('operationId',operation.id,'sourceWalletId',reservation.source_wallet_id,
    'destinationWalletId',operation.destination_wallet_id,'amountKobo',operation.amount_kobo,'reference',reservation.transfer_reference,'currency','NGN')
    INTO command FROM piggyvest_primary_card.operations operation JOIN piggyvest_primary_card.reservations reservation ON reservation.operation_id=operation.id
    JOIN piggyvest_primary_card.collections collection ON collection.operation_id=operation.id
    WHERE operation.id=$3 AND operation.integration_id=$1 AND operation.environment=$2 AND operation.state='custody_pending' AND reservation.state='reserved';
  IF command IS NULL THEN RETURN jsonb_build_object('outcome','existing'); END IF;
  stale := outbox.state='dispatching' AND outbox.updated_at < clock_timestamp() - interval '5 minutes';
  IF outbox.state<>'ready' AND NOT stale THEN RETURN jsonb_build_object('outcome','existing'); END IF;
  SELECT * INTO STRICT policy FROM piggyvest_primary_card.treasury_policy WHERE treasury_policy.integration_id=$1 AND enabled FOR SHARE;
  EXECUTE 'SELECT * FROM prefunded_card.treasury_bindings WHERE id=$1 FOR UPDATE' INTO STRICT binding USING policy.treasury_binding_id;
  EXECUTE 'SELECT prefunded_card.treasury_reservation_ready($1)' INTO ready USING policy.treasury_binding_id;
  IF ready IS DISTINCT FROM true OR binding.authorized_login<>policy.owner_login OR binding.source_wallet_id<>command->>'sourceWalletId'
    OR policy.source_wallet_id<>command->>'sourceWalletId' THEN RAISE EXCEPTION 'transfer treasury unavailable' USING ERRCODE='42501'; END IF;
  UPDATE piggyvest_primary_card.transfer_outbox SET state='dispatching',claim_token=gen_random_uuid(),updated_at=clock_timestamp()
    WHERE transfer_outbox.operation_id=$3 RETURNING * INTO outbox;
  RETURN jsonb_build_object('outcome',CASE WHEN stale THEN 'reclaimed' ELSE 'claimed' END,'token',outbox.claim_token,'command',command);
END $$;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.select_ready_transfers(integration_id uuid, environment text, capability jsonb, maximum integer)
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
      AND (outbox.state='ready' OR (outbox.state='dispatching' AND outbox.updated_at < clock_timestamp() - interval '5 minutes'))
      AND reservation.state='reserved'
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
COMMIT;
