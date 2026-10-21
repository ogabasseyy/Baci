-- Atomic VTU admission proof: stamp + live-scope snapshot (PR
-- #3730 review round 4: Codex P1; split from the 305-line
-- 20261020070000 per the 300-line modularity gate — Codex R5 P1).
-- 20261020070000 was removed unapplied pre-merge; this file and
-- 20261020072000 carry its content unchanged.
--
-- terminal_at is the terminal writer's XACT START, not its commit,
-- so comparing it against any post-commit timestamp is unsound
-- (commit order is not stamp order). This RPC captures the claim
-- overlap fence inputs — DB-clock stamp + the scope's live
-- (mapped, non-terminal) transaction ids — under ONE statement
-- snapshot, so the claim can join terminals live at admission
-- regardless of their stamp. The stamp is statement_timestamp()
-- (statement start = snapshot time), not NOW() (xact start):
-- pre-statement SETs would otherwise reopen a microsecond gap.
--
-- Snapshot scope is (merchant, fingerprint) across customers
-- (customer_id is unknowable pre-prepare — the customer row may
-- not exist yet). The claim enforces the exact scope on the
-- snapshot-hit path, so the merchant-wide set is a sound
-- superset. UUIDs only. Merchant resolution mirrors the route's
-- alias fallback; unknown slugs yield an empty set and the stamp
-- (downstream guards reject them exactly as today).
--
-- vtu_admission_timestamp (R3) is dropped: superseded by the
-- proof — no dead privileged surface.

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
        SELECT pg_catalog.array_agg(DISTINCT t.id)
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
