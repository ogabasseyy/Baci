-- The entrypoint body squash (20261020090000) pins owner + EXECUTE grants
-- in its pre/post-image guards because pg_get_functiondef omits them while
-- CREATE OR REPLACE preserves them. Pin the same 20260828 shape here so a
-- future migration that re-grants either SECURITY DEFINER entrypoint fails
-- loudly in replay, plus the guards' fail-closed not-found semantic (which
-- chronological replay never exercises, since it only carries converged
-- state). No body hashes are pinned here: fix1/fix3 will legitimately
-- change bodies, while owner and grants must stay put.
DO $$ DECLARE
  v_checked_oid oid;
  v_unchecked_oid oid;
  v_missing_def text;
  v_raised boolean;
BEGIN
  SELECT p.oid INTO v_checked_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.proname = 'create_storefront_order'
    AND p.pronargs = 24;
  IF v_checked_oid IS NULL THEN
    RAISE EXCEPTION 'create_storefront_order(24) not found';
  END IF;

  SELECT p.oid INTO v_unchecked_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.proname = 'create_storefront_order_unchecked'
    AND p.pronargs = 24;
  IF v_unchecked_oid IS NULL THEN
    RAISE EXCEPTION 'create_storefront_order_unchecked(24) not found';
  END IF;

  IF pg_catalog.pg_get_userbyid((SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_checked_oid)) <> 'postgres' THEN
    RAISE EXCEPTION 'checked entry point owner drifted from postgres';
  END IF;
  IF pg_catalog.pg_get_userbyid((SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_unchecked_oid)) <> 'postgres' THEN
    RAISE EXCEPTION 'unchecked entry point owner drifted from postgres';
  END IF;

  IF NOT (pg_catalog.has_function_privilege('anon', v_checked_oid, 'EXECUTE')
      AND pg_catalog.has_function_privilege('authenticated', v_checked_oid, 'EXECUTE')
      AND pg_catalog.has_function_privilege('service_role', v_checked_oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'checked entry point lost its anon/authenticated/service_role EXECUTE grants';
  END IF;
  IF (SELECT proacl FROM pg_catalog.pg_proc WHERE oid = v_checked_oid) IS NULL
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode((SELECT proacl FROM pg_catalog.pg_proc WHERE oid = v_checked_oid)) AS a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
      ) THEN
    RAISE EXCEPTION 'checked entry point became executable by PUBLIC';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_unchecked_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated', v_unchecked_oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role', v_unchecked_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'unchecked entry point must stay owner-only EXECUTE';
  END IF;

  -- Not-found mode: the guard lookup pattern must raise (not silently
  -- pass) when no row matches. md5(NULL) is NULL and NULL <> const is
  -- not true, so only the explicit IS NULL branch fails closed.
  SELECT pg_catalog.pg_get_functiondef(p.oid) INTO v_missing_def
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.proname = 'create_storefront_order_no_such_function'
    AND p.pronargs = 24;
  v_raised := false;
  BEGIN
    IF v_missing_def IS NULL THEN
      RAISE EXCEPTION 'storefront_order_function_not_found';
    END IF;
    IF md5(v_missing_def) <> '00000000000000000000000000000000' THEN
      RAISE EXCEPTION 'unreachable';
    END IF;
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'storefront_order_function_not_found' THEN
        v_raised := true;
      ELSE
        RAISE;
      END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'guard not-found branch did not raise on missing function';
  END IF;
END;
$$;
