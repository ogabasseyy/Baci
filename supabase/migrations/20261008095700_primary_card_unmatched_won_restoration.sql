-- A won dispute resolution can arrive before its create (reordered
-- or lost create delivery). With no existing reversal row the call
-- fell through to the create path and abandoned the uncollected
-- operation — the exact strand 095600 fixed for the create-then-
-- resolve order, unreachable from the resolve branch. Carve unmatched
-- won resolutions out of the abandonment cascade: the charge stands,
-- so record the fence and restore-if-abandoned (an op the expiry
-- drain already abandoned re-reserves like a 095600 restore; live
-- ops are left for the normal forward path). Unmatched lost
-- resolutions keep the abandonment (the charge was reversed). A late
-- create arriving after its resolve already decided the outcome is
-- absorbed as a duplicate instead of raising an identity conflict.
-- Append-only: earlier migrations are untouched (AGENTS.md).
BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.record_checkout_reversal(scope jsonb, operation_id uuid, kind text, provider_event_id text, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary_card.operations%ROWTYPE;
  existing piggyvest_primary_card.checkout_reversals%ROWTYPE;
  reservation_binding_id uuid;
  detached_owner boolean;
  released piggyvest_primary_card.reservations%ROWTYPE;
  policy piggyvest_primary_card.treasury_policy%ROWTYPE;
  binding record;
  binding_ready boolean;
  reserved_total numeric;
BEGIN
  SELECT peek.customer_id IS NULL INTO detached_owner FROM piggyvest_primary_card.operations peek
    WHERE peek.id=operation_id
      AND peek.integration_id=(scope->>'integrationId')::uuid AND peek.merchant_id=(scope->>'merchantId')::uuid;
  IF NOT FOUND THEN detached_owner := false; END IF;
  IF detached_owner THEN
    PERFORM config.integration_id FROM piggyvest_primary_card.settings config
    JOIN piggyvest_primary.integrations integration ON integration.id=config.integration_id AND integration.merchant_id=config.merchant_id
    WHERE config.integration_id=(scope->>'integrationId')::uuid
      AND config.merchant_id=(scope->>'merchantId')::uuid AND config.environment=scope->>'environment'
      AND config.business_id=scope->>'businessId' AND integration.business_id=config.business_id
      AND integration.environment=config.environment AND integration.enabled AND config.enabled
      AND config.expires_at=(scope->>'expiresAt')::timestamptz
      AND config.callback_url=scope->>'callbackUrl'
      AND SESSION_USER=config.evidence_login
    FOR SHARE OF config,integration;
    IF NOT FOUND THEN RAISE EXCEPTION 'card ownership unavailable' USING ERRCODE='42501'; END IF;
  ELSE
    PERFORM piggyvest_primary_card.assert_scope(scope,true,true);
  END IF;
  SELECT * INTO STRICT operation FROM piggyvest_primary_card.operations WHERE id=operation_id
    AND integration_id=(scope->>'integrationId')::uuid AND merchant_id=(scope->>'merchantId')::uuid
    AND (detached_owner OR (customer_id=(scope->>'customerId')::uuid AND user_id=(scope->>'userId')::uuid)) FOR UPDATE;
  IF kind NOT IN ('refund','dispute') OR provider_event_id IS NULL OR octet_length(provider_event_id) NOT BETWEEN 1 AND 128
    OR jsonb_typeof(payload) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(payload)) <> 7
    OR payload->>'event' NOT IN ('refund.processed','charge.dispute.create','charge.dispute.resolve')
    OR payload->>'kind' IS DISTINCT FROM kind
    OR payload->>'transactionReference' IS DISTINCT FROM 'pvb-first-primary-'||operation_id::text
    THEN RAISE EXCEPTION 'invalid reversal evidence' USING ERRCODE='22023'; END IF;
  -- Informational fields may be JSON null (event shapes that carry no
  -- amount); when present they must be well-formed.
  IF payload->'amountKobo' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(payload->'amountKobo') IS DISTINCT FROM 'number'
    OR (payload->>'amountKobo')::numeric <> trunc((payload->>'amountKobo')::numeric)
    OR (payload->>'amountKobo')::numeric NOT BETWEEN 1 AND 9999999999) THEN RAISE EXCEPTION 'invalid reversal amount' USING ERRCODE='22023'; END IF;
  IF payload->'currency' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(payload->'currency') IS DISTINCT FROM 'string'
    OR payload->>'currency' IS DISTINCT FROM 'NGN') THEN RAISE EXCEPTION 'invalid reversal currency' USING ERRCODE='22023'; END IF;
  IF payload->'status' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(payload->'status') IS DISTINCT FROM 'string'
    OR octet_length(payload->>'status') NOT BETWEEN 1 AND 64) THEN RAISE EXCEPTION 'invalid reversal status' USING ERRCODE='22023'; END IF;
  IF payload->'resolution' IS DISTINCT FROM 'null'::jsonb AND payload->>'resolution' NOT IN ('won','lost')
    THEN RAISE EXCEPTION 'invalid reversal resolution' USING ERRCODE='22023'; END IF;
  SELECT * INTO existing FROM piggyvest_primary_card.checkout_reversals
    WHERE checkout_reversals.operation_id=operation.id AND checkout_reversals.kind=record_checkout_reversal.kind
    AND checkout_reversals.provider_event_id=record_checkout_reversal.provider_event_id;
  IF FOUND THEN
    -- A dispute resolve shares its create's provider event id (both are
    -- the dispute id): it updates the row's outcome instead of
    -- inserting. Latest provider outcome wins; the create evidence is
    -- preserved and the resolution column tracks the final state.
    IF payload->>'event' = 'charge.dispute.resolve' THEN
      UPDATE piggyvest_primary_card.checkout_reversals SET resolution=payload->>'resolution'
        WHERE checkout_reversals.operation_id=operation.id AND checkout_reversals.kind=record_checkout_reversal.kind
        AND checkout_reversals.provider_event_id=record_checkout_reversal.provider_event_id;
      IF payload->>'resolution' = 'won' AND operation.state = 'abandoned' THEN
        PERFORM 1 FROM piggyvest_primary_card.collections WHERE collections.operation_id=operation.id;
        IF NOT FOUND THEN
          SELECT * INTO released FROM piggyvest_primary_card.reservations
            WHERE reservations.operation_id=operation.id AND reservations.state='released' FOR UPDATE;
          IF FOUND THEN
            SELECT * INTO STRICT policy FROM piggyvest_primary_card.treasury_policy
              WHERE treasury_policy.integration_id=operation.integration_id AND treasury_policy.enabled FOR SHARE;
            IF to_regprocedure('prefunded_card.treasury_reservation_ready(uuid)') IS NULL THEN
              RAISE EXCEPTION 'treasury authority unavailable' USING ERRCODE='42501';
            END IF;
            EXECUTE 'SELECT * FROM prefunded_card.treasury_bindings WHERE id=$1 FOR UPDATE' INTO STRICT binding USING policy.treasury_binding_id;
            EXECUTE 'SELECT prefunded_card.treasury_reservation_ready($1)' INTO binding_ready USING policy.treasury_binding_id;
            IF binding_ready IS DISTINCT FROM true OR binding.authorized_login <> policy.owner_login
              OR binding.source_wallet_id <> policy.source_wallet_id OR binding.merchant_id <> operation.merchant_id
              OR binding.expected_business_id <> operation.business_id OR binding.currency <> 'NGN'
              OR binding.source_wallet_id=operation.destination_wallet_id OR operation.amount_kobo>policy.max_operation_kobo THEN
              RAISE EXCEPTION 'treasury binding unavailable' USING ERRCODE='42501';
            END IF;
            SELECT COALESCE(sum(amount_kobo),0) INTO reserved_total FROM piggyvest_primary_card.reservations
              WHERE treasury_binding_id=policy.treasury_binding_id AND state='reserved';
            IF reserved_total+operation.amount_kobo>policy.max_reserved_kobo
              OR binding.verified_available_kobo::numeric-binding.reserved_kobo-binding.consumed_kobo<operation.amount_kobo THEN
              RAISE EXCEPTION 'treasury capacity insufficient' USING ERRCODE='23514';
            END IF;
            UPDATE piggyvest_primary_card.reservations SET state='reserved'
              WHERE reservations.operation_id=operation.id;
            EXECUTE 'UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo+$2 WHERE id=$1'
              USING policy.treasury_binding_id,operation.amount_kobo;
          ELSE
            PERFORM 1 FROM piggyvest_primary_card.reservations
              WHERE reservations.operation_id=operation.id AND reservations.state='reserved';
            IF NOT FOUND THEN
              RAISE EXCEPTION 'missing treasury reservation' USING ERRCODE='42501';
            END IF;
          END IF;
          UPDATE piggyvest_primary_card.operations SET state='ready',updated_at=clock_timestamp()
            WHERE piggyvest_primary_card.operations.id=operation.id;
        END IF;
      END IF;
      RETURN jsonb_build_object('outcome','resolved');
    END IF;
    IF payload->>'event' = 'charge.dispute.create' AND existing.resolution IS NOT NULL THEN
      RETURN jsonb_build_object('outcome','duplicate');
    END IF;
    IF existing.evidence <> payload THEN
      RAISE EXCEPTION 'reversal identity conflict' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('outcome','duplicate');
  END IF;
  -- The same provider event recorded against another operation is a
  -- cross-operation conflict, never a second row (the unique index
  -- would reject it anyway; raise the identity error instead).
  PERFORM 1 FROM piggyvest_primary_card.checkout_reversals
    WHERE checkout_reversals.kind=record_checkout_reversal.kind
    AND checkout_reversals.provider_event_id=record_checkout_reversal.provider_event_id;
  IF FOUND THEN RAISE EXCEPTION 'reversal identity conflict' USING ERRCODE='22023'; END IF;
  PERFORM collections.operation_id FROM piggyvest_primary_card.collections WHERE collections.operation_id=operation.id FOR SHARE;
  IF NOT FOUND THEN
    IF kind = 'dispute' AND payload->>'event' = 'charge.dispute.resolve' AND payload->>'resolution' = 'won' THEN
      IF operation.state = 'abandoned' THEN
        PERFORM 1 FROM piggyvest_primary_card.collections WHERE collections.operation_id=operation.id;
        IF NOT FOUND THEN
          SELECT * INTO released FROM piggyvest_primary_card.reservations
            WHERE reservations.operation_id=operation.id AND reservations.state='released' FOR UPDATE;
          IF FOUND THEN
            SELECT * INTO STRICT policy FROM piggyvest_primary_card.treasury_policy
              WHERE treasury_policy.integration_id=operation.integration_id AND treasury_policy.enabled FOR SHARE;
            IF to_regprocedure('prefunded_card.treasury_reservation_ready(uuid)') IS NULL THEN
              RAISE EXCEPTION 'treasury authority unavailable' USING ERRCODE='42501';
            END IF;
            EXECUTE 'SELECT * FROM prefunded_card.treasury_bindings WHERE id=$1 FOR UPDATE' INTO STRICT binding USING policy.treasury_binding_id;
            EXECUTE 'SELECT prefunded_card.treasury_reservation_ready($1)' INTO binding_ready USING policy.treasury_binding_id;
            IF binding_ready IS DISTINCT FROM true OR binding.authorized_login <> policy.owner_login
              OR binding.source_wallet_id <> policy.source_wallet_id OR binding.merchant_id <> operation.merchant_id
              OR binding.expected_business_id <> operation.business_id OR binding.currency <> 'NGN'
              OR binding.source_wallet_id=operation.destination_wallet_id OR operation.amount_kobo>policy.max_operation_kobo THEN
              RAISE EXCEPTION 'treasury binding unavailable' USING ERRCODE='42501';
            END IF;
            SELECT COALESCE(sum(amount_kobo),0) INTO reserved_total FROM piggyvest_primary_card.reservations
              WHERE treasury_binding_id=policy.treasury_binding_id AND state='reserved';
            IF reserved_total+operation.amount_kobo>policy.max_reserved_kobo
              OR binding.verified_available_kobo::numeric-binding.reserved_kobo-binding.consumed_kobo<operation.amount_kobo THEN
              RAISE EXCEPTION 'treasury capacity insufficient' USING ERRCODE='23514';
            END IF;
            UPDATE piggyvest_primary_card.reservations SET state='reserved'
              WHERE reservations.operation_id=operation.id;
            EXECUTE 'UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo+$2 WHERE id=$1'
              USING policy.treasury_binding_id,operation.amount_kobo;
          ELSE
            PERFORM 1 FROM piggyvest_primary_card.reservations
              WHERE reservations.operation_id=operation.id AND reservations.state='reserved';
            IF NOT FOUND THEN
              RAISE EXCEPTION 'missing treasury reservation' USING ERRCODE='42501';
            END IF;
          END IF;
          UPDATE piggyvest_primary_card.operations SET state='ready',updated_at=clock_timestamp()
            WHERE piggyvest_primary_card.operations.id=operation.id;
        END IF;
      END IF;
    ELSIF kind = 'refund' AND (
      jsonb_typeof(payload->'amountKobo') IS DISTINCT FROM 'number'
      OR (payload->>'amountKobo')::numeric < operation.amount_kobo::numeric
    ) THEN
      PERFORM piggyvest_primary_card.flag_reconciliation(scope,operation.id);
    ELSIF operation.state = 'reserved' THEN
      UPDATE piggyvest_primary_card.operations SET state='abandoned',claim_token=NULL,updated_at=clock_timestamp() WHERE id=operation.id;
      IF to_regclass('piggyvest_primary_card.reservations') IS NOT NULL THEN
        SELECT reservations.treasury_binding_id INTO reservation_binding_id FROM piggyvest_primary_card.reservations
          WHERE reservations.operation_id=operation.id AND state='reserved' FOR UPDATE;
        IF FOUND THEN
          UPDATE piggyvest_primary_card.reservations SET state='released' WHERE reservations.operation_id=operation.id;
          IF to_regclass('prefunded_card.treasury_bindings') IS NOT NULL THEN
            EXECUTE 'UPDATE prefunded_card.treasury_bindings SET reserved_kobo=reserved_kobo-$2 WHERE id=$1'
              USING reservation_binding_id,operation.amount_kobo;
          END IF;
        END IF;
      END IF;
    ELSIF operation.state IN ('initializing','init_unknown','ready') THEN
      PERFORM piggyvest_primary_card.record_abandonment(scope,operation.id);
    END IF;
  END IF;
  INSERT INTO piggyvest_primary_card.checkout_reversals(operation_id,integration_id,kind,provider_event_id,evidence,resolution)
    VALUES(operation.id,operation.integration_id,kind,provider_event_id,payload,payload->>'resolution');
  RETURN jsonb_build_object('outcome','recorded');
END $$;
COMMIT;
