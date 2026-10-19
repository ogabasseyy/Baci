\set ON_ERROR_STOP on
\if :{?expected_system_identifier}
\else
DO $$ BEGIN RAISE EXCEPTION 'Required expected_system_identifier is absent'; END $$;
\endif
BEGIN;
SET LOCAL pvb_staging.expected_system_identifier = :'expected_system_identifier';
DO $$ BEGIN
  IF current_user<>'supabase_admin'
    OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper)
    OR current_setting('pvb_staging.expected_system_identifier') !~ '^[0-9]{1,20}$'
    OR (SELECT system_identifier::text FROM pg_control_system())<>current_setting('pvb_staging.expected_system_identifier') THEN
    RAISE EXCEPTION 'Receipt signature storage target refused';
  END IF;
  IF to_regclass('public.piggyvest_staging_receipts') IS NULL
    OR NOT EXISTS(SELECT FROM pg_proc WHERE oid=to_regprocedure('public.claim_piggyvest_staging_receipts(integer,integer)')
      AND proowner='pvb_staging_replay_executor'::regrole)
    OR EXISTS(SELECT FROM pg_roles WHERE rolname IN ('pvb_staging_ingest','pvb_staging_worker','pvb_staging_replay_executor')
      AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Restricted intake and runtime replay storage must be installed first';
  END IF;
END $$;

CREATE TABLE public.piggyvest_staging_receipt_signatures (
  receipt_id uuid NOT NULL REFERENCES public.piggyvest_staging_receipts(id),
  payload_sha256 text NOT NULL CHECK(octet_length(payload_sha256)=64 AND payload_sha256 ~ '^[a-f0-9]{64}$'),
  provider_signature text NOT NULL CHECK(octet_length(provider_signature)=128 AND provider_signature ~ '^[a-fA-F0-9]{128}$'),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(receipt_id,provider_signature)
);
CREATE INDEX piggyvest_receipt_signature_latest ON public.piggyvest_staging_receipt_signatures(receipt_id,received_at DESC);
ALTER TABLE public.piggyvest_staging_receipt_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.piggyvest_staging_receipt_signatures FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.piggyvest_staging_receipt_signatures
  FROM PUBLIC,anon,authenticated,authenticator,pvb_staging_worker,pvb_staging_ingest,pvb_staging_replay_executor;
GRANT SELECT(receipt_id,payload_sha256,provider_signature), INSERT(receipt_id,payload_sha256,provider_signature)
  ON public.piggyvest_staging_receipt_signatures TO pvb_staging_ingest;
GRANT SELECT ON public.piggyvest_staging_receipt_signatures TO pvb_staging_replay_executor;
CREATE POLICY receipt_signature_ingest_insert ON public.piggyvest_staging_receipt_signatures
  FOR INSERT TO pvb_staging_ingest WITH CHECK(EXISTS(
    SELECT FROM public.piggyvest_staging_receipts receipt WHERE receipt.id=receipt_id AND receipt.payload_sha256=piggyvest_staging_receipt_signatures.payload_sha256));
CREATE POLICY receipt_signature_ingest_select ON public.piggyvest_staging_receipt_signatures
  FOR SELECT TO pvb_staging_ingest USING(true);
CREATE POLICY receipt_signature_reader ON public.piggyvest_staging_receipt_signatures
  FOR SELECT TO pvb_staging_replay_executor USING(true);

CREATE FUNCTION public.accept_signed_piggyvest_staging_receipt(
  p_payload_sha256 text,p_ciphertext text,p_nonce text,p_auth_tag text,p_key_version text,p_original_signature text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE receipt jsonb;
BEGIN
  IF p_original_signature IS NULL OR octet_length(p_original_signature)<>128
    OR p_original_signature !~ '^[a-fA-F0-9]{128}$' THEN
    RAISE EXCEPTION 'Invalid original receipt signature' USING ERRCODE='22023';
  END IF;
  PERFORM set_config('synchronous_commit','on',true);
  receipt:=public.accept_piggyvest_staging_receipt(p_payload_sha256,p_ciphertext,p_nonce,p_auth_tag,p_key_version);
  INSERT INTO public.piggyvest_staging_receipt_signatures(receipt_id,payload_sha256,provider_signature)
    VALUES((receipt->>'receiptId')::uuid,p_payload_sha256,p_original_signature) ON CONFLICT DO NOTHING;
  RETURN receipt||jsonb_build_object('signatureStored',true);
END $$;
REVOKE ALL ON FUNCTION public.accept_signed_piggyvest_staging_receipt(text,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated,authenticator,pvb_staging_worker,pvb_staging_replay_executor;
GRANT EXECUTE ON FUNCTION public.accept_signed_piggyvest_staging_receipt(text,text,text,text,text,text) TO pvb_staging_ingest;

CREATE FUNCTION public.read_piggyvest_staging_receipt_signature(p_receipt_id uuid,p_payload_sha256 text,p_claim_token uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; claim_deadline timestamptz;
BEGIN
  IF p_receipt_id IS NULL OR p_claim_token IS NULL OR p_payload_sha256 IS NULL
    OR octet_length(p_payload_sha256)<>64 OR p_payload_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid receipt signature claim' USING ERRCODE='22023';
  END IF;
  SELECT jsonb_build_object('receiptId',receipt.id,'payloadSha256',receipt.payload_sha256,'signature',signature.provider_signature),receipt.lease_expires_at
    INTO result,claim_deadline FROM public.piggyvest_staging_receipts receipt
    JOIN public.piggyvest_staging_receipt_signatures signature ON signature.receipt_id=receipt.id
      AND signature.payload_sha256=receipt.payload_sha256
    WHERE receipt.id=p_receipt_id AND receipt.payload_sha256=p_payload_sha256 AND receipt.claim_token=p_claim_token
      AND receipt.status='processing' AND receipt.lease_expires_at>clock_timestamp()
    ORDER BY signature.received_at DESC,signature.provider_signature LIMIT 1 FOR SHARE OF receipt;
  IF claim_deadline IS NULL OR claim_deadline<=clock_timestamp() THEN RETURN NULL; END IF;
  RETURN result;
END $$;
GRANT CREATE ON SCHEMA public TO pvb_staging_replay_executor;
ALTER FUNCTION public.read_piggyvest_staging_receipt_signature(uuid,text,uuid) OWNER TO pvb_staging_replay_executor;
REVOKE CREATE ON SCHEMA public FROM pvb_staging_replay_executor;
REVOKE ALL ON FUNCTION public.read_piggyvest_staging_receipt_signature(uuid,text,uuid)
  FROM PUBLIC,anon,authenticated,authenticator,pvb_staging_ingest;
GRANT EXECUTE ON FUNCTION public.read_piggyvest_staging_receipt_signature(uuid,text,uuid) TO pvb_staging_worker;
DO $$ BEGIN
  IF to_regrole('service_role') IS NOT NULL THEN
    REVOKE ALL ON public.piggyvest_staging_receipt_signatures FROM service_role;
    REVOKE ALL ON FUNCTION public.accept_signed_piggyvest_staging_receipt(text,text,text,text,text,text) FROM service_role;
    REVOKE ALL ON FUNCTION public.read_piggyvest_staging_receipt_signature(uuid,text,uuid) FROM service_role;
  END IF;
  IF has_any_column_privilege('pvb_staging_worker','public.piggyvest_staging_receipt_signatures','SELECT,INSERT,UPDATE,REFERENCES')
    OR has_table_privilege('pvb_staging_ingest','public.piggyvest_staging_receipt_signatures','UPDATE,DELETE,TRUNCATE,TRIGGER')
    OR has_any_column_privilege('pvb_staging_ingest','public.piggyvest_staging_receipt_signatures','UPDATE') THEN
    RAISE EXCEPTION 'Receipt signature privilege boundary refused';
  END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
