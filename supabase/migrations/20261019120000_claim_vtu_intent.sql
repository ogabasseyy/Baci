-- Server-side exactly-once claim for wallet-only VTU purchase intents
-- (epic #3694 intent-claim slice).
--
-- Why: the client-side pending registries (web + mobile) cannot
-- serialize concurrent submits. Any second key for an in-flight
-- intent (second tab/device, registry loss, double submit) prepared
-- a second transaction and debited twice. The claim moves the
-- exactly-once decision into Postgres: the first key for an intent
-- scope records its mapping; later keys for the same scope join the
-- in-flight transaction instead of starting a new one.
--
-- Semantics: uniqueness among IN-FLIGHT intents only. Terminal
-- (successful/failed) rows are excluded from winner selection
-- because repeat purchases legitimately share fingerprints — a new
-- key after terminalization starts a new purchase, matching the
-- clients' forget-on-terminal behavior. Deliberately NO unique
-- index on the scope: it would replay old purchases as new
-- (under-delivery). The composite index below is a NON-UNIQUE
-- lookup index for the hot path only.
--
-- Race-freedom comes from serializing same-scope claims on an
-- advisory transaction lock (precedent: complete_order_gateway_payment
-- in 20260805173100_lock_merchant_invoice_exact_completion.sql).
-- The lock is xact-scoped, so a waiter's SELECT always observes the
-- holder's committed mapping (or its absence after abort); READ
-- COMMITTED suffices.
--
-- Error contract (message prefixes; the route maps them to HTTP):
--   claim_scope_mismatch      → 400 (key mapped under another scope)
--   claim_fingerprint_mismatch→ 409 (key mapped with another payload)
--   claim_invalid_arguments   → 500 (programmer error; logged)
--   claim_contention_exhausted→ 500 (3x rollback race; retry same key)

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

    -- Unmapped key: join the scope's earliest in-flight mapping.
    -- Denylist form (NOT IN terminal) matches the app's
    -- normalizeDbVtuStatus unknown→processing fallback; the status
    -- CHECK admits only the four lifecycle values, so the forms
    -- coincide on real data.
    SELECT k.* INTO v_row
    FROM public.vtu_idempotency_keys AS k
    JOIN public.vtu_transactions AS t ON t.id = k.vtu_transaction_id
    WHERE k.merchant_id = p_merchant_id
      AND k.customer_id = p_customer_id
      AND k.request_fingerprint = p_fingerprint
      AND t.status NOT IN ('successful', 'failed')
    ORDER BY k.created_at ASC, k.key ASC
    LIMIT 1;

    IF FOUND THEN
      transaction_id := v_row.vtu_transaction_id;
      idempotency_key := v_row.key;
      created := false;
      RETURN NEXT;
      RETURN;
    END IF;

    -- No in-flight intent: record ours. Same-key racers serialize
    -- on the key PRIMARY KEY; the loser takes the conflict branch.
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
  uuid, text, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_vtu_intent(
  uuid, text, uuid, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION public.claim_vtu_intent(
  uuid, text, uuid, uuid, uuid
) IS
  'Exactly-once claim for wallet-only VTU purchase intents: records the caller''s (key, transaction) mapping for an intent scope or joins the scope''s in-flight transaction. Terminal transactions are never joined. service_role only; called exclusively from the wallet-only checkout route.';

-- NON-UNIQUE lookup index for the claim's hot-path SELECT. Existing
-- indexes don't cover request_fingerprint, so each claim would scan
-- the customer's full purchase history. Uniqueness here would be a
-- BUG (repeat purchases share the scope) — never add it.
CREATE INDEX IF NOT EXISTS vtu_idempotency_keys_scope_fingerprint_idx
  ON public.vtu_idempotency_keys(customer_id, merchant_id, request_fingerprint);

-- The new index's leftmost prefix serves the old customer-scope
-- queries identically; drop the redundant index.
DROP INDEX IF EXISTS public.vtu_idempotency_keys_customer_idx;
