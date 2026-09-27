-- =============================================
-- REGRESSION TEST: immediate order notification claims
--   POST /api/orders sends the invoice / Pay on Delivery / Pay for Me
--   payment document in a fire-and-forget after() callback. An idempotent
--   retry must resume delivery when the first attempt never finished it:
--   claim_immediate_order_notification() hands ownership to exactly one
--   caller, losers skip while delivery is fresh, and failed or
--   crashed-mid-send (stale processing) claims are reclaimable.
--   complete_immediate_order_notification() marks sent (terminal, replays
--   skip) or failed (releasable).
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/immediate_order_notification_claims.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := '9f000000-0000-4000-8000-000000000201';
  v_order_id uuid := '9f000000-0000-4000-8000-000000000202';
  v_claimed boolean;
  v_status text;
  v_token uuid;
  v_stale_token uuid := '9f000000-0000-4000-8000-000000000299';
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (
    v_merchant_id,
    'immediate-claim-regression@example.com',
    'Immediate Claim Regression',
    'immediate-claim-regression'
  );
  INSERT INTO public.orders (id, merchant_id, order_number, total)
  VALUES (v_order_id, v_merchant_id, 'IMMEDIATE-CLAIM-001', 1000);

  -- First claim wins and moves pending -> processing, minting a lease
  -- token the winner must present at completion.
  SELECT claimed, claim_status, claim_token
  INTO v_claimed, v_status, v_token
  FROM public.claim_immediate_order_notification(v_order_id);
  ASSERT v_claimed = true, 'first claim must win';
  ASSERT v_status = 'processing', 'winner must observe processing';
  ASSERT v_token IS NOT NULL, 'winner must receive a lease token';

  -- A concurrent duplicate (fresh processing lock) must NOT win: the
  -- loser skips instead of double-sending.
  SELECT claimed, claim_status INTO v_claimed, v_status
  FROM public.claim_immediate_order_notification(v_order_id);
  ASSERT v_claimed = false, 'concurrent claim must lose';
  ASSERT v_status = 'processing', 'loser must observe processing';

  -- Completion without the lease is a no-op: the row stays processing
  -- under the winner's token.
  PERFORM public.complete_immediate_order_notification(
    v_order_id, false, v_stale_token
  );
  SELECT claimed, claim_status INTO v_claimed, v_status
  FROM public.claim_immediate_order_notification(v_order_id);
  ASSERT v_claimed = false, 'wrong-token completion must not release';
  ASSERT v_status = 'processing', 'wrong-token completion must not move state';

  -- Failed delivery releases the claim for the next replay.
  PERFORM public.complete_immediate_order_notification(
    v_order_id, false, v_token
  );
  SELECT claimed, claim_status, claim_token
  INTO v_claimed, v_status, v_token
  FROM public.claim_immediate_order_notification(v_order_id);
  ASSERT v_claimed = true, 'failed claim must be reclaimable';
  ASSERT v_status = 'processing', 'reclaim must observe processing';

  -- A crash mid-send leaves a processing lock: fresh locks still block,
  -- but a stale lock (older than the 5-minute crash window) is
  -- reclaimable so a later replay resumes instead of losing the email.
  -- The replacement mints a NEW token; the original worker's token is
  -- dead even though the row is still processing.
  UPDATE public.immediate_order_notification_claims
  SET locked_at = now() - interval '6 minutes'
  WHERE order_id = v_order_id;
  v_stale_token := v_token;
  SELECT claimed, claim_token INTO v_claimed, v_token
  FROM public.claim_immediate_order_notification(v_order_id);
  ASSERT v_claimed = true, 'stale processing claim must be reclaimable';
  ASSERT v_token IS DISTINCT FROM v_stale_token, 'reclaim must mint a new token';
  PERFORM public.complete_immediate_order_notification(
    v_order_id, false, v_stale_token
  );
  SELECT claimed, claim_status INTO v_claimed, v_status
  FROM public.claim_immediate_order_notification(v_order_id);
  ASSERT v_claimed = false, 'stale worker must not complete the replacement';
  ASSERT v_status = 'processing', 'stale completion must not move state';

  -- Sent is terminal: replays observe sent and skip.
  PERFORM public.complete_immediate_order_notification(
    v_order_id, true, v_token
  );
  SELECT claimed, claim_status INTO v_claimed, v_status
  FROM public.claim_immediate_order_notification(v_order_id);
  ASSERT v_claimed = false, 'sent claim must never be reclaimable';
  ASSERT v_status = 'sent', 'replay must observe sent';

  -- Completion is fenced to the processing owner: a stale worker that
  -- outlives the reclaim window must not downgrade a delivered row back
  -- to failed (which would resend the email on the next replay).
  PERFORM public.complete_immediate_order_notification(
    v_order_id, false, v_token
  );
  SELECT claimed, claim_status INTO v_claimed, v_status
  FROM public.claim_immediate_order_notification(v_order_id);
  ASSERT v_claimed = false, 'stale failed completion must not reopen sent';
  ASSERT v_status = 'sent', 'stale failed completion must not downgrade sent';

  -- The claim RPCs are service-role-only (the user-facing route reaches
  -- them through its service client; guest checkouts hold no session that
  -- could). Same privilege shape as claim_order_notification_outbox.
  IF pg_catalog.has_function_privilege(
    'anon',
    'public.claim_immediate_order_notification(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must not execute claim_immediate_order_notification(uuid)';
  END IF;
  IF pg_catalog.has_function_privilege(
    'authenticated',
    'public.claim_immediate_order_notification(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must not execute claim_immediate_order_notification(uuid)';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.claim_immediate_order_notification(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role must execute claim_immediate_order_notification(uuid)';
  END IF;
  IF pg_catalog.has_function_privilege(
    'anon',
    'public.complete_immediate_order_notification(uuid,boolean,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must not execute complete_immediate_order_notification(uuid,boolean,uuid)';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.complete_immediate_order_notification(uuid,boolean,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role must execute complete_immediate_order_notification(uuid,boolean,uuid)';
  END IF;
END;
$$;

ROLLBACK;
