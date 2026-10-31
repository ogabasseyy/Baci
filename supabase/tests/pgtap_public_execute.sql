-- Included by the pgTAP suites right after CREATE EXTENSION pgtap.
--
-- Functions created by the migration owner are no longer executable by
-- PUBLIC, anon or authenticated by default (20261030233000), and the
-- extension is installed inside the suite, so its own functions would be
-- unusable once the suite switches to an API role. Grant them to PUBLIC
-- here; the suites run in a transaction that rolls back.
DO $pgtap_public_execute$
DECLARE
  v_routine pg_catalog.regprocedure;
BEGIN
  FOR v_routine IN
    SELECT dependency.objid::pg_catalog.regprocedure
    FROM pg_catalog.pg_depend AS dependency
    JOIN pg_catalog.pg_extension AS extension
      ON extension.oid = dependency.refobjid
    WHERE dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
      AND dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
      AND dependency.deptype = 'e'
      AND extension.extname = 'pgtap'
    ORDER BY dependency.objid
  LOOP
    EXECUTE pg_catalog.format('GRANT EXECUTE ON ROUTINE %s TO PUBLIC', v_routine);
  END LOOP;
END
$pgtap_public_execute$;
