-- Commit-safe VTU intent-claim overlap fence (PR #3730 review
-- round 4: Codex P1).
--
-- HOLE: terminal_at is stamped with NOW() — the terminal writer
-- transaction's START, not its commit. A terminal writer that began
-- (t0) but has not committed yet is invisible to a duplicate whose
-- admission stamp (t1 > t0) lands in that window; after preparing,
-- the duplicate's claim observes the committed terminal with
-- terminal_at < admitted_at, the stamp fence excludes it, and a
-- second mapping/fulfillment debits and vends twice. Comparing a
-- xact-start stamp against any post-commit timestamp is
-- fundamentally unsound — commit order is not stamp order
-- (pg_xact_commit_timestamp would fix it, but Supabase does not
-- enable track_commit_timestamp).
--
-- FIX (visibility, not clocks): the admission step now captures an
-- atomic admission PROOF — stamp + the scope's live (mapped,
-- non-terminal) transaction ids under ONE statement snapshot — via
-- vtu_admission_proof. The claim joins a terminal candidate that was
-- live at admission (it terminalized inside the claiming operation's
-- own window: same-operation overlap, stamp irrelevant) and applies
-- the terminal_at >= admitted_at fence ONLY to candidates already
-- terminal at admission — where MVCC visibility PROVES the writer
-- committed before admission, so the xact-start stamp genuinely
-- predates admission and the comparison is sound. Legacy NULL
-- terminal_at stays definitively stale (R3 P2).
--
-- The stamp is statement_timestamp() (statement start = snapshot
-- time), not NOW() (xact start): pre-statement SETs inside the
-- postgREST transaction would otherwise reopen a microsecond gap
-- between stamp and snapshot. Same DB clock both sides: no skew.
--
-- Scope note: the proof snapshots by (merchant, fingerprint) across
-- customers (customer_id is unknowable pre-prepare — the customer
-- row may not exist yet). The claim's WHERE still enforces the
-- exact (merchant, customer, fingerprint) scope on the snapshot-hit
-- path, so foreign ids can never match — the merchant-wide set is a
-- sound superset (no misses, no wrong joins). UUIDs only; the route
-- never logs or responds them. Merchant resolution mirrors the
-- route's alias fallback (direct slug, then merchant_slug_aliases);
-- an unknown slug yields an empty set and the stamp — downstream
-- ownership/prepare guards reject it exactly as today.
--
-- Signature change (append-only repair): vtu_admission_timestamp is
-- dropped (superseded by the proof — no dead privileged surface),
-- and the 6-arg claim is dropped and recreated with REQUIRED
-- p_admission_live (NULL raises: a caller that cannot prove
-- admission liveness must not silently fall back to the stamp-only
-- fence). Earlier claim migrations are untouched; grants are
-- re-applied after the drops (DROP does not preserve them).

CREATE OR REPLACE FUNCTION public.vtu_admission_proof(
  p_merchant_slug text,
  p_fingerprint text
)
RETURNS TABLE (
  admitted_at timestamptz,
  live_transaction_ids uuid[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH merchant AS (
    SELECT m.id
    FROM public.merchants AS m
    WHERE m.slug = p_merchant_slug
    UNION ALL
    SELECT a.merchant_id
    FROM public.merchant_slug_aliases AS a
    WHERE a.old_slug = p_merchant_slug
      AND NOT EXISTS (
        SELECT 1 FROM public.merchants AS live
        WHERE live.slug = p_merchant_slug
      )
    LIMIT 1
  )
  SELECT
    pg_catalog.statement_timestamp(),
    COALESCE(
      (
        SELECT pg_catalog.array_agg(t.id)
        FROM public.vtu_idempotency_keys AS k
        JOIN public.vtu_transactions AS t
          ON t.id = k.vtu_transaction_id
        WHERE k.merchant_id = (SELECT id FROM merchant)
          AND k.request_fingerprint = p_fingerprint
          AND t.status NOT IN ('successful', 'failed')
      ),
      '{}'
    );
$$;

COMMENT ON FUNCTION
  public.vtu_admission_proof(text, text)
IS
  'Atomic VTU intent-claim admission proof: DB-clock stamp plus the merchant-scope live (mapped, non-terminal) transaction ids under one statement snapshot. The claim joins terminals live at admission (same-operation overlap) and stamps-fences the rest. service_role only; called exclusively from the wallet-only checkout route.';

DROP FUNCTION IF EXISTS public.vtu_admission_timestamp();

REVOKE ALL ON FUNCTION
  public.vtu_admission_proof(text, text)
FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.vtu_admission_proof(text, text)
FROM anon;
REVOKE ALL ON FUNCTION
  public.vtu_admission_proof(text, text)
FROM authenticated;
GRANT EXECUTE ON FUNCTION
  public.vtu_admission_proof(text, text)
TO service_role;

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
