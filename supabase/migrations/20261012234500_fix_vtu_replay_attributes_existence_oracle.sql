-- Fix existence oracle in set_vtu_transaction_replay_attributes (Muse R50).
--
-- Supersedes 20261012233000_scope_vtu_replay_attributes_to_owner.sql
-- (body copied verbatim except the reordered gates; the original file
-- is left untouched so applied histories keep matching their
-- checksums). Grants and the owner SELECT policy already applied
-- there are unchanged and not repeated.
--
-- The 233000 revision raised P0002 for a missing transaction BEFORE
-- the ownership gate silently returned for a non-owned row, so an
-- authenticated caller invoking the RPC directly could distinguish
-- "exists but is not mine" (silent success) from "does not exist"
-- (P0002) — contradicting the no-oracle claim. This revision checks
-- ownership first: for authenticated callers a non-owned row takes
-- the same silent path as a missing row (the join finds nothing in
-- both cases). The P0002 raise is kept for JWT-less service-role
-- callers only (the reconciliation cron resolves its IDs
-- server-side, so a missing row there is always a caller bug worth
-- failing loudly on).
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
  -- Ownership first: for authenticated callers a non-owned row is a
  -- silent skip, indistinguishable from a missing row (no existence
  -- oracle). A legit replay that loses a link race still proceeds
  -- with stored attributes instead of 500ing.
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

  -- Existence signal for JWT-less service-role callers only.
  IF v_caller IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.vtu_transactions WHERE id = p_transaction_id
    )
  THEN
    RAISE EXCEPTION 'VTU transaction % not found while setting replay attributes',
      p_transaction_id
      USING ERRCODE = 'P0002';
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
