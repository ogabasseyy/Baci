-- Ownership-verified orphan fail for the wallet-only checkout
-- loser path (epic #3694 Phase 2).
--
-- Replaces cleanupOrphanVtuTransactionAfterKeyRace's direct
-- DELETE/SELECT/UPDATE (there is deliberately NO buyer UPDATE or
-- DELETE policy on vtu_transactions — users must never fail or
-- remove rows outside this allowlisted path). Verdict contract
-- matches the TS OrphanVtuCleanupOutcome exactly:
--
--   deleted        → row removed (or already gone: retry-safe).
--   owned_elsewhere→ row left pending by someone else; untouched.
--   marked_failed  → still-pending re-read, CAS-marked failed with
--                    the exact TS markers (fixed discard message,
--                    customerSafe flag, no-collection refund skip).
--   unresolved     → lost the mark CAS (concurrent transition).
--
-- Ownership failures RAISE (never a verdict): a foreign id is an
-- attack signal, and the route must 500 (key kept), never proceed
-- to replay someone else's transaction. The marked_failed branch
-- needs a concurrent status flip between the RPC's DELETE and
-- re-read, so no single-backend check covers it (same testability
-- as the TS version's transport-loss trigger); the route-level
-- mock test pins the verdict mapping instead.

CREATE OR REPLACE FUNCTION public.fail_orphan_vtu_transaction(
  p_transaction_id uuid,
  p_merchant_id uuid,
  p_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_row public.vtu_transactions%ROWTYPE;
  v_base jsonb;
  v_merged jsonb;
BEGIN
  IF p_transaction_id IS NULL OR p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments: fail_orphan_vtu_transaction requires transaction and merchant';
  END IF;

  SELECT t.* INTO v_row
  FROM public.vtu_transactions AS t
  WHERE t.id = p_transaction_id;
  IF NOT FOUND THEN
    -- Already gone (retry after a lost response): gone is gone.
    RETURN 'deleted';
  END IF;

  IF v_row.merchant_id IS DISTINCT FROM p_merchant_id THEN
    RAISE EXCEPTION 'not authorized: merchant scope mismatch';
  END IF;

  -- Ownership: the row's customer must be the caller's own row.
  v_owner :=
    public._vtu_checkout_caller_customer(p_merchant_id, p_user_id);
  IF v_owner IS NULL OR v_row.customer_id IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'not authorized: customer scope mismatch';
  END IF;

  IF v_row.status IS DISTINCT FROM 'pending' THEN
    -- A live row this orphan never should have met: leave it to
    -- its owner (log loudly at the call site).
    RETURN 'owned_elsewhere';
  END IF;

  -- Verified delete first (TS parity).
  DELETE FROM public.vtu_transactions AS t
  WHERE t.id = p_transaction_id
    AND t.status = 'pending';
  IF FOUND THEN
    RETURN 'deleted';
  END IF;

  -- Delete unverifiable: re-read (concurrent transition window).
  SELECT t.* INTO v_row
  FROM public.vtu_transactions AS t
  WHERE t.id = p_transaction_id;
  IF NOT FOUND THEN
    RETURN 'deleted';
  END IF;
  IF v_row.status IS DISTINCT FROM 'pending' THEN
    RETURN 'owned_elsewhere';
  END IF;

  -- Still pending: terminal failed mark, CAS'd on status so a
  -- concurrent transition zero-matches instead of clobbering.
  -- Non-object metadata collapses to {} (TS parity: the app only
  -- writes objects, but jsonb || on a scalar would raise).
  v_base := COALESCE(v_row.metadata, '{}'::jsonb);
  IF jsonb_typeof(v_base) IS DISTINCT FROM 'object' THEN
    v_base := '{}'::jsonb;
  END IF;
  v_merged := v_base || jsonb_build_object(
    'customerSafeErrorMessage', true,
    'refundSkipped', 'no_collection_evidence'
  );
  UPDATE public.vtu_transactions AS t
  SET status = 'failed',
      error_message =
        'Duplicate checkout request discarded; no charge was made.',
      metadata = v_merged
  WHERE t.id = p_transaction_id
    AND t.status = 'pending';
  IF FOUND THEN
    RETURN 'marked_failed';
  END IF;
  RETURN 'unresolved';
END;
$$;

REVOKE ALL ON FUNCTION public.fail_orphan_vtu_transaction(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fail_orphan_vtu_transaction(uuid, uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.fail_orphan_vtu_transaction(uuid, uuid, uuid) IS
  'Phase 2 (#3694): ownership-verified orphan cleanup. deleted/owned_elsewhere/marked_failed/unresolved; foreign ids raise.';
