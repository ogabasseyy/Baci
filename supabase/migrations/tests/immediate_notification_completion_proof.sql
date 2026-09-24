-- =============================================
-- REGRESSION TEST: server-only completion proof, never-started reclaim,
-- guest wedge flag
--
-- 1) An anon caller holding an order tracking token can claim a
--    failed/stale delivery row directly and then complete p_sent=true
--    with no delivery (forged terminal: replays skip, success screens
--    report notification_delivered). Completion now requires a
--    server-only HMAC over (order_id, claim_token, sent) that is never
--    returned to tracking-token holders; forged/missing proofs no-op
--    without an oracle, and the RPC fails closed while unprovisioned.
--
-- 2) A claim whose after() callback never started (process death
--    between claim and callback) reclaims after a 90-second grace once
--    the worker marks start as its first step; mid-send crashes keep
--    the full 5-minute window.
--
-- 3) A provider-verified pending guest payment flags its transaction
--    for the privileged wedge sweep (tracking token + reference bound,
--    pending payment rows only, first flag wins).
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/immediate_notification_completion_proof.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := '9f000000-0000-4000-8000-000000000511';
  v_order_id uuid := '9f000000-0000-4000-8000-000000000512';
  v_order2_id uuid := '9f000000-0000-4000-8000-000000000513';
  v_order3_id uuid := '9f000000-0000-4000-8000-000000000514';
  v_txn_id uuid := '9f000000-0000-4000-8000-000000000515';
  v_claimed boolean;
  v_status text;
  v_token uuid;
  v_token2 uuid;
  v_marked boolean;
  v_flagged boolean;
  v_secret text := 'completion-proof-regression-secret-32+';
  v_proof text;
  v_updated_at timestamptz;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (
    v_merchant_id,
    'completion-proof-regression@example.com',
    'Completion Proof Regression',
    'completion-proof-regression'
  );
  INSERT INTO public.orders (
    id, merchant_id, order_number, total, customer_email, tracking_token
  )
  VALUES
    (
      v_order_id, v_merchant_id, 'COMPLETE-PROOF-001', 1000,
      'proof@example.com', 'proof-token-511'
    ),
    (
      v_order2_id, v_merchant_id, 'COMPLETE-PROOF-002', 2000,
      'proof2@example.com', 'proof-token-512'
    ),
    (
      v_order3_id, v_merchant_id, 'COMPLETE-PROOF-003', 3000,
      'proof3@example.com', 'proof-token-513'
    );
  INSERT INTO public.transactions (
    id, merchant_id, order_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, metadata
  )
  VALUES (
    v_txn_id, v_merchant_id, v_order_id, 'payment', 1000, 'NGN',
    'pending', 'paystack', 'PROOF-REF-001', '{}'::jsonb
  );

  -- Unprovisioned completion fails closed without an oracle: even the
  -- correct tracking token and lease cannot advance state.
  SELECT claimed, claim_status, claim_token INTO v_claimed, v_status, v_token
  FROM public.claim_immediate_order_notification_with_proof(
    v_order_id, 'proof-token-511'
  );
  ASSERT v_claimed = true, 'proof claim must win while unprovisioned';
  PERFORM public.complete_immediate_order_notification_with_proof(
    v_order_id, 'proof-token-511', true, v_token, 'bogus-proof'
  );
  SELECT claimed, claim_status INTO v_claimed, v_status
  FROM public.claim_immediate_order_notification(v_order_id);
  ASSERT v_claimed = false, 'unprovisioned complete must not release';
  ASSERT v_status = 'processing', 'unprovisioned complete must not move state';

  -- Provision the shared secret (service-role-only setter).
  PERFORM public.set_immediate_notification_completion_hmac_secret(v_secret);

  -- A forged proof (tracking token + lease but no server secret) is a
  -- silent no-op: the processing claim survives.
  PERFORM public.complete_immediate_order_notification_with_proof(
    v_order_id, 'proof-token-511', true, v_token, 'forged-proof'
  );
  SELECT claimed, claim_status INTO v_claimed, v_status
  FROM public.claim_immediate_order_notification(v_order_id);
  ASSERT v_claimed = false, 'forged proof must not release';
  ASSERT v_status = 'processing', 'forged proof must not move state';

  -- The server-computed proof completes: sent is terminal.
  v_proof := encode(
    extensions.hmac(
      concat_ws('|', v_order_id::text, v_token::text, 'sent'),
      v_secret,
      'sha256'
    ),
    'hex'
  );
  PERFORM public.complete_immediate_order_notification_with_proof(
    v_order_id, 'proof-token-511', true, v_token, v_proof
  );
  SELECT claimed, claim_status INTO v_claimed, v_status
  FROM public.claim_immediate_order_notification_with_proof(
    v_order_id, 'proof-token-511'
  );
  ASSERT v_claimed = false, 'proven sent claim must never be reclaimable';
  ASSERT v_status = 'sent', 'replay must observe sent';

  -- A proof minted for failed cannot complete sent (and vice versa):
  -- the outcome is bound into the HMAC.
  SELECT claimed, claim_status, claim_token INTO v_claimed, v_status, v_token
  FROM public.claim_immediate_order_notification_with_proof(
    v_order2_id, 'proof-token-512'
  );
  ASSERT v_claimed = true, 'second order proof claim must win';
  v_proof := encode(
    extensions.hmac(
      concat_ws('|', v_order2_id::text, v_token::text, 'failed'),
      v_secret,
      'sha256'
    ),
    'hex'
  );
  PERFORM public.complete_immediate_order_notification_with_proof(
    v_order2_id, 'proof-token-512', true, v_token, v_proof
  );
  SELECT claimed, claim_status INTO v_claimed, v_status
  FROM public.claim_immediate_order_notification(v_order2_id);
  ASSERT v_claimed = false, 'cross-outcome proof must not release';
  ASSERT v_status = 'processing', 'cross-outcome proof must not move state';

  -- Start marking: wrong lease loses, correct proof marks, marking is
  -- idempotent.
  SELECT public.mark_immediate_order_notification_started_with_proof(
    v_order2_id, 'proof-token-512', '9f000000-0000-4000-8000-000000000599'
  ) INTO v_marked;
  ASSERT v_marked = false, 'wrong-lease mark must lose';
  SELECT public.mark_immediate_order_notification_started_with_proof(
    v_order2_id, 'wrong-token', v_token
  ) INTO v_marked;
  ASSERT v_marked = false, 'wrong-proof mark must lose';
  SELECT public.mark_immediate_order_notification_started_with_proof(
    v_order2_id, 'proof-token-512', v_token
  ) INTO v_marked;
  ASSERT v_marked = true, 'correct mark must win';
  SELECT public.mark_immediate_order_notification_started_with_proof(
    v_order2_id, 'proof-token-512', v_token
  ) INTO v_marked;
  ASSERT v_marked = false, 'repeat mark must not rewrite started_at';

  -- A started claim keeps the full crash window: 2 minutes locked is
  -- still blocked, 6 minutes reclaims with a fresh token.
  UPDATE public.immediate_order_notification_claims
  SET locked_at = now() - interval '2 minutes'
  WHERE order_id = v_order2_id;
  SELECT claimed, claim_status INTO v_claimed, v_status
  FROM public.claim_immediate_order_notification(v_order2_id);
  ASSERT v_claimed = false, 'fresh started claim must still block';
  ASSERT v_status = 'processing', 'fresh started claim must stay processing';
  UPDATE public.immediate_order_notification_claims
  SET locked_at = now() - interval '6 minutes'
  WHERE order_id = v_order2_id;
  v_token2 := v_token;
  SELECT claimed, claim_token INTO v_claimed, v_token
  FROM public.claim_immediate_order_notification(v_order2_id);
  ASSERT v_claimed = true, 'stale started claim must be reclaimable';
  ASSERT v_token IS DISTINCT FROM v_token2, 'reclaim must mint a new token';

  -- A never-started claim reclaims after the short grace: fresh (<90s)
  -- still blocks, 2 minutes reclaims.
  SELECT claimed, claim_status, claim_token INTO v_claimed, v_status, v_token
  FROM public.claim_immediate_order_notification_with_proof(
    v_order3_id, 'proof-token-513'
  );
  ASSERT v_claimed = true, 'third order proof claim must win';
  SELECT claimed, claim_status INTO v_claimed, v_status
  FROM public.claim_immediate_order_notification(v_order3_id);
  ASSERT v_claimed = false, 'fresh never-started claim must still block';
  UPDATE public.immediate_order_notification_claims
  SET locked_at = now() - interval '2 minutes'
  WHERE order_id = v_order3_id;
  v_token2 := v_token;
  SELECT claimed, claim_token INTO v_claimed, v_token
  FROM public.claim_immediate_order_notification(v_order3_id);
  ASSERT v_claimed = true, 'aged never-started claim must be reclaimable';
  ASSERT v_token IS DISTINCT FROM v_token2, 'reclaim must mint a new token';

  -- Guest wedge flag: wrong proof denies without touching the row.
  SELECT public.flag_guest_payment_provider_confirmed(
    v_order_id, 'wrong-token', 'PROOF-REF-001'
  ) INTO v_flagged;
  ASSERT v_flagged = false, 'wrong-proof flag must lose';

  -- Correct proof stamps the pending payment transaction.
  SELECT public.flag_guest_payment_provider_confirmed(
    v_order_id, 'proof-token-511', 'PROOF-REF-001'
  ) INTO v_flagged;
  ASSERT v_flagged = true, 'correct flag must win';
  SELECT updated_at INTO v_updated_at
  FROM public.transactions
  WHERE id = v_txn_id;
  ASSERT (
    SELECT metadata->>'guest_provider_confirmed'
    FROM public.transactions
    WHERE id = v_txn_id
  ) = 'true', 'flag must stamp the transaction';

  -- First flag wins: repeat polls neither restamp nor extend the
  -- sweep grace.
  SELECT public.flag_guest_payment_provider_confirmed(
    v_order_id, 'proof-token-511', 'PROOF-REF-001'
  ) INTO v_flagged;
  ASSERT v_flagged = false, 'repeat flag must be a no-op';
  ASSERT (
    SELECT updated_at FROM public.transactions WHERE id = v_txn_id
  ) = v_updated_at, 'repeat flag must not bump updated_at';

  -- Unknown references and completed rows never flag.
  SELECT public.flag_guest_payment_provider_confirmed(
    v_order_id, 'proof-token-511', 'NOPE-REF'
  ) INTO v_flagged;
  ASSERT v_flagged = false, 'unknown reference must not flag';
  UPDATE public.transactions SET status = 'completed' WHERE id = v_txn_id;
  SELECT public.flag_guest_payment_provider_confirmed(
    v_order_id, 'proof-token-511', 'PROOF-REF-001'
  ) INTO v_flagged;
  ASSERT v_flagged = false, 'completed transaction must not flag';

  -- Privilege shape: the proof-bound surface stays invocable on
  -- request-scoped clients; the base marker and the secret setter stay
  -- service-role-only.
  IF NOT pg_catalog.has_function_privilege(
    'anon',
    'public.complete_immediate_order_notification_with_proof(uuid,text,boolean,uuid,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must execute complete_immediate_order_notification_with_proof(uuid,text,boolean,uuid,text)';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'anon',
    'public.mark_immediate_order_notification_started_with_proof(uuid,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must execute mark_immediate_order_notification_started_with_proof(uuid,text,uuid)';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'anon',
    'public.flag_guest_payment_provider_confirmed(uuid,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must execute flag_guest_payment_provider_confirmed(uuid,text,text)';
  END IF;
  IF pg_catalog.has_function_privilege(
    'anon',
    'public.mark_immediate_order_notification_started(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must not execute mark_immediate_order_notification_started(uuid,uuid)';
  END IF;
  IF pg_catalog.has_function_privilege(
    'anon',
    'public.set_immediate_notification_completion_hmac_secret(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must not execute set_immediate_notification_completion_hmac_secret(text)';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.set_immediate_notification_completion_hmac_secret(text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role must execute set_immediate_notification_completion_hmac_secret(text)';
  END IF;
END;
$$;

ROLLBACK;
