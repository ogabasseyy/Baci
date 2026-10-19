-- Require the service_role JWT in the VTU replay RPCs (Muse R57).
--
-- Supersedes 20261013031000_pin_vtu_replay_rpcs_to_service_role.sql
-- (body copied except the tightened gates; the original file is left
-- untouched so applied histories keep matching their checksums).
-- Grants are unchanged and not repeated.
--
-- The 31000 pin kept a carve-out for truly claimless sessions
-- (direct-psql superuser, pg_cron) — but that reintroduced the exact
-- property the pin was meant to remove: inside these SECURITY
-- DEFINER, PostgREST-reachable functions, a claimless-trusted branch
-- makes safety depend on EXECUTE grants staying perfect for any
-- invocation path that can present empty claims.
--
-- The carve-out served no real caller. The reconciliation cron is a
-- Vercel HTTP route using the service_role key
-- (api/cron/reconcile-vtu-processing), so it presents a service_role
-- JWT (claims present, role service_role, no sub) — not a claimless
-- session. There is no pg_cron caller for these RPCs. Direct-psql
-- superusers can read the tables outright, so losing RPC
-- passthrough costs them nothing (and they can SET claims to test
-- either branch).
--
-- The passthrough is now exactly: no sub AND role service_role.
-- auth.role() reads the request JWT claims, which is the only
-- caller discriminator that works inside SECURITY DEFINER
-- (current_user there is the function owner). A sub-less JWT with
-- any other role — or no claims at all — takes the same silent
-- empty set / silent skip as a non-owned row (no new oracle).
--
-- CREATE OR REPLACE: neither return shape nor signature changes.
CREATE OR REPLACE FUNCTION public.get_vtu_replay_refresh_fields(
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
      (
        (SELECT auth.uid()) IS NULL
        AND (SELECT auth.role()) = 'service_role'
      )
      OR EXISTS (
        SELECT 1
        FROM public.customers c
        WHERE c.id = t.customer_id
          AND c.user_id = (SELECT auth.uid())
      )
    );
$$;

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
  -- Sub-less callers without the service_role JWT (any other JWT
  -- role, or no claims at all): silent skip, same as a non-owned
  -- row. The cron presents the service_role JWT, so it is
  -- unaffected; truly claimless direct SQL never had a legitimate
  -- write path here.
  IF v_caller IS NULL AND auth.role() IS DISTINCT FROM 'service_role'
  THEN
    RETURN;
  END IF;

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

  -- Existence signal for service_role-JWT callers only.
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
