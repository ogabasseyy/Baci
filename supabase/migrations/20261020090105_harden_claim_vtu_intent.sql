-- Harden claim_vtu_intent for authenticated callers (epic #3694
-- Phase 2). Depends on 20261020072000 (R4 liveness fence, #3730):
-- same 7-arg signature, same overlap-join internals, plus the
-- ownership gate.
--
-- The claim wrote its (key, transaction) mapping for caller-supplied
-- merchant/customer ids, so it was service_role-only. The checkout
-- now calls it from the authenticated client: for non-service_role
-- callers the RPC resolves the caller's own customer row for the
-- claimed merchant (via the confined Phase 2 helper — byUserId or
-- verified-email) and requires it to equal p_customer_id, else
-- claim_scope_mismatch (the route's existing 400 mapping: "does
-- not belong to this customer"). service_role callers keep the
-- trusted path (explicit ids, server-owned checks).
--
-- Claim internals below the gate are UNCHANGED (advisory lock,
-- same-key-first, live-or-overlapping join, loser-key mapping,
-- contention loop), plus one addition: the claimed transaction must
-- live in the claimed scope (Codex P1, PR #3741). Without it an
-- authenticated caller could map their own key onto another
-- customer's transaction and fulfill it through replay (the replay
-- binding would catch it, but the mapping write itself must not
-- cross scopes).

CREATE OR REPLACE FUNCTION public.claim_vtu_intent(
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
  v_caller_role text;
  v_caller_uid uuid;
  v_owner uuid;
  v_txn_source text;
  v_txn_amount numeric;
  v_txn_metadata jsonb;
  v_split jsonb;
BEGIN
  -- Ownership gate (Phase 2): authenticated callers prove scope
  -- ownership from the JWT; service_role stays trusted.
  v_caller_role := (SELECT auth.role());
  v_caller_uid := (SELECT auth.uid());
  IF v_caller_role IS DISTINCT FROM 'service_role' THEN
    IF v_caller_uid IS NULL THEN
      RAISE EXCEPTION 'forbidden: claim_vtu_intent requires authentication';
    END IF;
    v_owner := public._vtu_checkout_caller_customer(
      p_merchant_id, v_caller_uid
    );
    IF v_owner IS NULL OR v_owner IS DISTINCT FROM p_customer_id THEN
      RAISE EXCEPTION 'claim_scope_mismatch: caller does not own this customer scope';
    END IF;
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

  -- Transaction scope (Codex P1): fail fast before taking the lock.
  -- FOR UPDATE serializes against fail_orphan_vtu_transaction's
  -- DELETE (Codex P2): the orphan cleanup's NOT EXISTS anti-join
  -- runs under READ COMMITTED and could otherwise miss a mapping
  -- this claim is about to insert, deleting the row (and, by
  -- cascade, the fresh mapping) underneath us. Holding the row
  -- lock to transaction end makes the DELETE wait and then
  -- re-evaluate against the committed mapping.
  SELECT t.source, t.amount, t.metadata
    INTO v_txn_source, v_txn_amount, v_txn_metadata
  FROM public.vtu_transactions AS t
  WHERE t.id = p_transaction_id
    AND t.merchant_id = p_merchant_id
    AND t.customer_id = p_customer_id
  FOR UPDATE OF t;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim_scope_mismatch: claimed transaction is outside the customer scope';
  END IF;

  -- Funding gate (Codex P1): a replay mapping may only be granted
  -- for a fully wallet-funded checkout row — the exact shape the
  -- wallet-only prepare records (paymentSplit card = 0, wallet
  -- covering the full amount). A legacy card/hybrid row (no split,
  -- or an unpaid card portion) claimed directly and replayed
  -- through the wallet-only route would vend without its card leg
  -- ever passing gateway verification.
  v_split := v_txn_metadata -> 'paymentSplit';
  IF v_txn_source IS DISTINCT FROM 'checkout'
    OR v_split IS NULL
    OR jsonb_typeof(v_split) <> 'object'
    OR jsonb_typeof(v_split -> 'wallet') <> 'number'
    OR jsonb_typeof(v_split -> 'card') <> 'number'
    OR (v_split ->> 'card')::numeric <> 0
    OR (v_split ->> 'wallet')::numeric < v_txn_amount
  THEN
    RAISE EXCEPTION 'claim_funding_mismatch: claimed transaction is not fully wallet-funded';
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

REVOKE ALL ON FUNCTION public.claim_vtu_intent(
  uuid, text, uuid, uuid, uuid, timestamptz, uuid[]
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_vtu_intent(
  uuid, text, uuid, uuid, uuid, timestamptz, uuid[]
) TO authenticated, service_role;

COMMENT ON FUNCTION public.claim_vtu_intent(
  uuid, text, uuid, uuid, uuid, timestamptz, uuid[]
) IS
  'Exactly-once claim for wallet-only VTU purchase intents: records the caller''s (key, transaction) mapping for an intent scope or joins the scope''s live-or-overlapping transaction (R4 fence). Phase 2 (#3694): authenticated callers prove scope ownership from the JWT (claim_scope_mismatch otherwise); service_role trusted.';
