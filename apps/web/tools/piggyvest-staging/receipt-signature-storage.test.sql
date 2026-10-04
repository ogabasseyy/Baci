\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_user <> 'supabase_admin' OR EXISTS(SELECT FROM public.piggyvest_staging_receipts) THEN
    RAISE EXCEPTION 'Requires empty synthetic receipt database';
  END IF;
END $$;
SET LOCAL ROLE pvb_staging_ingest;
SELECT public.accept_piggyvest_staging_receipt(
  repeat('b',64),'YWJj','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==','staging-v1');
DO $$ DECLARE first_receipt jsonb; duplicate_receipt jsonb; invalid_signature text; BEGIN
  first_receipt:=public.accept_signed_piggyvest_staging_receipt(
    repeat('a',64),'YWJj','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==','staging-v1',repeat('Ab',64));
  IF first_receipt->>'signatureStored' IS DISTINCT FROM 'true' OR first_receipt->>'durable' IS DISTINCT FROM 'true'
    OR first_receipt->>'duplicate' IS DISTINCT FROM 'false' OR current_setting('synchronous_commit')<>'on' THEN
    RAISE EXCEPTION 'Signature durability acknowledgement missing';
  END IF;
  duplicate_receipt:=public.accept_signed_piggyvest_staging_receipt(
    repeat('a',64),'ZGVm','BBBBBBBBBBBBBBBB','BBBBBBBBBBBBBBBBBBBBBA==','staging-v1',repeat('Ab',64));
  IF duplicate_receipt->>'receiptId' IS DISTINCT FROM first_receipt->>'receiptId'
    OR duplicate_receipt->>'duplicate' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Signature redelivery lost receipt identity';
  END IF;
  FOREACH invalid_signature IN ARRAY ARRAY[NULL,'',repeat('a',127),repeat('g',128),repeat('a',128)||E'\n'] LOOP
    BEGIN
      PERFORM public.accept_signed_piggyvest_staging_receipt(
        repeat('c',64),'YWJj','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==','staging-v1',invalid_signature);
      RAISE EXCEPTION 'Invalid signature accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END LOOP;
  BEGIN
    UPDATE public.piggyvest_staging_receipt_signatures SET provider_signature=repeat('b',128);
    RAISE EXCEPTION 'Ingest role overwrote signature';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.piggyvest_staging_receipt_signatures(receipt_id,payload_sha256,provider_signature)
      VALUES((first_receipt->>'receiptId')::uuid,repeat('f',64),repeat('a',128));
    RAISE EXCEPTION 'Cross-payload provenance inserted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.piggyvest_staging_receipt_signatures)<>1
    OR EXISTS(SELECT FROM public.piggyvest_staging_receipts WHERE payload_sha256=repeat('c',64))
    OR NOT EXISTS(SELECT FROM public.piggyvest_staging_receipts WHERE payload_sha256=repeat('a',64) AND ciphertext='YWJj') THEN
    RAISE EXCEPTION 'Duplicate or invalid intake changed provenance/envelope';
  END IF;
END $$;
SET LOCAL ROLE pvb_staging_worker;
DO $$ DECLARE lease record; signature jsonb; BEGIN
  FOR lease IN SELECT * FROM public.claim_piggyvest_staging_receipts(10,300) LOOP
    signature:=public.read_piggyvest_staging_receipt_signature(lease.receipt_id,lease.payload_sha256,lease.claim_token);
    IF lease.payload_sha256=repeat('b',64) THEN
      IF signature IS NOT NULL THEN RAISE EXCEPTION 'Historical header was fabricated'; END IF;
    ELSE
      IF signature IS DISTINCT FROM jsonb_build_object('receiptId',lease.receipt_id,
        'payloadSha256',lease.payload_sha256,'signature',repeat('Ab',64)) THEN
        RAISE EXCEPTION 'Original signed header changed or missing';
      END IF;
    END IF;
    IF public.read_piggyvest_staging_receipt_signature(lease.receipt_id,repeat('f',64),lease.claim_token) IS NOT NULL
      OR public.read_piggyvest_staging_receipt_signature(lease.receipt_id,lease.payload_sha256,gen_random_uuid()) IS NOT NULL THEN
      RAISE EXCEPTION 'Provenance escaped lease or digest fence';
    END IF;
    IF NOT public.resolve_piggyvest_staging_receipt(lease.receipt_id,lease.claim_token,'processed',NULL) THEN
      RAISE EXCEPTION 'Fixture lease resolve failed';
    END IF;
    IF public.read_piggyvest_staging_receipt_signature(lease.receipt_id,lease.payload_sha256,lease.claim_token) IS NOT NULL THEN
      RAISE EXCEPTION 'Resolved lease retained signature access';
    END IF;
  END LOOP;
  BEGIN
    PERFORM provider_signature FROM public.piggyvest_staging_receipt_signatures;
    RAISE EXCEPTION 'Worker read signatures outside lease RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$ DECLARE role_name text; BEGIN
  IF to_regrole('service_role') IS NOT NULL THEN
    IF has_table_privilege('service_role','public.piggyvest_staging_receipt_signatures',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege('service_role','public.piggyvest_staging_receipt_signatures',
        'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_function_privilege('service_role',
        'public.accept_signed_piggyvest_staging_receipt(text,text,text,text,text,text)','EXECUTE') THEN
      RAISE EXCEPTION 'Optional service role retained default privileges';
    END IF;
  END IF;
  FOR role_name IN SELECT rolname FROM pg_roles
    WHERE rolname IN ('anon','authenticated','service_role','authenticator','pvb_staging_ingest') LOOP
    IF has_function_privilege(role_name,'public.read_piggyvest_staging_receipt_signature(uuid,text,uuid)','EXECUTE') THEN
      RAISE EXCEPTION 'Unexpected original-signature reader';
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT FROM pg_class WHERE oid='public.piggyvest_staging_receipt_signatures'::regclass
    AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'Signature RLS missing'; END IF;
END $$;
SET LOCAL ROLE pvb_staging_ingest;
SELECT public.accept_signed_piggyvest_staging_receipt(
  repeat('b',64),'ZGVm','BBBBBBBBBBBBBBBB','BBBBBBBBBBBBBBBBBBBBBA==','staging-v1',repeat('Cd',64));
SELECT public.accept_signed_piggyvest_staging_receipt(
  repeat('a',64),'ZGVm','BBBBBBBBBBBBBBBB','BBBBBBBBBBBBBBBBBBBBBA==','staging-v1',repeat('Ef',64));
RESET ROLE;
UPDATE public.piggyvest_staging_receipts SET status='processing',claim_token=gen_random_uuid(),
  lease_expires_at=clock_timestamp()+interval '5 minutes';
DO $$ DECLARE lease record; original_signature text; BEGIN
  FOR lease IN SELECT * FROM public.piggyvest_staging_receipts LOOP
    original_signature:=CASE WHEN lease.payload_sha256=repeat('a',64) THEN repeat('Ef',64) ELSE repeat('Cd',64) END;
    SET LOCAL ROLE pvb_staging_worker;
    IF public.read_piggyvest_staging_receipt_signature(lease.id,lease.payload_sha256,lease.claim_token)->>'signature'
      IS DISTINCT FROM original_signature THEN RAISE EXCEPTION 'Authentic redelivery provenance not readable'; END IF;
    RESET ROLE;
    UPDATE public.piggyvest_staging_receipts SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=lease.id;
    SET LOCAL ROLE pvb_staging_worker;
    IF public.read_piggyvest_staging_receipt_signature(lease.id,lease.payload_sha256,lease.claim_token) IS NOT NULL THEN
      RAISE EXCEPTION 'Expired lease read original signature';
    END IF;
    RESET ROLE;
  END LOOP;
END $$;
CREATE FUNCTION public.refuse_test_signature() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Synthetic insert refusal' USING ERRCODE='23514'; END $$;
CREATE TRIGGER refuse_test_signature BEFORE INSERT ON public.piggyvest_staging_receipt_signatures
  FOR EACH ROW EXECUTE FUNCTION public.refuse_test_signature();
SET LOCAL ROLE pvb_staging_ingest;
DO $$ BEGIN
  BEGIN
    PERFORM public.accept_signed_piggyvest_staging_receipt(
      repeat('d',64),'YWJj','AAAAAAAAAAAAAAAA','AAAAAAAAAAAAAAAAAAAAAA==','staging-v1',repeat('Ab',64));
    RAISE EXCEPTION 'Failed signature storage was acknowledged';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS(SELECT FROM public.piggyvest_staging_receipts WHERE payload_sha256=repeat('d',64)) THEN
    RAISE EXCEPTION 'Signature write failure left a durable unsigned receipt';
  END IF;
END $$;
ROLLBACK;
