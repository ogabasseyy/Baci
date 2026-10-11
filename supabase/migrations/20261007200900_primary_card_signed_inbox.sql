BEGIN;
CREATE TABLE piggyvest_primary_card.inbox_capabilities (
  integration_id uuid PRIMARY KEY REFERENCES piggyvest_primary_card.settings(integration_id),
  contract_id text NOT NULL,
  evidence_issuer text NOT NULL,
  treasury_webhook_customer_id text NOT NULL,
  transaction_customer_id text NOT NULL,
  payload_contract text NOT NULL CHECK(payload_contract='wallet-transfer-outflow-v1'),
  mapping_contract text NOT NULL CHECK(mapping_contract='single-transaction-third-party-reference-v1'),
  enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE piggyvest_primary_card.signed_inbox (
  integration_id uuid NOT NULL REFERENCES piggyvest_primary_card.settings(integration_id),
  event_id text NOT NULL CHECK(octet_length(event_id) BETWEEN 1 AND 200),
  payload bytea NOT NULL CHECK(octet_length(payload) BETWEEN 1 AND 65536),
  signature text NOT NULL CHECK(signature ~ '^[a-f0-9]{128}$'),
  body_digest text NOT NULL CHECK(body_digest ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','processed','blocked')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 50),
  claim_token uuid,
  lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text CHECK(reason IN ('evidence_deferred','proof_conflict','io_retry','attempts_exhausted')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(integration_id,event_id),
  CHECK((state='processing')=(claim_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX primary_card_signed_inbox_due_idx ON piggyvest_primary_card.signed_inbox(integration_id,available_at) WHERE state IN ('pending','processing');
CREATE TABLE piggyvest_primary_card.signed_inbox_conflicts (
  integration_id uuid NOT NULL,
  event_id text NOT NULL,
  body_digest text NOT NULL CHECK(body_digest ~ '^[a-f0-9]{64}$'),
  payload bytea NOT NULL CHECK(octet_length(payload) BETWEEN 1 AND 65536),
  signature text NOT NULL CHECK(signature ~ '^[a-f0-9]{128}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(integration_id,event_id,body_digest),
  FOREIGN KEY(integration_id,event_id) REFERENCES piggyvest_primary_card.signed_inbox(integration_id,event_id)
);
ALTER TABLE piggyvest_primary_card.inbox_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary_card.signed_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary_card.signed_inbox_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_card_inbox_capability_deny ON piggyvest_primary_card.inbox_capabilities AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
CREATE POLICY primary_card_inbox_deny ON piggyvest_primary_card.signed_inbox AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
CREATE POLICY primary_card_inbox_conflict_deny ON piggyvest_primary_card.signed_inbox_conflicts AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON piggyvest_primary_card.inbox_capabilities,piggyvest_primary_card.signed_inbox,piggyvest_primary_card.signed_inbox_conflicts
 FROM PUBLIC,anon,authenticated,service_role,primary_card_authorizer,primary_card_evidence,primary_card_transfer_worker,primary_card_custody_evidence;

CREATE FUNCTION piggyvest_primary_card.inbox_ready(target_integration uuid, environment text, capability jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary_card.assert_worker($1,$2,true);
  PERFORM configured.integration_id FROM piggyvest_primary_card.inbox_capabilities configured
  JOIN piggyvest_primary_card.settings settings ON settings.integration_id=configured.integration_id
  WHERE configured.integration_id=$1 AND configured.enabled AND capability-'expiresAt'=jsonb_build_object(
    'contractId',configured.contract_id,'evidenceIssuer',configured.evidence_issuer,
    'treasuryWebhookCustomerId',configured.treasury_webhook_customer_id,'transactionCustomerId',configured.transaction_customer_id,
    'payloadContract',configured.payload_contract,'mappingContract',configured.mapping_contract,
    'merchantId',settings.merchant_id,'businessId',settings.business_id)
    AND (capability->>'expiresAt')::timestamptz=settings.expires_at FOR SHARE;
  RETURN FOUND;
END $$;
CREATE FUNCTION piggyvest_primary_card.signed_inbox_readiness(target_integration uuid, environment text, capability jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source_wallet text;
BEGIN
  IF NOT piggyvest_primary_card.inbox_ready($1,$2,$3) THEN RETURN '{"ready":false}'::jsonb; END IF;
  SELECT source_wallet_id INTO STRICT source_wallet FROM piggyvest_primary_card.treasury_policy WHERE integration_id=$1 AND enabled;
  RETURN jsonb_build_object('ready',true,'sourceWalletId',source_wallet);
END $$;
CREATE FUNCTION piggyvest_primary_card.require_signed_inbox_capability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='UPDATE' AND NOT (OLD.state='reserved' AND NEW.state='initializing') THEN RETURN NEW; END IF;
  PERFORM integration_id FROM piggyvest_primary_card.inbox_capabilities WHERE integration_id=NEW.integration_id AND enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'signed custody intake unavailable' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER primary_card_require_signed_inbox BEFORE INSERT OR UPDATE ON piggyvest_primary_card.operations FOR EACH ROW EXECUTE FUNCTION piggyvest_primary_card.require_signed_inbox_capability();
CREATE FUNCTION piggyvest_primary_card.guard_signed_transfer_intake()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.state='ready' AND NEW.state='dispatching' THEN
    PERFORM capability.integration_id FROM piggyvest_primary_card.inbox_capabilities capability
      JOIN piggyvest_primary_card.operations operation ON operation.integration_id=capability.integration_id
      WHERE operation.id=NEW.operation_id AND capability.enabled FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'signed transfer intake unavailable' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER primary_card_guard_signed_transfer_intake BEFORE UPDATE ON piggyvest_primary_card.transfer_outbox FOR EACH ROW EXECUTE FUNCTION piggyvest_primary_card.guard_signed_transfer_intake();
CREATE FUNCTION piggyvest_primary_card.enqueue_signed_inbox(target_integration uuid, environment text, capability jsonb, raw_hex text, signed_header text)
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
    OR envelope->>'customer_id' IS DISTINCT FROM capability->>'treasuryWebhookCustomerId'
    OR jsonb_typeof(envelope->'pvb_reference') IS DISTINCT FROM 'string' OR octet_length(envelope->>'pvb_reference') NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'unattributed signed inbox event' USING ERRCODE='22023'; END IF;
  fingerprint := encode(sha256(payload),'hex');
  INSERT INTO piggyvest_primary_card.signed_inbox(integration_id,event_id,payload,signature,body_digest)
    VALUES($1,envelope->>'eventId',payload,signed_header,fingerprint) ON CONFLICT(integration_id,event_id) DO NOTHING;
  IF FOUND THEN RETURN 'accepted'; END IF;
  SELECT * INTO STRICT stored FROM piggyvest_primary_card.signed_inbox WHERE integration_id=$1 AND event_id=envelope->>'eventId' FOR UPDATE;
  IF stored.body_digest=fingerprint THEN RETURN 'duplicate'; END IF;
  INSERT INTO piggyvest_primary_card.signed_inbox_conflicts(integration_id,event_id,body_digest,payload,signature)
    VALUES($1,envelope->>'eventId',fingerprint,payload,signed_header) ON CONFLICT(integration_id,event_id,body_digest) DO NOTHING;
  RETURN 'conflict';
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary_card.guard_signed_transfer_intake(),piggyvest_primary_card.require_signed_inbox_capability(),piggyvest_primary_card.signed_inbox_readiness(uuid,text,jsonb),piggyvest_primary_card.inbox_ready(uuid,text,jsonb),piggyvest_primary_card.enqueue_signed_inbox(uuid,text,jsonb,text,text)
 FROM PUBLIC,anon,authenticated,service_role,primary_card_authorizer,primary_card_evidence,primary_card_transfer_worker;
GRANT EXECUTE ON FUNCTION piggyvest_primary_card.signed_inbox_readiness(uuid,text,jsonb),piggyvest_primary_card.inbox_ready(uuid,text,jsonb),piggyvest_primary_card.enqueue_signed_inbox(uuid,text,jsonb,text,text) TO primary_card_custody_evidence;
COMMIT;
