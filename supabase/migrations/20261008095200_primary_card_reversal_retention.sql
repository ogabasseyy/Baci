-- A partial refund proves the charge succeeded but returns only part of
-- it: abandoning the uncollected operation releases the FULL treasury
-- capacity while stranding the unrefunded remainder provider-side with
-- no path to credit (abandoned is absorbing, and a later charge-success
-- delivery can no longer collect). Compare the provider-attested
-- refund amount against the charge and abandon only a proven-full
-- refund; a partial (or amount-unknown) refund records the fence and
-- flags the operation for operator reconciliation instead, retaining
-- the reservation and capacity for the pending recovery. Status
-- polling returns reconciliation_required without re-verifying, so the
-- customer sees retained-operation copy rather than a pay-again path
-- or a collection error loop. Later events on the flagged operation
-- record only (flag is absorbing-aware, like abandonment). Disputes
-- carry no amount and keep the existing abandon behavior.
--
-- Detached owners (customer deleted; operation kept with customer_id
-- NULL) cannot satisfy the scope's customer join, so a straight
-- assert_scope would 503 their reversals until provider retries
-- expire — losing money-out evidence for a checkout that may have
-- been charged. Peek the detach marker first (no lock): archived
-- operations bind tenant-only (settings + integration + evidence
-- login, mirrored from assert_scope), while attached operations keep
-- the full customer-scoped assertion. The peek-then-assert order
-- converges on retry; locks still run config/integration before the
-- operation row in both branches.
BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.record_checkout_reversal(scope jsonb, operation_id uuid, kind text, provider_event_id text, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  operation piggyvest_primary_card.operations%ROWTYPE;
  existing piggyvest_primary_card.checkout_reversals%ROWTYPE;
  reservation_binding_id uuid;
  detached_owner boolean;
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
      RETURN jsonb_build_object('outcome','resolved');
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
    IF kind = 'refund' AND (
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
