-- Include-only part of public_definer_function_exposure.sql (no BEGIN/ROLLBACK): the
-- entry point owns the transaction and loads this file with \ir.
--
-- (b) Every public SECURITY DEFINER function that anon can execute, or that
-- carries an explicit PUBLIC grant, must be on the allowlist loaded from
-- public_definer_function_exposure_allowlist.inc.sql. A new function that fails
-- here needs an explicit REVOKE ... FROM PUBLIC, anon (preferred) or an allowlist
-- row with a reason that explains why anonymous callers need it.

DO $allowlist$
DECLARE
  v_anon_unlisted text;
  v_public_unlisted text;
  v_stale text;
BEGIN
  CREATE TEMP TABLE definer_exposure_functions ON COMMIT DROP AS
  SELECT
    proc.oid AS function_oid,
    'public.' || proc.proname || '(' ||
      pg_catalog.replace(pg_catalog.oidvectortypes(proc.proargtypes), ', ', ',') || ')' AS signature,
    COALESCE(proc.proacl, pg_catalog.acldefault('f', proc.proowner)) AS effective_acl
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.prokind IN ('f', 'p')
    AND proc.prosecdef;

  SELECT pg_catalog.string_agg(fn.signature, E'\n  ' ORDER BY fn.signature)
  INTO v_anon_unlisted
  FROM definer_exposure_functions AS fn
  WHERE pg_catalog.has_function_privilege('anon', fn.function_oid, 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1 FROM definer_exposure_allowlist AS allowed
      WHERE allowed.signature = fn.signature
    );

  IF v_anon_unlisted IS NOT NULL THEN
    RAISE EXCEPTION E'public SECURITY DEFINER functions executable by anon but not on the allowlist:\n  %\nRevoke the default grants in the migration (REVOKE ALL ... FROM PUBLIC, anon) or add an allowlist row with a reason.',
      v_anon_unlisted;
  END IF;

  SELECT pg_catalog.string_agg(fn.signature, E'\n  ' ORDER BY fn.signature)
  INTO v_public_unlisted
  FROM definer_exposure_functions AS fn
  WHERE EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(fn.effective_acl) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    )
    AND NOT EXISTS (
      SELECT 1 FROM definer_exposure_allowlist AS allowed
      WHERE allowed.signature = fn.signature
    );

  IF v_public_unlisted IS NOT NULL THEN
    RAISE EXCEPTION E'public SECURITY DEFINER functions with an EXECUTE grant to PUBLIC but not on the allowlist:\n  %\nRevoke it with REVOKE ALL ... FROM PUBLIC or add an allowlist row with a reason.',
      v_public_unlisted;
  END IF;

  SELECT pg_catalog.string_agg(allowed.signature, E'\n  ' ORDER BY allowed.signature)
  INTO v_stale
  FROM definer_exposure_allowlist AS allowed
  WHERE NOT EXISTS (
    SELECT 1 FROM definer_exposure_functions AS fn
    WHERE fn.signature = allowed.signature
  );

  IF v_stale IS NOT NULL THEN
    RAISE NOTICE E'allowlist rows with no SECURITY DEFINER function in this database (production-only, dropped, or already fixed):\n  %',
      v_stale;
  END IF;
END
$allowlist$;

