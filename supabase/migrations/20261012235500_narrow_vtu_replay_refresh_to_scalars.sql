-- Narrow the replay-refresh RPC to scalar fields (Muse R52 low).
--
-- Supersedes 20261012235000_scope_vtu_replay_refresh_to_rpc.sql: the
-- ownership-scoped RPC still returned the whole metadata jsonb,
-- undoing part of the minimization the SELECT-policy removal bought
-- (provider diagnostics, validation references, and internal flags
-- travel to every replay caller). The overlay only reads four keys,
-- so project exactly those as scalars plus the two row columns.
-- Ownership semantics are unchanged: zero rows for non-owner and
-- missing rows alike (no existence oracle), JWT-less passthrough
-- for the reconciliation cron.
--
-- DROP + CREATE (not CREATE OR REPLACE): the return shape changes,
-- which OR REPLACE rejects.
DROP FUNCTION IF EXISTS public.get_vtu_replay_refresh_fields(uuid);

CREATE FUNCTION public.get_vtu_replay_refresh_fields(
  p_transaction_id uuid
)
RETURNS TABLE (
  customer_identifier text,
  status text,
  provider text,
  require_validation_ref boolean,
  biller_code text,
  product_code text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    t.customer_identifier,
    t.status,
    t.metadata->>'provider',
    -- String comparison, not ::boolean: a malformed stored value
    -- must degrade to false, never raise inside the RPC.
    COALESCE(t.metadata->>'requireValidationRef', 'false') = 'true',
    t.metadata->>'billerCode',
    t.metadata->>'productCode'
  FROM public.vtu_transactions t
  WHERE t.id = p_transaction_id
    AND (
      (SELECT auth.uid()) IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.customers c
        WHERE c.id = t.customer_id
          AND c.user_id = (SELECT auth.uid())
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_vtu_replay_refresh_fields(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_vtu_replay_refresh_fields(uuid)
TO authenticated, service_role;
