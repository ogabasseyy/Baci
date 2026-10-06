BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = pg_catalog;
DO $pin$
BEGIN
  IF current_database() <> 'postgres' OR session_user <> 'supabase_admin'
    OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system()) <> '7686901100561231906' THEN
    RAISE EXCEPTION 'staging receipt database identity differs' USING ERRCODE = '42501';
  END IF;
END
$pin$;
SELECT jsonb_build_object(
  'systemIdentifier', (SELECT system_identifier::text FROM pg_control_system()),
  'readOnly', current_setting('transaction_read_only') = 'on',
  'signatureTable', (SELECT jsonb_build_object('present', relation.oid IS NOT NULL,
    'owner', pg_get_userbyid(relation.relowner), 'rowSecurity', relation.relrowsecurity,
    'forceRowSecurity', relation.relforcerowsecurity,
    'rowCount', CASE WHEN relation.oid IS NULL THEN NULL
      ELSE (SELECT count(*) FROM public.piggyvest_staging_receipt_signatures) END)
    FROM (VALUES ('public.piggyvest_staging_receipt_signatures')) expected(name)
    LEFT JOIN pg_class relation ON relation.oid=to_regclass(expected.name)),
  'functions', (SELECT jsonb_agg(jsonb_build_object(
    'signature', expected.signature, 'present', routine.oid IS NOT NULL,
    'oid', routine.oid::text,
    'owner', pg_get_userbyid(routine.proowner), 'securityDefiner', routine.prosecdef,
    'language', language.lanname,
    'acl', routine.proacl::text,
    'configuration', routine.proconfig,
    'bodyMd5', md5(routine.prosrc),
    'definitionSha256', encode(sha256(convert_to(pg_get_functiondef(routine.oid), 'UTF8')), 'hex'))
    ORDER BY expected.position)
    FROM (VALUES
      (1, 'public.accept_signed_piggyvest_staging_receipt(text,text,text,text,text,text)'),
      (2, 'public.read_piggyvest_staging_receipt_signature(uuid,text,uuid)')
    ) expected(position, signature)
    LEFT JOIN pg_proc routine ON routine.oid=to_regprocedure(expected.signature)
    LEFT JOIN pg_language language ON language.oid=routine.prolang)
);
ROLLBACK;
