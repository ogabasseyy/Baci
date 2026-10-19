\set ON_ERROR_STOP on
\if :{?expected_system_identifier}
\else
DO $missing_identifier$
BEGIN
  RAISE EXCEPTION 'Required psql variable expected_system_identifier is absent';
END
$missing_identifier$;
\endif
BEGIN;
SET LOCAL pvb_staging.expected_system_identifier = :'expected_system_identifier';

DO $guard$
BEGIN
  IF current_user <> 'supabase_admin'
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Apply staging receipt storage as superuser supabase_admin';
  END IF;
  IF current_setting('pvb_staging.expected_system_identifier') !~ '^[0-9]{1,20}$' THEN
    RAISE EXCEPTION 'Invalid expected_system_identifier';
  END IF;
  IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system())
    <> current_setting('pvb_staging.expected_system_identifier') THEN
    RAISE EXCEPTION 'Refusing database system identifier mismatch';
  END IF;
END
$guard$;

CREATE ROLE pvb_staging_ingest NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE TABLE public.piggyvest_staging_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payload_sha256 text NOT NULL UNIQUE CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  ciphertext text NOT NULL CHECK (
    octet_length(ciphertext) BETWEEN 4 AND 1398104
    AND ciphertext ~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
    AND replace(encode(decode(ciphertext, 'base64'), 'base64'), E'\n', '') = ciphertext
  ),
  nonce text NOT NULL CHECK (nonce ~ '^[A-Za-z0-9+/]{16}$'),
  auth_tag text NOT NULL CHECK (
    auth_tag ~ '^[A-Za-z0-9+/]{22}==$'
    AND encode(decode(auth_tag, 'base64'), 'base64') = auth_tag
  ),
  key_version text NOT NULL CHECK (key_version = 'staging-v1'),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL DEFAULT 'quarantined' CHECK (status = 'quarantined')
);

ALTER TABLE public.piggyvest_staging_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.piggyvest_staging_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.piggyvest_staging_receipts FROM PUBLIC, anon, authenticated, pvb_staging_ingest;
GRANT USAGE ON SCHEMA public TO pvb_staging_ingest;
GRANT SELECT (id, payload_sha256) ON public.piggyvest_staging_receipts TO pvb_staging_ingest;
GRANT INSERT (payload_sha256, ciphertext, nonce, auth_tag, key_version)
  ON public.piggyvest_staging_receipts TO pvb_staging_ingest;
CREATE POLICY pvb_staging_receipt_insert ON public.piggyvest_staging_receipts
  FOR INSERT TO pvb_staging_ingest WITH CHECK (status = 'quarantined');
CREATE POLICY pvb_staging_receipt_select ON public.piggyvest_staging_receipts
  FOR SELECT TO pvb_staging_ingest USING (true);

CREATE FUNCTION public.accept_piggyvest_staging_receipt(
  p_payload_sha256 text,
  p_ciphertext text,
  p_nonce text,
  p_auth_tag text,
  p_key_version text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  receipt_id uuid;
  is_duplicate boolean := false;
BEGIN
  PERFORM set_config('synchronous_commit', 'on', true);
  IF p_payload_sha256 IS NULL OR octet_length(p_payload_sha256) <> 64
    OR p_payload_sha256 !~ '^[0-9a-f]{64}$'
    OR p_ciphertext IS NULL OR octet_length(p_ciphertext) NOT BETWEEN 4 AND 1398104
    OR p_nonce IS NULL OR octet_length(p_nonce) <> 16
    OR p_auth_tag IS NULL OR octet_length(p_auth_tag) <> 24
    OR p_key_version IS DISTINCT FROM 'staging-v1' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid staging receipt envelope';
  END IF;
  IF p_ciphertext !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
    OR p_nonce !~ '^[A-Za-z0-9+/]{16}$'
    OR p_auth_tag !~ '^[A-Za-z0-9+/]{22}==$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid staging receipt encoding';
  END IF;
  IF replace(encode(decode(p_ciphertext, 'base64'), 'base64'), E'\n', '') <> p_ciphertext
    OR encode(decode(p_auth_tag, 'base64'), 'base64') <> p_auth_tag THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Noncanonical staging receipt encoding';
  END IF;

  INSERT INTO public.piggyvest_staging_receipts (payload_sha256, ciphertext, nonce, auth_tag, key_version)
    VALUES (p_payload_sha256, p_ciphertext, p_nonce, p_auth_tag, p_key_version)
    ON CONFLICT (payload_sha256) DO NOTHING
    RETURNING id INTO receipt_id;
  IF receipt_id IS NULL THEN
    is_duplicate := true;
    SELECT id INTO receipt_id FROM public.piggyvest_staging_receipts
      WHERE payload_sha256 = p_payload_sha256;
    IF receipt_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Retry staging receipt transaction';
    END IF;
  END IF;
  RETURN jsonb_build_object('receiptId', receipt_id, 'duplicate', is_duplicate, 'durable', true);
END
$function$;

REVOKE ALL ON FUNCTION public.accept_piggyvest_staging_receipt(text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_piggyvest_staging_receipt(text, text, text, text, text)
  TO pvb_staging_ingest;

DO $audit$
DECLARE
  unsafe_object text;
  granted_role text;
BEGIN
  FOR granted_role IN
    SELECT DISTINCT roles.rolname FROM pg_roles AS roles
    JOIN (
      SELECT privileges.grantee FROM pg_class AS relation,
        LATERAL aclexplode(relation.relacl) AS privileges
      WHERE relation.oid = 'public.piggyvest_staging_receipts'::regclass
      UNION
      SELECT privileges.grantee FROM pg_proc AS routine,
        LATERAL aclexplode(routine.proacl) AS privileges
      WHERE routine.oid = 'public.accept_piggyvest_staging_receipt(text,text,text,text,text)'::regprocedure
    ) AS grants ON grants.grantee = roles.oid
    WHERE roles.rolname NOT IN ('supabase_admin', 'pvb_staging_ingest')
  LOOP
    EXECUTE format('REVOKE ALL ON public.piggyvest_staging_receipts FROM %I', granted_role);
    EXECUTE format('REVOKE ALL ON FUNCTION public.accept_piggyvest_staging_receipt(text,text,text,text,text) FROM %I', granted_role);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator' AND rolinherit) THEN
    RAISE EXCEPTION 'authenticator must be NOINHERIT before installation';
  END IF;
  SELECT format('%I.%I', namespace.nspname, relation.relname) INTO unsafe_object
  FROM pg_class AS relation JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND namespace.nspname !~ '^pg_toast'
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    AND relation.oid <> 'public.piggyvest_staging_receipts'::regclass
    AND CASE WHEN relation.relkind = 'S' THEN
      has_sequence_privilege('pvb_staging_ingest', relation.oid, 'USAGE,SELECT,UPDATE')
    ELSE has_table_privilege('pvb_staging_ingest', relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege('pvb_staging_ingest', relation.oid, 'SELECT,INSERT,UPDATE,REFERENCES') END
  LIMIT 1;
  IF unsafe_object IS NOT NULL THEN
    RAISE EXCEPTION 'Unsafe inherited/PUBLIC relation access: %. Owner must replace PUBLIC grants with explicit application-role grants before installation', unsafe_object;
  END IF;
  SELECT format('%I.%I', namespace.nspname, routine.proname) INTO unsafe_object
  FROM pg_proc AS routine JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND routine.prosecdef AND has_function_privilege('pvb_staging_ingest', routine.oid, 'EXECUTE')
  LIMIT 1;
  IF unsafe_object IS NOT NULL THEN
    RAISE EXCEPTION 'Unsafe inherited/PUBLIC SECURITY DEFINER execution: %. Owner must restrict execution to explicit application roles before installation', unsafe_object;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_temp%'
    AND has_schema_privilege('pvb_staging_ingest', oid, 'CREATE')) THEN
    RAISE EXCEPTION 'Owner must remove PUBLIC schema CREATE grants before installation';
  END IF;
END
$audit$;

GRANT pvb_staging_ingest TO authenticator;
NOTIFY pgrst, 'reload schema';
COMMIT;
