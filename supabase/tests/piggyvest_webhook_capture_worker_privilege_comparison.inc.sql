-- Included by piggyvest_webhook_capture_worker_role.sql. Compare inherited
-- worker authority against anon one privilege at a time, across schemas.
DO $$
DECLARE
  v_offenders text;
BEGIN
  SELECT string_agg(found.what, ', ' ORDER BY found.what) INTO v_offenders
  FROM (
    SELECT 'function ' || p.oid::regprocedure::text AS what
    FROM (SELECT x.oid FROM pg_catalog.pg_proc x OFFSET 0) p
    WHERE pg_catalog.has_function_privilege('piggyvest_webhook_capture_worker', p.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.oid <> ALL (ARRAY[
        'public.claim_piggyvest_webhook_captures(integer,integer,integer)'::regprocedure::oid,
        'public.resolve_claimed_piggyvest_webhook_capture(uuid,uuid,text,text)'::regprocedure::oid,
        'public.piggyvest_webhook_capture_status()'::regprocedure::oid])
    UNION ALL
    SELECT 'relation ' || c.oid::regclass::text || ' ' || privilege.privilege
    FROM (SELECT x.oid FROM pg_catalog.pg_class x
      WHERE x.relkind IN ('r', 'p', 'v', 'm', 'f') OFFSET 0) c
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                       ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS privilege(privilege)
    WHERE pg_catalog.has_table_privilege('piggyvest_webhook_capture_worker', c.oid, privilege.privilege)
      AND NOT pg_catalog.has_table_privilege('anon', c.oid, privilege.privilege)
    UNION ALL
    SELECT 'column ' || a.attrelid::regclass::text || '.' || a.attname || ' ' || privilege.privilege
    FROM (SELECT x.attrelid, x.attnum, x.attname FROM pg_catalog.pg_attribute x
      JOIN pg_catalog.pg_class c ON c.oid = x.attrelid
      WHERE x.attnum > 0 AND NOT x.attisdropped
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f') OFFSET 0) a
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) AS privilege(privilege)
    WHERE pg_catalog.has_column_privilege(
        'piggyvest_webhook_capture_worker', a.attrelid, a.attnum, privilege.privilege)
      AND NOT pg_catalog.has_column_privilege('anon', a.attrelid, a.attnum, privilege.privilege)
    UNION ALL
    SELECT 'sequence ' || c.oid::regclass::text || ' ' || privilege.privilege
    FROM (SELECT x.oid FROM pg_catalog.pg_class x WHERE x.relkind = 'S' OFFSET 0) c
    CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS privilege(privilege)
    WHERE pg_catalog.has_sequence_privilege('piggyvest_webhook_capture_worker', c.oid,
        privilege.privilege)
      AND NOT pg_catalog.has_sequence_privilege('anon', c.oid, privilege.privilege)
  ) AS found;
  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION 'the worker can use more than anon and the drain: %', v_offenders
      USING ERRCODE = 'ZGRT5';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c,
      LATERAL pg_catalog.aclexplode(c.relacl) AS acl
    WHERE c.oid = 'public.piggyvest_webhook_captures'::regclass AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC holds a privilege on piggyvest_webhook_captures' USING ERRCODE = 'ZGRT5';
  END IF;
END
$$;
