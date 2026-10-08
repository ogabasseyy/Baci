-- Widen provider checkout URL validation from a single alphanumeric path
-- segment to HTTPS hostname validation in both the operations table
-- constraint and record_initialization. The provider may add path
-- segments, hyphens, or query strings to a legitimate checkout URL;
-- rejecting those strands initialization as init_unknown. The hostname
-- match still rejects lookalikes (subdomains, userinfo hosts, and
-- non-HTTPS schemes fail the match).
BEGIN;
ALTER TABLE piggyvest_primary_card.operations
  DROP CONSTRAINT operations_authorization_url_check;
ALTER TABLE piggyvest_primary_card.operations
  ADD CONSTRAINT operations_authorization_url_check
  CHECK (authorization_url ~ '^https://checkout\.paystack\.com([/?#]|$)');
CREATE OR REPLACE FUNCTION piggyvest_primary_card.record_initialization(scope jsonb, operation_id uuid, token uuid, session jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary_card.read_operation(scope,operation_id);
  IF session IS NOT NULL AND (jsonb_typeof(session) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(session)) <> 2
    OR session->>'reference' IS DISTINCT FROM 'pvb-first-primary-'||operation_id::text
    OR session->>'authorizationUrl' IS NULL
    OR octet_length(session->>'authorizationUrl') > 512
    OR session->>'authorizationUrl' !~ '^https://checkout\.paystack\.com([/?#]|$)') THEN
    RAISE EXCEPTION 'invalid checkout session' USING ERRCODE='22023';
  END IF;
  UPDATE piggyvest_primary_card.operations SET state=CASE WHEN session IS NULL THEN 'init_unknown' ELSE 'ready' END,
    claim_token=NULL,authorization_url=session->>'authorizationUrl',updated_at=clock_timestamp()
  WHERE id=operation_id AND state='initializing' AND claim_token=token;
  RETURN FOUND;
END $$;
COMMIT;
