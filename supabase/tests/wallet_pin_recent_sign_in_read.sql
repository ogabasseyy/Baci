-- REGRESSION TEST: has_recent_wallet_pin_sign_in() returns exactly what the
-- set/reset sign-in-age check decides (migration
-- *_wallet_pin_recent_sign_in_read), so the app can ask a customer with an
-- old sign-in to confirm it's them before typing a PIN.
-- Reuses the wallet_pin_store fixture; runs in one rolled-back transaction.

BEGIN;

SET LOCAL search_path = pg_catalog, public, extensions;

\ir wallet_pin_store_fixture.inc.sql
\ir wallet_pin_store_calls.inc.sql

DO $fresh$
DECLARE
  v_sql constant text :=
    'SELECT pg_catalog.to_jsonb(public.has_recent_wallet_pin_sign_in())';
  v_oid oid := pg_catalog.to_regprocedure('public.has_recent_wallet_pin_sign_in()');
  v_result jsonb;
BEGIN
  -- Catalog: definer, pinned search_path, EXECUTE for authenticated only.
  PERFORM pg_temp.wp_assert(v_oid IS NOT NULL, 'read exists');
  PERFORM pg_temp.wp_assert(
    (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
       FROM pg_catalog.pg_proc AS p WHERE p.oid = v_oid),
    'read is SECURITY DEFINER with an empty search_path');
  PERFORM pg_temp.wp_assert(
    pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE'),
    'only authenticated may call the read');
  PERFORM pg_temp.wp_assert(
    NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p,
        pg_catalog.aclexplode(p.proacl) AS acl
       WHERE p.oid = v_oid AND acl.grantee = 0
    ),
    'PUBLIC has no EXECUTE on the read');

  -- Old sign-in (the fixture's default is one hour ago): needs a fresh one.
  v_result := pg_temp.wp_rpc('U1', v_sql);
  PERFORM pg_temp.wp_assert(v_result = 'false'::jsonb,
    'an hour-old sign-in is not recent: ' || v_result::text);

  -- A code sign-in a minute ago (what the in-app confirm step produces).
  v_result := pg_temp.wp_rpc('U1', v_sql, pg_temp.wp_fresh_amr('otp'));
  PERFORM pg_temp.wp_assert(v_result = 'true'::jsonb,
    'a fresh otp sign-in is recent: ' || v_result::text);

  -- Same 15-minute edge as set/reset: 16 minutes is too old.
  v_result := pg_temp.wp_rpc('U1', v_sql, pg_catalog.jsonb_build_object(
    'amr', pg_catalog.jsonb_build_array(pg_temp.wp_amr_entry('otp', 16 * 60))));
  PERFORM pg_temp.wp_assert(v_result = 'false'::jsonb,
    '16 minutes is not recent: ' || v_result::text);

  -- A token refresh never counts, however new.
  v_result := pg_temp.wp_rpc('U1', v_sql, pg_temp.wp_fresh_amr('token_refresh'));
  PERFORM pg_temp.wp_assert(v_result = 'false'::jsonb,
    'a token refresh is not a sign-in: ' || v_result::text);

  -- A user with a verified MFA factor still needs AAL2, as for set/reset.
  v_result := pg_temp.wp_rpc('U3', v_sql, pg_temp.wp_fresh_amr('otp'));
  PERFORM pg_temp.wp_assert(v_result = 'false'::jsonb,
    'verified MFA without aal2 is not recent: ' || v_result::text);

  -- The answer agrees with what set_wallet_pin then does: refused when the
  -- read says false, accepted when it says true.
  v_result := pg_temp.wp_rpc('U1', pg_temp.wp_set_sql('M1', 'pin_2580'));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"reauthentication_required"}',
    'set agrees with a false read: ' || v_result::text);
  v_result := pg_temp.wp_rpc('U1', pg_temp.wp_set_sql('M1', 'pin_2580'),
    pg_temp.wp_fresh_amr('otp'));
  PERFORM pg_temp.wp_assert(v_result = '{"status":"set"}',
    'set agrees with a true read: ' || v_result::text);
END
$fresh$;

ROLLBACK;
