-- The original production connector migration applied this role shape.
-- Keep this post-apply assertion additive instead of editing that migration.
DO $$
DECLARE
  v_role record;
BEGIN
  SELECT
    rolcanlogin,
    rolsuper,
    rolbypassrls,
    rolcreatedb,
    rolcreaterole,
    rolreplication
  INTO v_role
  FROM pg_catalog.pg_roles
  WHERE rolname = 'connector_gateway';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'connector_gateway role is missing';
  END IF;

  IF v_role.rolsuper
    OR v_role.rolbypassrls
    OR v_role.rolcreatedb
    OR v_role.rolcreaterole
    OR v_role.rolreplication
  THEN
    RAISE EXCEPTION 'connector_gateway has elevated role attributes';
  END IF;
END;
$$;
