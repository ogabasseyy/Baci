-- Scope replay attribute overlays to the row owner (Codex R49 rpqN3).
--
-- Supersedes 20261012151000_limit_vtu_replay_attributes_to_pending.sql
-- (body copied verbatim except the added ownership gate; the original
-- file is left untouched so applied histories keep matching their
-- checksums).
--
-- Background: the wallet-only checkout (user-facing) invoked this
-- RPC through the service-role client for a replay-resolved
-- transaction UUID, bypassing RLS with no approved exception — a
-- MUST-rule violation (AGENTS.md: never use the admin/service-role
-- client for user-facing operations). The route now calls through
-- its authenticated user client, and this revision enforces the
-- ownership boundary inside the function: when a user JWT is
-- present, the patch applies only if the row's customer belongs to
-- the caller. JWT-less service-role callers (the reconciliation
-- cron, which resolves its own IDs server-side) are unaffected.
--
-- A failed ownership check is a silent skip, consistent with the
-- pending gate: it is indistinguishable from a missing or
-- non-pending row (no existence oracle), and a legit replay that
-- loses a link race still proceeds with stored attributes instead
-- of 500ing.
--
-- The accompanying SELECT policy lets the TS overlay pre-read (a
-- best-effort Monnify reference refresh over the same user client)
-- see owner rows; without it the refresh would silently degrade to
-- the stored reference for every wallet-only replay. The customers
-- subquery is already permitted by customers_select_policy.
CREATE OR REPLACE FUNCTION public.set_vtu_transaction_replay_attributes(
  p_transaction_id uuid,
  p_customer_phone text,
  p_validation_reference text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone text := NULLIF(BTRIM(p_customer_phone), '');
  v_reference text := NULLIF(BTRIM(p_validation_reference), '');
  v_caller uuid := auth.uid();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.vtu_transactions WHERE id = p_transaction_id
  ) THEN
    RAISE EXCEPTION 'VTU transaction % not found while setting replay attributes',
      p_transaction_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_caller IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.vtu_transactions t
      JOIN public.customers c ON c.id = t.customer_id
      WHERE t.id = p_transaction_id
        AND c.user_id = v_caller
    )
  THEN
    RETURN;
  END IF;

  IF v_phone IS NULL AND v_reference IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.vtu_transactions
  SET metadata = COALESCE(metadata, '{}'::jsonb)
    || CASE WHEN v_phone IS NULL
      THEN '{}'::jsonb
      ELSE jsonb_build_object('customerPhone', v_phone)
    END
    || CASE WHEN v_reference IS NULL
      THEN '{}'::jsonb
      ELSE jsonb_build_object('validationReference', v_reference)
    END
  WHERE id = p_transaction_id
    AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.set_vtu_transaction_replay_attributes(uuid, text, text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_vtu_transaction_replay_attributes(uuid, text, text)
TO service_role, authenticated;

CREATE POLICY "Customers can view own VTU transactions"
ON public.vtu_transactions FOR SELECT
USING (
  customer_id IN (
    SELECT c.id
    FROM public.customers c
    WHERE c.user_id = (SELECT auth.uid())
  )
);
