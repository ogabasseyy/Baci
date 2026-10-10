-- Retain minimally attributable signed custody receipts even when the
-- provider omits pvb_reference. The inbox row is keyed by event_id, and
-- an authentic envelope with a verified type, category, wallet, and
-- customer is attributable evidence; rejecting it at intake converts a
-- permanent provider shape gap into a 503 on every redelivery until
-- retries exhaust, with no durable receipt for reconciliation — while a
-- completed treasury transfer may already exist. Accept the bytes (the
-- row still requires the verified attribution fields) and let the
-- worker block the unprocessable receipt for review with its evidence
-- intact, instead of burning deferred retries on a mapping that can
-- never resolve.
BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary_card.enqueue_signed_inbox(target_integration uuid, environment text, capability jsonb, raw_hex text, signed_header text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE payload bytea; envelope jsonb; stored piggyvest_primary_card.signed_inbox%ROWTYPE; fingerprint text; source_wallet text;
BEGIN
  IF NOT piggyvest_primary_card.inbox_ready($1,$2,$3) THEN RAISE EXCEPTION 'signed inbox capability unavailable' USING ERRCODE='42501'; END IF;
  IF raw_hex IS NULL OR raw_hex !~ '^[a-f0-9]+$' OR length(raw_hex) NOT BETWEEN 2 AND 131072 OR length(raw_hex)%2<>0
    OR signed_header IS NULL OR signed_header !~ '^[a-f0-9]{128}$' THEN RAISE EXCEPTION 'invalid signed inbox bytes' USING ERRCODE='22023'; END IF;
  payload := decode(raw_hex,'hex'); envelope := convert_from(payload,'UTF8')::jsonb;
  SELECT policy.source_wallet_id INTO STRICT source_wallet FROM piggyvest_primary_card.treasury_policy policy WHERE policy.integration_id=$1 AND enabled FOR SHARE;
  IF jsonb_typeof(envelope) IS DISTINCT FROM 'object' OR jsonb_typeof(envelope->'eventId') IS DISTINCT FROM 'string'
    OR octet_length(envelope->>'eventId') NOT BETWEEN 1 AND 200 OR envelope->>'eventType' IS DISTINCT FROM 'wallet-transfer.outflow.success'
    OR envelope->>'eventCategory' IS DISTINCT FROM 'wallet-transfer' OR envelope->>'pvb_wallet' IS DISTINCT FROM source_wallet
    OR envelope->>'customer_id' IS DISTINCT FROM capability->>'treasuryWebhookCustomerId' THEN
    RAISE EXCEPTION 'unattributed signed inbox event' USING ERRCODE='22023'; END IF;
  fingerprint := encode(sha256(payload),'hex');
  INSERT INTO piggyvest_primary_card.signed_inbox(integration_id,event_id,payload,signature,body_digest)
    VALUES($1,envelope->>'eventId',payload,signed_header,fingerprint) ON CONFLICT(integration_id,event_id) DO NOTHING;
  IF FOUND THEN RETURN 'accepted'; END IF;
  SELECT * INTO STRICT stored FROM piggyvest_primary_card.signed_inbox WHERE integration_id=$1 AND event_id=envelope->>'eventId' FOR UPDATE;
  IF stored.body_digest=fingerprint THEN RETURN CASE WHEN stored.state='blocked' THEN 'conflict' ELSE 'duplicate' END; END IF;
  INSERT INTO piggyvest_primary_card.signed_inbox_conflicts(integration_id,event_id,body_digest,payload,signature)
    VALUES($1,envelope->>'eventId',fingerprint,payload,signed_header) ON CONFLICT(integration_id,event_id,body_digest) DO NOTHING;
  UPDATE piggyvest_primary_card.signed_inbox SET state='blocked',reason='proof_conflict',claim_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
    WHERE integration_id=$1 AND event_id=envelope->>'eventId';
  RETURN 'conflict';
END $$;
COMMIT;
