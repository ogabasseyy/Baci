\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baci_storage_initializer'
    AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'Initializer was not locked down';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = 'baci_storage_initializer'::regrole) THEN
    RAISE EXCEPTION 'Unexpected initializer role memberships';
  END IF;
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL OR to_regclass('storage.migrations') IS NULL THEN
    RAISE EXCEPTION 'Official Storage schema missing';
  END IF;
  IF (SELECT count(*) FROM pg_class WHERE oid IN ('storage.buckets'::regclass, 'storage.objects'::regclass)
    AND relrowsecurity AND relowner = 'baci_storage_initializer'::regrole) <> 2 THEN
    RAISE EXCEPTION 'Storage ownership or RLS mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets) OR EXISTS (SELECT 1 FROM storage.objects) THEN
    RAISE EXCEPTION 'Unexpected Storage data';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.migrations WHERE name = 'validate-bucket-lifecycle-constraints') THEN
    RAISE EXCEPTION 'Pinned final migration missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin' AND rolcanlogin) THEN
    RAISE EXCEPTION 'Existing Storage role guard changed';
  END IF;
END
$verify$;
COMMIT;
