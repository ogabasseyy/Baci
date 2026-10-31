-- Regression test: card top-up into the PiggyVest primary wallet is
-- retired, so no role except a superuser may execute the card
-- initialization functions (reserve, claim_initialization,
-- record_initialization), in any overload. The status and abandonment
-- drain keep exactly the grants they need, so operations created before
-- retirement still resolve.
--
-- Privileges are asserted through the catalog (has_function_privilege and
-- the function ACL), never by calling a function and catching the denial.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/primary_card_initialization_retired_privileges.sql

BEGIN;

DO $$
DECLARE
  v_name text;
  v_function record;
  v_role record;
  v_found integer;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'reserve',
    'claim_initialization',
    'record_initialization'
  ]
  LOOP
    v_found := 0;
    FOR v_function IN
      SELECT
        p.oid,
        p.oid::pg_catalog.regprocedure::text AS signature,
        p.proacl,
        p.proowner
      FROM pg_catalog.pg_proc p
      WHERE p.pronamespace = 'piggyvest_primary_card'::pg_catalog.regnamespace
        AND p.proname = v_name
    LOOP
      v_found := v_found + 1;

      IF EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(
            v_function.proacl,
            pg_catalog.acldefault('f', v_function.proowner)
          )
        ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      ) THEN
        RAISE EXCEPTION 'PUBLIC must not execute %', v_function.signature;
      END IF;

      FOR v_role IN
        SELECT r.oid, r.rolname
        FROM pg_catalog.pg_roles r
        WHERE NOT r.rolsuper
      LOOP
        IF pg_catalog.has_function_privilege(
          v_role.oid,
          v_function.oid,
          'EXECUTE'
        ) THEN
          RAISE EXCEPTION '% must not execute %',
            v_role.rolname, v_function.signature;
        END IF;
      END LOOP;
    END LOOP;

    IF v_found = 0 THEN
      RAISE EXCEPTION 'piggyvest_primary_card.% is missing', v_name;
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  v_grant text[];
  v_function regprocedure;
BEGIN
  FOREACH v_grant SLICE 1 IN ARRAY ARRAY[
    ARRAY[
      'primary_card_authorizer',
      'piggyvest_primary_card.read_operation(jsonb,uuid)'
    ],
    ARRAY[
      'primary_card_evidence',
      'piggyvest_primary_card.record_collection(jsonb,uuid,jsonb)'
    ],
    ARRAY[
      'primary_card_evidence',
      'piggyvest_primary_card.record_abandonment(jsonb,uuid)'
    ],
    ARRAY[
      'primary_card_evidence',
      'piggyvest_primary_card.flag_reconciliation(jsonb,uuid)'
    ],
    ARRAY[
      'primary_card_evidence',
      'piggyvest_primary_card.select_stale_ready_checkouts(jsonb,timestamptz,integer)'
    ]
  ]
  LOOP
    v_function := pg_catalog.to_regprocedure(v_grant[2]);

    IF v_function IS NULL THEN
      RAISE EXCEPTION '% is missing', v_grant[2];
    END IF;

    IF NOT pg_catalog.has_function_privilege(
      v_grant[1],
      v_function,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION '% must still execute %', v_grant[1], v_grant[2];
    END IF;
  END LOOP;
END
$$;

ROLLBACK;
