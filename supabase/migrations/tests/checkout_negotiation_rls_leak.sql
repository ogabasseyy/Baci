-- =============================================
-- REGRESSION TEST: checkout_sessions / negotiation_requests RLS leak
--   Locks the invariants established by migration
--   20260614111825_fix_checkout_negotiation_rls_leak.sql
--
--   Proves:
--     1. No SELECT policy on public.checkout_sessions is readable by `anon`
--        (the broad "Allow public read by session_id" policy is gone).
--     2. The negotiation_requests SELECT policy is TO authenticated, has no
--        `session_id` tautology, and gates merchant/staff access through
--        has_merchant_access() (no broken self-join).
--     3. The negotiation_requests UPDATE policy is TO authenticated and also
--        gates through has_merchant_access().
--     4. Behaviour: an anonymous role cannot read a checkout session or a
--        negotiation request, while the owning merchant and the customer can
--        read their own negotiation. (Fixtures are rolled back.)
--
-- USAGE:
--   psql $DATABASE_URL -f supabase/migrations/tests/checkout_negotiation_rls_leak.sql
--   or via Supabase MCP execute_sql
--
-- The script assert-fails (RAISE EXCEPTION) on any deviation and ROLLBACKs at
-- the end, so it is safe to run against any environment including production.
-- =============================================

BEGIN;

-- --------------------------------------------------------
-- 1. Policy SHAPE assertions (deterministic, read-only).
-- --------------------------------------------------------
DO $$
DECLARE
  anon_select_policies text;
  neg_select_roles text;
  neg_select_expr  text;
  neg_update_roles text;
  neg_update_expr  text;
BEGIN
  -- 1a. checkout_sessions: the broad anon SELECT policy must be gone, and no
  --     remaining SELECT/ALL policy may apply to anon.
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.checkout_sessions'::regclass
      AND polname = 'Allow public read by session_id'
  ) THEN
    RAISE EXCEPTION
      'checkout_sessions still has the broad "Allow public read by session_id" policy';
  END IF;

  SELECT string_agg(polname, ', ')
    INTO anon_select_policies
  FROM pg_policy
  WHERE polrelid = 'public.checkout_sessions'::regclass
    AND polcmd IN ('r', '*')  -- SELECT or ALL
    AND array_to_string(polroles::regrole[]::text[], ',') LIKE '%anon%';

  IF anon_select_policies IS NOT NULL THEN
    RAISE EXCEPTION
      'checkout_sessions must not expose any SELECT policy to anon, found: %',
      anon_select_policies;
  END IF;

  -- 1b. negotiation_requests SELECT policy.
  SELECT
    array_to_string(polroles::regrole[]::text[], ','),
    pg_get_expr(polqual, polrelid)
    INTO neg_select_roles, neg_select_expr
  FROM pg_policy
  WHERE polrelid = 'public.negotiation_requests'::regclass
    AND polname  = 'Users can view negotiation requests';

  IF neg_select_roles IS NULL THEN
    RAISE EXCEPTION
      'negotiation_requests SELECT policy "Users can view negotiation requests" missing';
  END IF;
  IF neg_select_roles LIKE '%anon%' THEN
    RAISE EXCEPTION
      'negotiation_requests SELECT policy must not apply to anon, found roles: %',
      neg_select_roles;
  END IF;
  IF neg_select_roles NOT LIKE '%authenticated%' THEN
    RAISE EXCEPTION
      'negotiation_requests SELECT policy must apply to authenticated, found roles: %',
      neg_select_roles;
  END IF;
  IF neg_select_expr LIKE '%session_id%' THEN
    RAISE EXCEPTION
      'negotiation_requests SELECT policy must not reference session_id (tautology leak), found: %',
      neg_select_expr;
  END IF;
  IF neg_select_expr NOT LIKE '%has_merchant_access%' THEN
    RAISE EXCEPTION
      'negotiation_requests SELECT policy must gate merchant access via has_merchant_access(), found: %',
      neg_select_expr;
  END IF;

  -- 1c. negotiation_requests UPDATE policy.
  SELECT
    array_to_string(polroles::regrole[]::text[], ','),
    pg_get_expr(polqual, polrelid)
    INTO neg_update_roles, neg_update_expr
  FROM pg_policy
  WHERE polrelid = 'public.negotiation_requests'::regclass
    AND polname  = 'Merchants can update their own negotiation requests';

  IF neg_update_roles IS NULL THEN
    RAISE EXCEPTION
      'negotiation_requests UPDATE policy missing';
  END IF;
  IF neg_update_roles NOT LIKE '%authenticated%' OR neg_update_roles LIKE '%anon%' THEN
    RAISE EXCEPTION
      'negotiation_requests UPDATE policy must apply to authenticated only, found roles: %',
      neg_update_roles;
  END IF;
  IF neg_update_expr NOT LIKE '%has_merchant_access%' THEN
    RAISE EXCEPTION
      'negotiation_requests UPDATE policy must gate via has_merchant_access(), found: %',
      neg_update_expr;
  END IF;

  RAISE NOTICE 'OK: policy shapes locked (checkout_sessions anon SELECT closed; negotiation_requests SELECT/UPDATE scoped to authenticated via has_merchant_access)';
END;
$$ LANGUAGE plpgsql;

-- --------------------------------------------------------
-- 2. BEHAVIOUR assertions with rolled-back fixtures.
-- --------------------------------------------------------
DO $$
DECLARE
  v_merchant_id uuid := '8f0ed783-0000-4000-8000-0000000009a1';
  v_owner_id    uuid := '8f0ed783-0000-4000-8000-0000000009a2';
  v_customer_id uuid := '8f0ed783-0000-4000-8000-0000000009a3';
  v_outsider_id uuid := '8f0ed783-0000-4000-8000-0000000009a4';
  v_session     text := 'rls-leak-test-session-9a1';
  n int;
BEGIN
  -- Seed as service_role (RLS-bypassing).
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES (v_merchant_id, v_owner_id, 'rls-leak-test@example.com',
          'RLS Leak Test Store', 'rls-leak-test-store');

  INSERT INTO public.checkout_sessions
    (session_id, merchant_id, customer_email, customer_phone, virtual_account_number)
  VALUES (v_session, v_merchant_id, 'victim@example.com', '08000000000', '1234567890');

  INSERT INTO public.negotiation_requests
    (merchant_id, customer_id, customer_email, session_id, type, offered_price)
  VALUES (
    v_merchant_id,
    v_customer_id,
    'rls-customer@example.com',
    v_session,
    'single',
    1000
  );

  RESET ROLE;

  -- 2a. anon must see NEITHER table's rows (leak closed).
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  -- A throwaway sub (never matches any row) avoids an empty-string ::uuid cast
  -- in case auth.uid() is evaluated; anon has no applicable policy regardless.
  PERFORM set_config('request.jwt.claim.sub', v_outsider_id::text, true);

  SELECT count(*) INTO n FROM public.checkout_sessions WHERE session_id = v_session;
  IF n <> 0 THEN
    RAISE EXCEPTION 'LEAK: anon can read % checkout_sessions row(s)', n;
  END IF;

  SELECT count(*) INTO n FROM public.negotiation_requests WHERE session_id = v_session;
  IF n <> 0 THEN
    RAISE EXCEPTION 'LEAK: anon can read % negotiation_requests row(s)', n;
  END IF;
  RESET ROLE;

  -- 2b. the owning customer can read their own negotiation.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_customer_id::text, true);
  SELECT count(*) INTO n FROM public.negotiation_requests WHERE session_id = v_session;
  IF n <> 1 THEN
    RAISE EXCEPTION 'customer should read own negotiation, saw % row(s)', n;
  END IF;
  RESET ROLE;

  -- 2c. the owning merchant can read the negotiation (has_merchant_access).
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, true);
  SELECT count(*) INTO n FROM public.negotiation_requests WHERE session_id = v_session;
  IF n <> 1 THEN
    RAISE EXCEPTION 'owning merchant should read negotiation, saw % row(s)', n;
  END IF;
  RESET ROLE;

  -- 2d. an unrelated authenticated user must see nothing.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_outsider_id::text, true);
  SELECT count(*) INTO n FROM public.negotiation_requests WHERE session_id = v_session;
  IF n <> 0 THEN
    RAISE EXCEPTION 'unrelated user must not read negotiation, saw % row(s)', n;
  END IF;
  RESET ROLE;

  RAISE NOTICE 'OK: anon blocked on both tables; customer + owning merchant read negotiation; outsider blocked';
END;
$$ LANGUAGE plpgsql;

ROLLBACK;
