-- Commit-safe VTU intent-claim overlap fence (PR #3730 review
-- round 4: Codex P1; split from the 305-line 20261020070000 per
-- the 300-line modularity gate — Codex R5 P1). 20261020070000
-- was removed unapplied pre-merge; this file and
-- 20261020071000 carry its content unchanged.
--
-- HOLE: a terminal writer that began (t0) but has not committed
-- yet is invisible to a duplicate admitted in that window (t1 >
-- t0); after preparing, the duplicate's claim observes the
-- committed terminal with terminal_at < admitted_at, the
-- stamp-only fence excludes it, and a second mapping/fulfillment
-- debits and vends twice.
--
-- FIX (visibility, not clocks): the claim joins terminal
-- candidates live at admission (the vtu_admission_proof snapshot
-- from 20261020071000, captured atomically with the stamp —
-- terminalized inside the claiming operation's own window:
-- same-operation overlap, stamp irrelevant) and applies the
-- terminal_at >= admitted_at fence ONLY to candidates already
-- terminal at admission, where MVCC visibility PROVES the writer
-- committed before admission, so its xact-start stamp genuinely
-- predates it and the comparison is sound. Legacy NULL
-- terminal_at stays definitively stale (R3 P2).
--
-- Signature change (append-only repair): the 6-arg claim is
-- dropped and recreated with REQUIRED p_admission_live (NULL
-- raises: a caller that cannot prove admission liveness must not
-- silently fall back to the stamp-only fence). Grants are
-- re-applied after the drop (DROP does not preserve them).

DROP FUNCTION IF EXISTS
  public.claim_vtu_intent(uuid, text, uuid, uuid, uuid, timestamptz);

CREATE FUNCTION public.claim_vtu_intent(
  p_key uuid,
  p_fingerprint text,
  p_transaction_id uuid,
  p_merchant_id uuid,
  p_customer_id uuid,
  p_admitted_at timestamptz,
  p_admission_live uuid[]
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
    OR p_admission_live IS NULL
  THEN
    RAISE EXCEPTION 'claim_invalid_arguments: claim_vtu_intent requires key, fingerprint, transaction, merchant, customer, admission timestamp, admission liveness';
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
    -- mapping. Non-terminal candidates always join (in flight).
    -- Terminal candidates join when they were LIVE at this
    -- operation's admission (the admission-liveness snapshot,
    -- captured atomically with the stamp: terminalized inside our
    -- own window — same-operation overlap; the xact-start stamp is
    -- irrelevant because commit order, not stamp order, decides —
    -- Codex R4 P1) or when stamped at/after admission (the stamp
    -- fence, sound ONLY for candidates already terminal at
    -- admission, where MVCC visibility proves the writer committed
    -- before admission so its xact-start stamp genuinely predates
    -- it). Terminals settled before admission stay excluded
    -- (genuine repeats start new); NULL terminal_at means
    -- settled-before-deploy and is definitively stale (Codex R3
    -- P2). Denylist form (NOT IN terminal) matches the app's
    -- normalizeDbVtuStatus unknown→processing fallback; the status
    -- CHECK admits only the four lifecycle values, so the forms
    -- coincide on real data.
    SELECT k.* INTO v_row
    FROM public.vtu_idempotency_keys AS k
    JOIN public.vtu_transactions AS t ON t.id = k.vtu_transaction_id
    WHERE k.merchant_id = p_merchant_id
      AND k.customer_id = p_customer_id
      AND k.request_fingerprint = p_fingerprint
      AND (
        t.status NOT IN ('successful', 'failed')
        OR t.id = ANY (p_admission_live)
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
  uuid, text, uuid, uuid, uuid, timestamptz, uuid[]
) IS
  'Exactly-once claim for wallet-only VTU purchase intents: records the caller''s (key, transaction) mapping for an intent scope or joins the scope''s in-flight transaction. Terminals live at admission (same-operation overlap, proven by the admission-liveness snapshot) or stamped at/after admission also join; stale terminals stay excluded so repeats start new. Joins record a loser-key mapping so loser-key retries replay. service_role only; called exclusively from the wallet-only checkout route.';

REVOKE ALL ON FUNCTION
  public.claim_vtu_intent(uuid, text, uuid, uuid, uuid, timestamptz, uuid[])
FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.claim_vtu_intent(uuid, text, uuid, uuid, uuid, timestamptz, uuid[])
FROM anon;
REVOKE ALL ON FUNCTION
  public.claim_vtu_intent(uuid, text, uuid, uuid, uuid, timestamptz, uuid[])
FROM authenticated;
GRANT EXECUTE ON FUNCTION
  public.claim_vtu_intent(uuid, text, uuid, uuid, uuid, timestamptz, uuid[])
TO service_role;
