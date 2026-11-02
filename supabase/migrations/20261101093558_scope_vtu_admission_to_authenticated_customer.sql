-- #3694: admission needs a customer-scoped overlap snapshot, not a
-- merchant-wide privileged read. Keep the statement-clock stamp and live
-- IDs atomic: the claim's commit-safe terminal overlap fence is unchanged.
CREATE OR REPLACE FUNCTION public.vtu_admission_proof(
  p_merchant_slug text,
  p_fingerprint text
)
RETURNS TABLE (admitted_at timestamptz, live_transaction_ids uuid[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_merchant_id uuid;
  v_customer_id uuid;
  v_privileged boolean := (SELECT auth.role()) = 'service_role';
BEGIN
  IF NOT COALESCE(v_privileged, false) AND (
    (SELECT auth.role()) IS DISTINCT FROM 'authenticated'
    OR (SELECT auth.uid()) IS NULL
  ) THEN
    RAISE EXCEPTION 'admission_authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_merchant_slug IS NULL OR p_fingerprint IS NULL THEN
    RAISE EXCEPTION 'admission_invalid_arguments' USING ERRCODE = '22023';
  END IF;

  SELECT m.id INTO v_merchant_id FROM public.merchants AS m
  WHERE m.slug = p_merchant_slug;
  IF NOT FOUND THEN
    SELECT a.merchant_id INTO v_merchant_id
    FROM public.merchant_slug_aliases AS a
    WHERE a.old_slug = p_merchant_slug LIMIT 1;
  END IF;

  IF NOT COALESCE(v_privileged, false) THEN
    -- Same verified identifier and linked-customer rules as preparation
    -- and claim. Missing customers need no live fence input: preparation
    -- will create/link them after this admission statement.
    v_customer_id := public._vtu_checkout_caller_customer(
      v_merchant_id, (SELECT auth.uid())
    );
  END IF;

  RETURN QUERY SELECT pg_catalog.statement_timestamp(), COALESCE((
    SELECT pg_catalog.array_agg(DISTINCT t.id)
    FROM public.vtu_idempotency_keys AS k
    JOIN public.vtu_transactions AS t ON t.id = k.vtu_transaction_id
    WHERE k.merchant_id = v_merchant_id
      AND k.request_fingerprint = p_fingerprint
      AND (COALESCE(v_privileged, false) OR k.customer_id = v_customer_id)
      -- Check the row as well as its mapping; malformed legacy mappings
      -- must not disclose another customer's transaction identifier.
      AND t.merchant_id = k.merchant_id
      AND t.customer_id = k.customer_id
      AND t.status NOT IN ('successful', 'failed')
  ), '{}'::uuid[]);
END;
$$;
REVOKE ALL ON FUNCTION public.vtu_admission_proof(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vtu_admission_proof(text, text)
  TO authenticated, service_role;
COMMENT ON FUNCTION public.vtu_admission_proof(text, text) IS
  'Atomic DB-clock VTU overlap proof. Authenticated callers receive only their verified customer scope; trusted service_role retains merchant-wide compatibility. No balance, settlement, PIN, or customer row is exposed.';
