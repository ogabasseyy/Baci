-- Fence the VTU intent-claim overlap on admission time (PR #3730
-- review round 3: Codex P1 + P2).
--
-- P1 (admission, not row-insert): the overlap fence compared the
-- terminal time against the claiming row's created_at — but that
-- row is inserted only AFTER preparation/validation completes. A
-- duplicate admitted while the winner was in flight could spend
-- long enough in preparation to insert its row AFTER the winner
-- terminalized; the fence then misread the terminal as stale,
-- created a new mapping, and debited/vended twice. The route now
-- captures a DB-clock admission stamp BEFORE preparation
-- (vtu_admission_timestamp, issued concurrently with the key
-- lookup so no latency is added) and passes it as p_admitted_at;
-- the fence compares terminal time against operation admission.
-- Same-clock (DB NOW() both sides): no app/DB skew hazard. A
-- duplicate admitted while the winner is in flight joins even if
-- preparation delays its row past terminalization; requests
-- admitted after terminalization (genuine repeats — same-key
-- retries replay regardless) start new.
--
-- P2 (legacy terminals definitively stale): pre-migration
-- terminal rows have terminal_at NULL. Falling back to their
-- mutable updated_at would let a post-migration metadata touch
-- drag a legacy terminal across the fence. NULL terminal_at now
-- means settled-before-deploy, which strictly predates any live
-- admission — legacy terminals are excluded unconditionally (no
-- updated_at/created_at fallback). In-flight legacy rows still
-- join via the status disjunct.
--
-- Signature change (append-only repair): the 5-arg claim is
-- dropped and recreated with p_admitted_at (no DEFAULT — the
-- fence requires it; the route is the sole caller). Earlier
-- claim migrations are untouched; grants are re-applied after
-- the drop (DROP does not preserve them).

CREATE OR REPLACE FUNCTION public.vtu_admission_timestamp()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOW();
$$;

COMMENT ON FUNCTION public.vtu_admission_timestamp() IS
  'DB-clock stamp captured before VTU intent preparation; the claim overlap fence compares terminal time against operation admission. service_role only; called exclusively from the wallet-only checkout route.';

REVOKE ALL ON FUNCTION public.vtu_admission_timestamp() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vtu_admission_timestamp() FROM anon;
REVOKE ALL ON FUNCTION public.vtu_admission_timestamp() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.vtu_admission_timestamp() TO service_role;

DROP FUNCTION IF EXISTS
  public.claim_vtu_intent(uuid, text, uuid, uuid, uuid);

CREATE FUNCTION public.claim_vtu_intent(
  p_key uuid,
  p_fingerprint text,
  p_transaction_id uuid,
  p_merchant_id uuid,
  p_customer_id uuid,
  p_admitted_at timestamptz
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
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: claim_vtu_intent requires service_role';
  END IF;

  IF p_key IS NULL
    OR p_fingerprint IS NULL
    OR p_transaction_id IS NULL
    OR p_merchant_id IS NULL
    OR p_customer_id IS NULL
    OR p_admitted_at IS NULL
  THEN
    RAISE EXCEPTION 'claim_invalid_arguments: claim_vtu_intent requires key, fingerprint, transaction, merchant, customer, admission timestamp';
  END IF;

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
    -- mapping. Terminals settled BEFORE this operation was
    -- admitted are excluded (genuine repeats start new);
    -- terminals settled AT OR AFTER admission overlap the same
    -- in-flight operation (a concurrent duplicate delayed in
    -- preparation/validation) and MUST join to preserve
    -- exactly-once (Codex R1 P1, R3 P1). Settle time is
    -- terminal_at (stamped only on entry into terminal status);
    -- NULL terminal_at means settled-before-deploy and is
    -- definitively stale (Codex R3 P2). Denylist form (NOT IN
    -- terminal) matches the app's normalizeDbVtuStatus
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
          t.terminal_at IS NOT NULL
          AND t.terminal_at >= p_admitted_at
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
  uuid, text, uuid, uuid, uuid, timestamptz
) IS
  'Exactly-once claim for wallet-only VTU purchase intents: records the caller''s (key, transaction) mapping for an intent scope or joins the scope''s in-flight transaction. Terminals that settled while the claiming operation was already admitted (same-operation overlap, fenced on terminal_at vs admission time) also join; stale terminals stay excluded so repeats start new. Joins record a loser-key mapping so loser-key retries replay. service_role only; called exclusively from the wallet-only checkout route.';

REVOKE ALL ON FUNCTION
  public.claim_vtu_intent(uuid, text, uuid, uuid, uuid, timestamptz)
FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.claim_vtu_intent(uuid, text, uuid, uuid, uuid, timestamptz)
FROM anon;
REVOKE ALL ON FUNCTION
  public.claim_vtu_intent(uuid, text, uuid, uuid, uuid, timestamptz)
FROM authenticated;
GRANT EXECUTE ON FUNCTION
  public.claim_vtu_intent(uuid, text, uuid, uuid, uuid, timestamptz)
TO service_role;
