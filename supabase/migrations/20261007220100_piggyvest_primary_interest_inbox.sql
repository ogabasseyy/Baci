BEGIN;
CREATE TABLE piggyvest_primary.paid_interest_inbox (
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  event_id text NOT NULL CHECK(octet_length(event_id) BETWEEN 1 AND 512),
  payload bytea NOT NULL CHECK(octet_length(payload) BETWEEN 1 AND 65536),
  signature text NOT NULL CHECK(signature ~ '^[a-f0-9]{128}$'),
  body_digest text NOT NULL CHECK(body_digest ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','processed','quarantined')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 50),
  claim_token uuid,lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text CHECK(reason IN ('prerequisite','io_retry','proof_conflict','event_conflict','invalid_receipt')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(integration_id,event_id),
  CHECK((state='processing')=(claim_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX primary_interest_inbox_due_idx ON piggyvest_primary.paid_interest_inbox(integration_id,available_at)
  WHERE state IN ('pending','processing');
CREATE TABLE piggyvest_primary.paid_interest_inbox_conflicts (
  integration_id uuid NOT NULL,event_id text NOT NULL,
  body_digest text NOT NULL CHECK(body_digest ~ '^[a-f0-9]{64}$'),
  payload bytea NOT NULL CHECK(octet_length(payload) BETWEEN 1 AND 65536),
  signature text NOT NULL CHECK(signature ~ '^[a-f0-9]{128}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(integration_id,event_id,body_digest),
  FOREIGN KEY(integration_id,event_id) REFERENCES piggyvest_primary.paid_interest_inbox(integration_id,event_id)
);
CREATE TABLE piggyvest_primary.paid_interest_inbox_observations (
  integration_id uuid NOT NULL,event_id text NOT NULL,body_digest text NOT NULL CHECK(body_digest ~ '^[a-f0-9]{64}$'),
  payout_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(integration_id,event_id,body_digest),
  FOREIGN KEY(integration_id,payout_id) REFERENCES piggyvest_primary.paid_interest_receipts(integration_id,payout_id)
);
CREATE INDEX primary_interest_inbox_observation_payout_idx ON piggyvest_primary.paid_interest_inbox_observations(integration_id,payout_id);
ALTER TABLE piggyvest_primary.paid_interest_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary.paid_interest_inbox_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary.paid_interest_inbox_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_interest_inbox_deny ON piggyvest_primary.paid_interest_inbox AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
CREATE POLICY primary_interest_inbox_conflicts_deny ON piggyvest_primary.paid_interest_inbox_conflicts AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
CREATE POLICY primary_interest_inbox_observations_deny ON piggyvest_primary.paid_interest_inbox_observations AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON piggyvest_primary.paid_interest_inbox,piggyvest_primary.paid_interest_inbox_conflicts,piggyvest_primary.paid_interest_inbox_observations
  FROM PUBLIC,anon,authenticated,service_role,piggyvest_primary_evidence;
CREATE FUNCTION piggyvest_primary.guard_interest_inbox_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF (NEW.integration_id,NEW.event_id,NEW.payload,NEW.signature,NEW.body_digest,NEW.created_at)
    IS DISTINCT FROM (OLD.integration_id,OLD.event_id,OLD.payload,OLD.signature,OLD.body_digest,OLD.created_at) THEN
    RAISE EXCEPTION 'immutable interest inbox evidence' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER primary_interest_inbox_identity BEFORE UPDATE ON piggyvest_primary.paid_interest_inbox
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.guard_interest_inbox_identity();
CREATE TRIGGER primary_interest_inbox_delete BEFORE DELETE OR TRUNCATE ON piggyvest_primary.paid_interest_inbox
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_ledger.immutable();
CREATE TRIGGER primary_interest_inbox_conflicts_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON piggyvest_primary.paid_interest_inbox_conflicts
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_ledger.immutable();
CREATE TRIGGER primary_interest_inbox_observations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON piggyvest_primary.paid_interest_inbox_observations
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_savings_ledger.immutable();

CREATE FUNCTION piggyvest_primary.paid_interest_event_involved(p_integration uuid,p_environment text,p_selection jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary.assert_paid_interest_worker(p_integration,p_environment);
  IF jsonb_typeof(p_selection) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid interest selection' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_selection))<>5
    OR NOT p_selection ?& ARRAY['webhookCustomerId','sourceWalletId','accruedWalletId','destinationWalletId','envelopeDestinationWalletId'] THEN
    RAISE EXCEPTION 'invalid interest selection' USING ERRCODE='22023';
  END IF;
  RETURN EXISTS(SELECT 1 FROM piggyvest_primary.paid_interest_crosswalks mapping
    WHERE mapping.integration_id=p_integration
      AND (mapping.webhook_customer_id=p_selection->>'webhookCustomerId'
        OR mapping.source_wallet_id=p_selection->>'sourceWalletId'
        OR mapping.accrued_wallet_id=p_selection->>'accruedWalletId'
        OR mapping.destination_wallet_id=p_selection->>'destinationWalletId'));
END $$;
CREATE FUNCTION piggyvest_primary.enqueue_paid_interest_inbox(p_integration uuid,p_environment text,p_command jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE payload bytea; envelope jsonb; fingerprint text; stored piggyvest_primary.paid_interest_inbox%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary.assert_paid_interest_worker(p_integration,p_environment);
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid interest intake' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_command))<>2 OR NOT p_command ?& ARRAY['rawHex','signature']
    OR jsonb_typeof(p_command->'rawHex') IS DISTINCT FROM 'string' OR p_command->>'rawHex' !~ '^[a-f0-9]+$'
    OR length(p_command->>'rawHex') NOT BETWEEN 2 AND 131072 OR length(p_command->>'rawHex')%2<>0
    OR jsonb_typeof(p_command->'signature') IS DISTINCT FROM 'string' OR p_command->>'signature' !~ '^[a-f0-9]{128}$' THEN
    RAISE EXCEPTION 'invalid signed interest bytes' USING ERRCODE='22023';
  END IF;
  payload:=decode(p_command->>'rawHex','hex'); envelope:=convert_from(payload,'UTF8')::jsonb;
  IF jsonb_typeof(envelope) IS DISTINCT FROM 'object' OR envelope->>'eventType' IS DISTINCT FROM 'interest-payout.success'
    OR envelope->>'eventCategory' IS NULL OR envelope->>'eventCategory' NOT IN ('interest-payout','interest_payout')
    OR jsonb_typeof(envelope->'eventId') IS DISTINCT FROM 'string' OR octet_length(envelope->>'eventId') NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'invalid interest envelope' USING ERRCODE='22023';
  END IF;
  IF NOT piggyvest_primary.paid_interest_event_involved(p_integration,p_environment,
    jsonb_build_object('webhookCustomerId',envelope->'customer_id','sourceWalletId',envelope->'pvb_wallet',
      'accruedWalletId',envelope->'pvb_accrued_interest_wallet',
      'destinationWalletId',envelope->'eventData'->'destination_wallet',
      'envelopeDestinationWalletId',envelope->'pvb_destination_wallet')) THEN RETURN 'not_handled'; END IF;
  fingerprint:=encode(sha256(payload),'hex');
  INSERT INTO piggyvest_primary.paid_interest_inbox(integration_id,event_id,payload,signature,body_digest)
    VALUES(p_integration,envelope->>'eventId',payload,p_command->>'signature',fingerprint) ON CONFLICT DO NOTHING;
  IF FOUND THEN RETURN 'accepted'; END IF;
  SELECT * INTO STRICT stored FROM piggyvest_primary.paid_interest_inbox WHERE integration_id=p_integration AND event_id=envelope->>'eventId' FOR UPDATE;
  IF stored.body_digest=fingerprint THEN RETURN CASE WHEN stored.state='quarantined' THEN 'quarantined' ELSE 'duplicate' END; END IF;
  INSERT INTO piggyvest_primary.paid_interest_inbox_conflicts(integration_id,event_id,body_digest,payload,signature)
    VALUES(p_integration,envelope->>'eventId',fingerprint,payload,p_command->>'signature') ON CONFLICT DO NOTHING;
  UPDATE piggyvest_primary.paid_interest_inbox SET state='quarantined',reason='event_conflict',claim_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
    WHERE integration_id=p_integration AND event_id=envelope->>'eventId';
  RETURN 'quarantined';
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.guard_interest_inbox_identity(),piggyvest_primary.paid_interest_event_involved(uuid,text,jsonb),
  piggyvest_primary.enqueue_paid_interest_inbox(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.paid_interest_event_involved(uuid,text,jsonb),
  piggyvest_primary.enqueue_paid_interest_inbox(uuid,text,jsonb) TO piggyvest_primary_evidence;
COMMIT;
