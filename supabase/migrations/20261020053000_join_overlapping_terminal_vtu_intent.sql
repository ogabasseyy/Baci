-- Join overlapping terminal VTU intents + record loser-key mappings
-- (PR #3730 review round 1: Codex P1 double-debit findings).
--
-- 1. Overlap fence (migration P1): the winner SELECT excluded ALL
-- terminal transactions, so a concurrent duplicate that prepared
-- while the winner was in flight but claimed after a fast
-- terminal result inserted a NEW mapping — both requests debited
-- and vended. The fence now also joins terminals that settled AT
-- OR AFTER the claiming transaction was prepared (same in-flight
-- operation), while terminals that settled BEFORE the prepare
-- stay excluded (genuine repeat purchases start new). Terminal
-- time is vtu_transactions.updated_at (bumped on every UPDATE by
-- update_vtu_transactions_updated_at), falling back to
-- created_at for never-updated rows. Ties (>=) join: same-ms
-- prepares are overwhelmingly same-operation, and the join fails
-- closed (no new debit). Caveat: any post-terminal row touch
-- extends the fence — a preparation delayed across such a touch
-- rejoins instead of starting new (fail-closed, not double-charge).
--
-- 2. Loser-key mapping (mobile-registry P1, server side): the join
-- branch now persists (loser key → winner transaction), so retries
-- presenting the loser key — app restart before canonical-key
-- adoption lands, sibling-tab races, registry loss — replay the
-- winner instead of preparing fresh (which double-debits once the
-- winner terminalizes). Key mappings stay immutable; same-key
-- cross-scope racers keep the first mapping (ON CONFLICT DO
-- NOTHING) while each scope still returns its own winner.
--
-- Append-only repair: 20261019120000_claim_vtu_intent.sql is
-- untouched; CREATE OR REPLACE preserves its grants. The COMMENT
-- below supersedes the "never joined" contract.

CREATE OR REPLACE FUNCTION public.claim_vtu_intent(
  p_key uuid,
  p_fingerprint text,
  p_transaction_id uuid,
  p_merchant_id uuid,
  p_customer_id uuid
)
RETURNS TABLE (
  transaction_id uuid,
  idempotency_key uuid,
  created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.vtu_idempotency_keys%ROWTYPE;
  v_inserted integer;
  v_attempt integer;
  v_claiming_created timestamptz;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: claim_vtu_intent requires service_role';
  END IF;

  IF p_key IS NULL
    OR p_fingerprint IS NULL
    OR p_transaction_id IS NULL
    OR p_merchant_id IS NULL
    OR p_customer_id IS NULL
  THEN
    RAISE EXCEPTION 'claim_invalid_arguments: claim_vtu_intent requires key, fingerprint, transaction, merchant, customer';
  END IF;

  -- Claiming-transaction prepare time for the overlap fence
  -- below. NULL when the prepared row is missing (programmer
  -- error — the route always prepares first): the fence then
  -- strictly excludes terminals (the IS NOT NULL conjunct).
  SELECT t.created_at INTO v_claiming_created
  FROM public.vtu_transactions AS t
  WHERE t.id = p_transaction_id;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'baci_vtu_intent:'
        || p_merchant_id::text
        || '|'
        || p_customer_id::text
        || '|'
        || p_fingerprint,
      0
    )
  );

  -- Bounded attempt loop: a same-key winner can roll back between
  -- our PK conflict and re-read (NOT FOUND below); retrying then
  -- converges instead of stranding the key.
  FOR v_attempt IN 1..3 LOOP
    -- Same key first: key mappings are immutable, so a recorded key
    -- ALWAYS returns its mapping (even terminal) — the scope winner
    -- below must never override it. Scope/fingerprint MUST match
    -- (defense in depth: the route's ownership checks already reject
    -- cross-tenant/changed-payload keys before the claim).
    SELECT k.* INTO v_row
    FROM public.vtu_idempotency_keys AS k
    WHERE k.key = p_key;

    IF FOUND THEN
      IF v_row.merchant_id IS DISTINCT FROM p_merchant_id
        OR v_row.customer_id IS DISTINCT FROM p_customer_id
      THEN
        RAISE EXCEPTION 'claim_scope_mismatch: idempotency key is mapped under a different merchant/customer';
      END IF;

      IF v_row.request_fingerprint IS DISTINCT FROM p_fingerprint THEN
        RAISE EXCEPTION 'claim_fingerprint_mismatch: idempotency key is mapped with a different request payload';
      END IF;

      transaction_id := v_row.vtu_transaction_id;
      idempotency_key := v_row.key;
      created := false;
      RETURN NEXT;
      RETURN;
    END IF;

    -- Unmapped key: join the scope's earliest live-or-overlapping
    -- mapping. Terminals settled BEFORE the claiming prepare are
    -- excluded (genuine repeats start new); terminals settled AT
    -- OR AFTER it overlap the same in-flight operation (a
    -- concurrent duplicate delayed in preparation) and MUST join
    -- to preserve exactly-once (Codex R1 P1). Denylist form (NOT
    -- IN terminal) matches the app's normalizeDbVtuStatus
    -- unknown→processing fallback; the status CHECK admits only
    -- the four lifecycle values, so the forms coincide on real
    -- data.
    SELECT k.* INTO v_row
    FROM public.vtu_idempotency_keys AS k
    JOIN public.vtu_transactions AS t ON t.id = k.vtu_transaction_id
    WHERE k.merchant_id = p_merchant_id
      AND k.customer_id = p_customer_id
      AND k.request_fingerprint = p_fingerprint
      AND (
        t.status NOT IN ('successful', 'failed')
        OR (
          v_claiming_created IS NOT NULL
          AND COALESCE(t.updated_at, t.created_at) >= v_claiming_created
        )
      )
    ORDER BY k.created_at ASC, k.key ASC
    LIMIT 1;

    IF FOUND THEN
      -- Loser-key mapping (Codex R1 P1): persist (loser key →
      -- winner transaction) so loser-key retries replay instead
      -- of preparing fresh. Cross-scope same-key racers keep the
      -- first mapping; we still return OUR scope's winner.
      INSERT INTO public.vtu_idempotency_keys (
        key, vtu_transaction_id, customer_id, merchant_id, request_fingerprint
      ) VALUES (
        p_key, v_row.vtu_transaction_id, p_customer_id, p_merchant_id, p_fingerprint
      )
      ON CONFLICT (key) DO NOTHING;

      transaction_id := v_row.vtu_transaction_id;
      idempotency_key := v_row.key;
      created := false;
      RETURN NEXT;
      RETURN;
    END IF;

    -- No live-or-overlapping intent: record ours. Same-key racers
    -- serialize on the key PRIMARY KEY; the loser takes the
    -- conflict branch.
    INSERT INTO public.vtu_idempotency_keys (
      key, vtu_transaction_id, customer_id, merchant_id, request_fingerprint
    ) VALUES (
      p_key, p_transaction_id, p_customer_id, p_merchant_id, p_fingerprint
    )
    ON CONFLICT (key) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 1 THEN
      transaction_id := p_transaction_id;
      idempotency_key := p_key;
      created := true;
      RETURN NEXT;
      RETURN;
    END IF;

    -- Same-key race backstop: the winner committed between our
    -- same-key read and insert. Re-read it (scope/fingerprint
    -- asserted on the next loop pass); NOT FOUND means it rolled
    -- back, so CONTINUE retries the select-or-insert.
    SELECT k.* INTO v_row
    FROM public.vtu_idempotency_keys AS k
    WHERE k.key = p_key;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'claim_contention_exhausted: idempotency-key winner rolled back repeatedly; retry the same key';
END;
$$;

COMMENT ON FUNCTION public.claim_vtu_intent(
  uuid, text, uuid, uuid, uuid
) IS
  'Exactly-once claim for wallet-only VTU purchase intents: records the caller''s (key, transaction) mapping for an intent scope or joins the scope''s in-flight transaction. Terminals that settled while the claiming transaction was already prepared (same-operation overlap) also join; stale terminals stay excluded so repeats start new. Joins record a loser-key mapping so loser-key retries replay. service_role only; called exclusively from the wallet-only checkout route.';
