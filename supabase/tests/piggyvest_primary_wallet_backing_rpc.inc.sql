-- Part of piggyvest_primary_wallet_backing.sql (\ir): the customer-scoped read,
-- called the way PostgREST calls it (SET ROLE authenticated + JWT claims).
-- Runs inside the entry file's transaction; not a standalone suite. The
-- checks use plain IF/RAISE: temp helper functions are not executable by the
-- API roles.

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

-- Customer 1 (backed), 7 (migrating), 8 and 4 (legacy) on merchant 1.
DO $$
DECLARE
  v_m1 uuid := 'b5c00000-0000-4000-8000-000000000001';
  v_m2 uuid := 'b5c00000-0000-4000-8000-000000000002';
  v_case record;
BEGIN
  FOR v_case IN SELECT * FROM (VALUES
    ('b5c00000-0000-4000-8000-000000000101', v_m1, 'backed'),
    ('b5c00000-0000-4000-8000-000000000101', v_m2, 'none'),
    ('b5c00000-0000-4000-8000-000000000107', v_m1, 'migrating'),
    ('b5c00000-0000-4000-8000-000000000108', v_m1, 'legacy'),
    ('b5c00000-0000-4000-8000-000000000104', v_m1, 'legacy'),
    ('b5c00000-0000-4000-8000-000000000106', v_m1, 'none'),
    ('b5c00000-0000-4000-8000-000000000106', v_m2, 'legacy'),
    ('b5c00000-0000-4000-8000-000000000199', v_m1, 'none')
  ) AS t(user_id, merchant_id, expected) LOOP
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_case.user_id, true);
    IF public.get_my_wallet_backing_state(v_case.merchant_id) IS DISTINCT FROM v_case.expected THEN
      RAISE EXCEPTION 'user % on merchant % must read %, got %', v_case.user_id,
        v_case.merchant_id, v_case.expected, public.get_my_wallet_backing_state(v_case.merchant_id);
    END IF;
  END LOOP;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '', true);
  IF public.get_my_wallet_backing_state(v_m1) IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION 'a caller with no user id must read none';
  END IF;
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', 'b5c00000-0000-4000-8000-000000000101', true);
  IF public.get_my_wallet_backing_state(NULL) IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION 'a missing merchant must read none';
  END IF;
END $$;

RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
