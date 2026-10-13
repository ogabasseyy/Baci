-- Pin the VTU replay RPCs' JWT-less passthrough to the service role
-- (Muse R55 low).
--
-- Both replay RPCs treated `(SELECT auth.uid()) IS NULL` as proof of
-- a trusted service-role caller (the reconciliation cron). But
-- auth.uid() is null for ANY claimless invocation — not only the
-- service_role key — so the passthrough's safety rested entirely on
-- the EXECUTE grants staying perfect. A future grant change (e.g. a
-- mistaken GRANT TO anon) would silently turn these SECURITY DEFINER
-- functions into an unauthenticated transaction reader/writer.
--
-- The passthrough now also requires the service role explicitly —
-- via auth.role(), which reads the request JWT claims and so works
-- inside SECURITY DEFINER (current_user there is the function
-- owner, which would make a pg_has_role(current_user, ...) pin a
-- no-op). Truly claimless sessions (direct-psql superuser, pg_cron
-- as postgres — able to read the table directly anyway) keep the
-- legacy passthrough, so the cron path and the existing regression
-- Case 1s are unchanged; what loses access is a JWT caller with no
-- sub whose role is not service_role — exactly the class a future
-- grant slip (e.g. a mistaken GRANT TO anon) would expose. Those
-- degrade to the same silent empty set / silent skip as a non-owned
-- row (no new oracle: missing and existing rows behave identically
-- there too). Authenticated callers keep the ownership path:
-- auth.uid() is non-null for them, so the added conjunct is never
-- even evaluated.
--
-- CREATE OR REPLACE (not DROP + CREATE): neither return shape nor
-- signature changes, so OR REPLACE applies cleanly.
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
        AND (
          (SELECT auth.role()) = 'service_role'
          OR NULLIF(current_setting('request.jwt.claims', true), '') IS NULL
        )
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
  -- JWT with no sub whose role is NOT service_role (e.g. an anon
  -- caller after a future grant slip): silent skip, same as a
  -- non-owned row. Without this such a caller could write replay
  -- attributes (and observe the P0002-vs-silent difference as an
  -- existence oracle). Truly claimless sessions keep the legacy
  -- path below (direct superuser SQL, pg_cron).
  IF v_caller IS NULL
    AND NOT (
      auth.role() = 'service_role'
      OR NULLIF(current_setting('request.jwt.claims', true), '') IS NULL
    )
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
