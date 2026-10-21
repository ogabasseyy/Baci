-- Stamp VTU terminal transitions; fence the intent-claim overlap
-- on the transition time (PR #3730 review round 2: Codex P2).
--
-- The overlap fence in 20261020053000 read updated_at as the
-- settle time, but updated_at advances on EVERY row update —
-- including post-settlement metadata touches (success-notification
-- attempt claims, voucher-PIN backfill). A legitimate repeat
-- prepared before such a touch but claimed after it would wrongly
-- join the old terminal instead of executing. The checkout
-- contract requires stale terminals to stay excluded, so the
-- transition time is now tracked separately:
--
--   terminal_at — stamped (NOW()) exactly on entry into a
--   terminal status (successful/failed), via a BEFORE UPDATE
--   trigger gated on OLD.status IS DISTINCT FROM NEW.status.
--   Post-terminal touches (same-status updates) never move it.
--   Retries that re-terminalize re-stamp (latest settle wins,
--   matching the row's return to in-flight in between).
--
-- The claim fence reads COALESCE(terminal_at, updated_at,
-- created_at): pre-migration terminal rows (terminal_at NULL)
-- fall back to updated_at, whose touches all predate any live
-- prepare — stale as required. No backfill: rewriting settled
-- rows would bake touch-pollution into the stamp.
--
-- Append-only repair: earlier claim migrations are untouched;
-- CREATE OR REPLACE preserves the function's grants.

ALTER TABLE public.vtu_transactions
  ADD COLUMN IF NOT EXISTS terminal_at timestamptz;

CREATE OR REPLACE FUNCTION public.update_vtu_terminal_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.terminal_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_vtu_transactions_terminal_at
  ON public.vtu_transactions;

CREATE TRIGGER update_vtu_transactions_terminal_at
  BEFORE UPDATE ON public.vtu_transactions
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    AND NEW.status IN ('successful', 'failed')
  )
  EXECUTE FUNCTION public.update_vtu_terminal_at();

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
    -- to preserve exactly-once (Codex R1 P1). Settle time is
    -- terminal_at (stamped only on entry into terminal status),
    -- falling back to updated_at/created_at for pre-migration
    -- rows — post-settlement metadata touches never suppress a
    -- repeat (Codex R2 P2). Denylist form (NOT IN terminal)
    -- matches the app's normalizeDbVtuStatus unknown→processing
    -- fallback; the status CHECK admits only the four lifecycle
    -- values, so the forms coincide on real data.
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
          AND COALESCE(t.terminal_at, t.updated_at, t.created_at)
            >= v_claiming_created
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
  'Exactly-once claim for wallet-only VTU purchase intents: records the caller''s (key, transaction) mapping for an intent scope or joins the scope''s in-flight transaction. Terminals that settled while the claiming transaction was already prepared (same-operation overlap, fenced on terminal_at) also join; stale terminals stay excluded so repeats start new. Joins record a loser-key mapping so loser-key retries replay. service_role only; called exclusively from the wallet-only checkout route.';
