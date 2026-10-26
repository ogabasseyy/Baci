BEGIN;
CREATE OR REPLACE FUNCTION piggyvest_primary.enqueue_paid_interest_inbox(p_integration uuid,p_environment text,p_command jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  payload bytea;
  envelope jsonb;
  fingerprint text;
  event_key text;
  receipt_valid boolean:=false;
  receipt_involved boolean:=false;
  stored piggyvest_primary.paid_interest_inbox%ROWTYPE;
BEGIN
  PERFORM piggyvest_primary.assert_paid_interest_worker(p_integration,p_environment);
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid interest intake' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_command))<>2 OR NOT p_command ?& ARRAY['rawHex','signature']
    OR jsonb_typeof(p_command->'rawHex') IS DISTINCT FROM 'string' OR p_command->>'rawHex' !~ '^[a-f0-9]+$'
    OR length(p_command->>'rawHex') NOT BETWEEN 2 AND 131072 OR length(p_command->>'rawHex')%2<>0
    OR jsonb_typeof(p_command->'signature') IS DISTINCT FROM 'string' OR p_command->>'signature' !~ '^[a-f0-9]{128}$' THEN
    RAISE EXCEPTION 'invalid signed interest bytes' USING ERRCODE='22023';
  END IF;
  payload:=decode(p_command->>'rawHex','hex');
  fingerprint:=encode(sha256(payload),'hex');
  BEGIN
    envelope:=convert_from(payload,'UTF8')::jsonb;
  EXCEPTION WHEN data_exception OR program_limit_exceeded THEN
    envelope:=NULL;
  END;
  IF jsonb_typeof(envelope)='object' AND jsonb_typeof(envelope->'eventId')='string'
    AND octet_length(envelope->>'eventId') BETWEEN 1 AND 512 THEN
    event_key:=envelope->>'eventId';
  END IF;
  IF jsonb_typeof(envelope)='object' AND envelope->>'eventType'='interest-payout.success'
    AND envelope->>'eventCategory' IN ('interest-payout','interest_payout') AND event_key IS NOT NULL THEN
    receipt_valid:=true;
    receipt_involved:=piggyvest_primary.paid_interest_event_involved(p_integration,p_environment,
      jsonb_build_object('webhookCustomerId',envelope->'customer_id','sourceWalletId',envelope->'pvb_wallet',
        'accruedWalletId',envelope->'pvb_accrued_interest_wallet',
        'destinationWalletId',envelope->'eventData'->'destination_wallet',
        'envelopeDestinationWalletId',envelope->'pvb_destination_wallet'));
  END IF;
  IF event_key IS NULL THEN event_key:='raw:'||fingerprint; END IF;
  IF NOT receipt_valid OR NOT receipt_involved THEN
    INSERT INTO piggyvest_primary.paid_interest_inbox(integration_id,event_id,payload,signature,body_digest,state,reason)
      VALUES(p_integration,event_key,payload,p_command->>'signature',fingerprint,'quarantined','invalid_receipt') ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO piggyvest_primary.paid_interest_inbox(integration_id,event_id,payload,signature,body_digest)
      VALUES(p_integration,event_key,payload,p_command->>'signature',fingerprint) ON CONFLICT DO NOTHING;
  END IF;
  IF FOUND THEN RETURN CASE WHEN receipt_valid AND receipt_involved THEN 'accepted' ELSE 'quarantined' END; END IF;
  SELECT * INTO STRICT stored FROM piggyvest_primary.paid_interest_inbox
    WHERE integration_id=p_integration AND event_id=event_key FOR UPDATE;
  IF stored.body_digest=fingerprint THEN
    RETURN CASE WHEN stored.state='quarantined' THEN 'quarantined' ELSE 'duplicate' END;
  END IF;
  INSERT INTO piggyvest_primary.paid_interest_inbox_conflicts(integration_id,event_id,body_digest,payload,signature)
    VALUES(p_integration,event_key,fingerprint,payload,p_command->>'signature') ON CONFLICT DO NOTHING;
  UPDATE piggyvest_primary.paid_interest_inbox SET state='quarantined',reason='event_conflict',claim_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
    WHERE integration_id=p_integration AND event_id=event_key;
  RETURN 'quarantined';
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.enqueue_paid_interest_inbox(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.enqueue_paid_interest_inbox(uuid,text,jsonb) TO piggyvest_primary_evidence;
COMMIT;
