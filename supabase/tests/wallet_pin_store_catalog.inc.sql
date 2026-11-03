-- Include-only part of wallet_pin_store.sql (no BEGIN/ROLLBACK).
--
-- Catalog checks only: the private schema and its tables are unreadable by
-- every client and API role, every wallet_pin_private function (including
-- the proof consumer) has no EXECUTE grant beyond its owner, and the
-- customer RPCs are executable by authenticated alone.

DO $catalog$
DECLARE
  v_role text;
  v_table record;
  v_function record;
  v_expected_tables text[] := ARRAY[
    'attestation_keys', 'customer_pins', 'merchant_authorities', 'proof_purposes', 'proofs'
  ];
  v_public_rpcs text[] := ARRAY[
    'public.get_wallet_pin_state(uuid,text)',
    'public.set_wallet_pin(uuid,text,integer,text,text,text)',
    'public.change_wallet_pin(uuid,text,text,integer,text,text,text)',
    'public.reset_wallet_pin(uuid,text,integer,text,text,text)',
    'public.verify_wallet_pin(uuid,text,text,text,bigint,text,text)'
  ];
  v_signature text;
  v_oid regprocedure;
  v_grantees text[];
BEGIN
  PERFORM pg_temp.wp_assert(
    (SELECT pg_catalog.array_agg(c.relname::text ORDER BY c.relname)
       FROM pg_catalog.pg_class AS c
       JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'wallet_pin_private' AND c.relkind IN ('r', 'p'))
      = v_expected_tables,
    'wallet_pin_private holds exactly the five PIN tables'
  );

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    PERFORM pg_temp.wp_assert(
      NOT pg_catalog.has_schema_privilege(v_role, 'wallet_pin_private', 'USAGE,CREATE'),
      pg_catalog.format('%s must not use schema wallet_pin_private', v_role)
    );

    FOR v_table IN
      SELECT c.oid, c.relname
        FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'wallet_pin_private'
         AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    LOOP
      PERFORM pg_temp.wp_assert(
        NOT pg_catalog.has_table_privilege(
          v_role, v_table.oid,
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        ),
        pg_catalog.format('%s must not touch wallet_pin_private.%s', v_role, v_table.relname)
      );
    END LOOP;
  END LOOP;

  -- No grant to PUBLIC (grantee 0) or any role other than the owner, on the
  -- schema or on any relation in it.
  PERFORM pg_temp.wp_assert(
    NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_namespace AS n,
             pg_catalog.aclexplode(COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) AS acl
       WHERE n.nspname = 'wallet_pin_private' AND acl.grantee <> n.nspowner
    ),
    'wallet_pin_private schema ACL has only its owner'
  );
  PERFORM pg_temp.wp_assert(
    NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace,
             pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) AS acl
       WHERE n.nspname = 'wallet_pin_private' AND acl.grantee <> c.relowner
    ),
    'wallet_pin_private relations have no grant beyond their owner'
  );

  -- RLS on every table, with a restrictive deny-all policy as a second wall.
  FOR v_table IN
    SELECT c.oid, c.relname, c.relrowsecurity
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'wallet_pin_private' AND c.relkind = 'r'
  LOOP
    PERFORM pg_temp.wp_assert(v_table.relrowsecurity,
      pg_catalog.format('RLS enabled on %s', v_table.relname));
    PERFORM pg_temp.wp_assert(
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_policy AS p
         WHERE p.polrelid = v_table.oid AND NOT p.polpermissive
           AND p.polcmd = '*' AND p.polroles = ARRAY[0::oid]
           AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) = 'false'
           AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) = 'false'
      ),
      pg_catalog.format('restrictive deny-all policy on %s', v_table.relname)
    );
  END LOOP;

  -- Every function in the private schema: owner-only EXECUTE, pinned
  -- search_path. The proof consumer must exist and be a definer function,
  -- callable only definer-to-definer.
  PERFORM pg_temp.wp_assert(
    pg_catalog.to_regprocedure(
      'wallet_pin_private.consume_wallet_pin_proof(uuid,uuid,text,bigint,text,text)'
    ) IS NOT NULL,
    'consume_wallet_pin_proof exists'
  );
  FOR v_function IN
    SELECT p.oid::regprocedure AS signature, p.proowner, p.proacl,
           p.prosecdef, p.proconfig, p.proname
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'wallet_pin_private'
  LOOP
    PERFORM pg_temp.wp_assert(
      NOT EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(
          COALESCE(v_function.proacl, pg_catalog.acldefault('f', v_function.proowner))
        ) AS acl
        WHERE acl.privilege_type = 'EXECUTE' AND acl.grantee <> v_function.proowner
      ),
      pg_catalog.format('%s must be ungranted', v_function.signature)
    );
    PERFORM pg_temp.wp_assert(
      v_function.proconfig @> ARRAY['search_path=""'],
      pg_catalog.format('%s pins an empty search_path', v_function.signature)
    );
    IF v_function.proname = 'consume_wallet_pin_proof' THEN
      PERFORM pg_temp.wp_assert(v_function.prosecdef,
        'consume_wallet_pin_proof is SECURITY DEFINER');
    END IF;
  END LOOP;

  -- Customer RPCs: SECURITY DEFINER, pinned search_path, EXECUTE for
  -- authenticated only (not PUBLIC, anon or service_role).
  FOREACH v_signature IN ARRAY v_public_rpcs LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    PERFORM pg_temp.wp_assert(v_oid IS NOT NULL,
      pg_catalog.format('%s exists', v_signature));
    SELECT pg_catalog.array_agg(
             CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
               ELSE pg_catalog.pg_get_userbyid(acl.grantee)::text END
             ORDER BY 1)
      INTO v_grantees
      FROM pg_catalog.pg_proc AS p,
           pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
     WHERE p.oid = v_oid AND acl.privilege_type = 'EXECUTE'
       AND acl.grantee <> p.proowner;
    PERFORM pg_temp.wp_assert(v_grantees = ARRAY['authenticated'],
      pg_catalog.format('%s EXECUTE grantees %s', v_signature, v_grantees));
    PERFORM pg_temp.wp_assert(
      (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
         FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid),
      pg_catalog.format('%s is a definer with an empty search_path', v_signature)
    );
    PERFORM pg_temp.wp_assert(
      NOT pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
        AND pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE'),
      pg_catalog.format('%s effective EXECUTE is authenticated only', v_signature)
    );
  END LOOP;

  -- The purpose domain: the three spend surfaces plus the goal funding,
  -- cancel and complete purposes added by 20261103044600.
  PERFORM pg_temp.wp_assert(
    (SELECT pg_catalog.array_agg(purpose ORDER BY purpose)
       FROM wallet_pin_private.proof_purposes)
      = ARRAY['checkout', 'goal_cancel', 'goal_complete', 'goal_fund', 'imei', 'vtu'],
    'proof purposes are checkout, goal_cancel, goal_complete, goal_fund, imei and vtu'
  );

  -- A PIN row records the account that set it, as a foreign key with an
  -- index; there is no column for the raw derived hash.
  PERFORM pg_temp.wp_assert(
    (SELECT pg_catalog.array_agg(attname::text ORDER BY attnum)
       FROM pg_catalog.pg_attribute
      WHERE attrelid = 'wallet_pin_private.customer_pins'::regclass
        AND attnum > 0 AND NOT attisdropped)
      = ARRAY['customer_id', 'user_id', 'merchant_id', 'kdf_version', 'pepper_id',
              'salt', 'pin_hash', 'failed_attempts', 'lockout_count', 'locked_at',
              'locked_until', 'created_at', 'updated_at', 'last_reset_at'],
    'customer_pins columns'
  );
  PERFORM pg_temp.wp_assert(
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS con
       WHERE con.conrelid = 'wallet_pin_private.customer_pins'::regclass
         AND con.contype = 'f' AND con.confrelid = 'auth.users'::regclass
         AND con.confdeltype = 'c'
    ) AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_index AS idx
       WHERE idx.indrelid = 'wallet_pin_private.customer_pins'::regclass
         AND idx.indkey[0] = (SELECT attnum FROM pg_catalog.pg_attribute
                               WHERE attrelid = 'wallet_pin_private.customer_pins'::regclass
                                 AND attname = 'user_id')
    ),
    'customer_pins.user_id references auth.users and is indexed'
  );

  -- The raw proof token is never stored; only its SHA-256.
  PERFORM pg_temp.wp_assert(
    (SELECT pg_catalog.array_agg(attname::text ORDER BY attnum)
       FROM pg_catalog.pg_attribute
      WHERE attrelid = 'wallet_pin_private.proofs'::regclass
        AND attnum > 0 AND NOT attisdropped)
      = ARRAY['id', 'token_sha256', 'customer_id', 'merchant_id', 'purpose',
              'amount_kobo', 'idempotency_key_sha256', 'issued_at',
              'expires_at', 'consumed_at'],
    'proofs columns'
  );
END;
$catalog$;
