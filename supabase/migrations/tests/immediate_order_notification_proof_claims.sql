-- =============================================
-- REGRESSION TEST: proof-bound immediate notification claims
--
-- POST /api/orders is user-facing and must never use the admin client
-- (AGENTS.md), so it drives delivery through proof-bound claim/complete
-- RPCs on the request-scoped client: each call verifies the order's
-- creation tracking token inside the SECURITY DEFINER body. A missing
-- or mismatched token denies uniformly (no existence oracle) and
-- changes no state; the service-role-only base RPCs are untouched.
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/immediate_order_notification_proof_claims.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := '9f000000-0000-4000-8000-000000000231';
  v_order_id uuid := '9f000000-0000-4000-8000-000000000232';
  v_claimed boolean;
  v_status text;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (
    v_merchant_id,
    'immediate-proof-claim-regression@example.com',
    'Immediate Proof Claim Regression',
    'immediate-proof-claim-regression'
  );
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, customer_email, tracking_token
  )
  VALUES (
    v_order_id,
    v_merchant_id,
    'IMMEDIATE-PROOF-001',
    1000,
    'proof@example.com',
    'proof-token-001'
  );

  -- Correct proof wins and moves pending -> processing.
  SELECT claimed, claim_status INTO v_claimed, v_status
  FROM public.claim_immediate_order_notification_with_proof(
    v_order_id, 'proof-token-001'
  );
  ASSERT v_claimed = true, 'proof claim must win';
  ASSERT v_status = 'processing', 'winner must observe processing';

  -- Wrong proof denies uniformly without revealing claim state.
  SELECT claimed, claim_status INTO v_claimed, v_status
  FROM public.claim_immediate_order_notification_with_proof(
    v_order_id, 'wrong-token'
  );
  ASSERT v_claimed = false, 'wrong proof must lose';
  ASSERT v_status = 'unknown', 'wrong proof must not reveal status';

  -- Wrong-proof completion is a no-op: the processing claim survives.
  PERFORM public.complete_immediate_order_notification_with_proof(
    v_order_id, 'wrong-token', true
  );
  SELECT claimed, claim_status INTO v_claimed, v_status
  FROM public.claim_immediate_order_notification(v_order_id);
  ASSERT v_claimed = false, 'fresh processing claim must still block';
  ASSERT v_status = 'processing', 'wrong-proof complete must not advance state';

  -- Correct-proof completion marks sent (terminal, replays skip).
  PERFORM public.complete_immediate_order_notification_with_proof(
    v_order_id, 'proof-token-001', true
  );
  SELECT claimed, claim_status INTO v_claimed, v_status
  FROM public.claim_immediate_order_notification_with_proof(
    v_order_id, 'proof-token-001'
  );
  ASSERT v_claimed = false, 'sent claim must never be reclaimable';
  ASSERT v_status = 'sent', 'replay must observe sent';

  -- The proof RPCs are invocable on request-scoped clients: anon and
  -- authenticated hold EXECUTE (the token is the authorization), while
  -- the base claim/complete RPCs stay service-role-only (covered by
  -- immediate_order_notification_claims.sql).
  IF NOT pg_catalog.has_function_privilege(
    'anon',
    'public.claim_immediate_order_notification_with_proof(uuid,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must execute claim_immediate_order_notification_with_proof(uuid,text)';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.claim_immediate_order_notification_with_proof(uuid,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must execute claim_immediate_order_notification_with_proof(uuid,text)';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'anon',
    'public.complete_immediate_order_notification_with_proof(uuid,text,boolean)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must execute complete_immediate_order_notification_with_proof(uuid,text,boolean)';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.complete_immediate_order_notification_with_proof(uuid,text,boolean)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must execute complete_immediate_order_notification_with_proof(uuid,text,boolean)';
  END IF;
END;
$$;

ROLLBACK;
