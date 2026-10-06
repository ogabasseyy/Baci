\set ON_ERROR_STOP on
BEGIN;
SET LOCAL synchronous_commit = off;
SET LOCAL ROLE pvb_staging_ingest;

DO $test$
DECLARE
  first_receipt jsonb;
  second_receipt jsonb;
  invalid_case text[];
BEGIN
  first_receipt := public.accept_piggyvest_staging_receipt(
    repeat('a', 64), 'YWJj', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1');
  IF current_setting('synchronous_commit') <> 'on' THEN
    RAISE EXCEPTION 'Receipt commit is not synchronous';
  END IF;
  IF first_receipt->>'receiptId' IS NULL
    OR (first_receipt->>'receiptId')::uuid IS NULL
    OR first_receipt <> jsonb_build_object('receiptId', first_receipt->>'receiptId', 'duplicate', false, 'durable', true) THEN
    RAISE EXCEPTION 'Unexpected first receipt response';
  END IF;
  second_receipt := public.accept_piggyvest_staging_receipt(
    repeat('a', 64), 'ZGVm', 'BBBBBBBBBBBBBBBB', 'BBBBBBBBBBBBBBBBBBBBBA==', 'staging-v1');
  IF second_receipt <> jsonb_build_object('receiptId', first_receipt->>'receiptId', 'duplicate', true, 'durable', true) THEN
    RAISE EXCEPTION 'Duplicate did not preserve receipt identity';
  END IF;
  BEGIN
    PERFORM ciphertext FROM public.piggyvest_staging_receipts;
    RAISE EXCEPTION 'Ingest role can read ciphertext';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  FOREACH invalid_case SLICE 1 IN ARRAY ARRAY[
    ARRAY[NULL, 'YWJj', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1'],
    ARRAY[repeat('A', 64), 'YWJj', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1'],
    ARRAY[repeat('b', 63), 'YWJj', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1'],
    ARRAY[repeat('b', 64), NULL, 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1'],
    ARRAY[repeat('b', 64), '', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1'],
    ARRAY[repeat('b', 64), repeat('A', 1398108), 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1'],
    ARRAY[repeat('b', 64), '!!!!', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1'],
    ARRAY[repeat('b', 64), 'YR==', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1'],
    ARRAY[repeat('b', 64), E'YWJj\n', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1'],
    ARRAY[repeat('b', 64), 'YWJj', NULL, 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1'],
    ARRAY[repeat('b', 64), 'YWJj', 'AAAAAAAAAAAAAA==', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1'],
    ARRAY[repeat('b', 64), 'YWJj', '!!!!!!!!!!!!!!!!', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1'],
    ARRAY[repeat('b', 64), 'YWJj', 'AAAAAAAAAAAAAAAA', NULL, 'staging-v1'],
    ARRAY[repeat('b', 64), 'YWJj', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAB==', 'staging-v1'],
    ARRAY[repeat('b', 64), 'YWJj', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAA', 'staging-v1'],
    ARRAY[repeat('b', 64), 'YWJj', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', NULL],
    ARRAY[repeat('b', 64), 'YWJj', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'production-v1']
  ] LOOP
    BEGIN
      PERFORM public.accept_piggyvest_staging_receipt(
        invalid_case[1], invalid_case[2], invalid_case[3], invalid_case[4], invalid_case[5]);
      RAISE EXCEPTION 'Invalid envelope accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END LOOP;
  PERFORM public.accept_piggyvest_staging_receipt(
    repeat('c', 64), repeat('A', 1398104), 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1');
  BEGIN
    UPDATE public.piggyvest_staging_receipts SET ciphertext = 'ZGVm';
    RAISE EXCEPTION 'UPDATE unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.piggyvest_staging_receipts;
    RAISE EXCEPTION 'DELETE unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    TRUNCATE public.piggyvest_staging_receipts;
    RAISE EXCEPTION 'TRUNCATE unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.piggyvest_staging_receipts (payload_sha256, ciphertext, nonce, auth_tag, key_version)
      VALUES (repeat('d', 64), '!!!!', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1');
    RAISE EXCEPTION 'Direct invalid INSERT unexpectedly allowed';
  EXCEPTION WHEN check_violation OR invalid_parameter_value THEN NULL;
  END;
END
$test$;

RESET ROLE;
DO $test$
DECLARE
  denied_role text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.piggyvest_staging_receipts
    WHERE payload_sha256 = repeat('a', 64) AND ciphertext = 'YWJj'
      AND nonce = 'AAAAAAAAAAAAAAAA' AND auth_tag = 'AAAAAAAAAAAAAAAAAAAAAA=='
      AND key_version = 'staging-v1' AND status = 'quarantined' AND received_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Duplicate overwrote the encrypted envelope';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid = 'public.piggyvest_staging_receipts'::regclass
      AND attnum > 0 AND NOT attisdropped AND attname NOT IN ('id', 'payload_sha256')
      AND has_column_privilege('pvb_staging_ingest', attrelid, attname, 'SELECT')
  ) THEN
    RAISE EXCEPTION 'Ingest role can read sealed or metadata columns';
  END IF;
  FOREACH denied_role IN ARRAY ARRAY['anon', 'authenticated', 'authenticator'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', denied_role);
    BEGIN
      PERFORM public.accept_piggyvest_staging_receipt(
        repeat('e', 64), 'YWJj', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1');
      RAISE EXCEPTION 'Unauthorized RPC unexpectedly allowed for %', denied_role;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM id FROM public.piggyvest_staging_receipts;
      RAISE EXCEPTION 'Unauthorized SELECT unexpectedly allowed for %', denied_role;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      INSERT INTO public.piggyvest_staging_receipts (payload_sha256, ciphertext, nonce, auth_tag, key_version)
        VALUES (repeat('e', 64), 'YWJj', 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA==', 'staging-v1');
      RAISE EXCEPTION 'Unauthorized INSERT unexpectedly allowed for %', denied_role;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pvb_staging_ingest'
    AND (rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
    RAISE EXCEPTION 'Unsafe ingest role attributes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.piggyvest_staging_receipts'::regclass
    AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION 'Receipt RLS missing';
  END IF;
  IF NOT pg_has_role('authenticator', 'pvb_staging_ingest', 'MEMBER') THEN
    RAISE EXCEPTION 'PostgREST cannot assume ingest role';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class AS relation JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
      AND namespace.nspname !~ '^pg_toast'
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND relation.oid <> 'public.piggyvest_staging_receipts'::regclass
      AND (has_table_privilege('pvb_staging_ingest', relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege('pvb_staging_ingest', relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
  ) THEN
    RAISE EXCEPTION 'Ingest role can access another relation';
  END IF;
END
$test$;
ROLLBACK;
