-- Atomically stamp an abandoned-attempt sweep resolution onto a Paystack
-- payment attempt. Client-side read-modify-write of the metadata JSONB
-- would clobber concurrently completed payment metadata (a charge.success
-- webhook may complete the attempt after the sweep reads it), so the stamp
-- merges database-side with the expected reference guarded in the same
-- operation. Returns true when the row carries the resolution or no
-- longer needs it (already stamped, left the sweep's pending/processing
-- selection, or deleted); false only when the row is still selectable and
-- the guards missed, so the caller retries.
CREATE FUNCTION public.stamp_abandoned_sweep_resolution_v1(
  p_transaction_id uuid,
  p_expected_reference text,
  p_resolution text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row public.transactions%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_transaction_id IS NULL
    OR nullif(btrim(coalesce(p_expected_reference, '')), '') IS NULL
    OR nullif(btrim(coalesce(p_resolution, '')), '') IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.transactions
  SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'abandoned_sweep_resolution', p_resolution,
      'abandoned_sweep_resolved_at', now()
    ),
    updated_at = now()
  WHERE id = p_transaction_id
    AND transaction_type = 'payment'
    AND public.normalized_gateway_name_v1(gateway) = 'PAYSTACK'
    AND gateway_reference = p_expected_reference
    AND status IN ('pending', 'processing')
    AND metadata->>'abandoned_sweep_resolution' IS NULL;
  IF FOUND THEN RETURN true; END IF;

  SELECT * INTO v_row FROM public.transactions WHERE id = p_transaction_id;
  IF NOT FOUND THEN RETURN true; END IF;
  IF v_row.metadata->>'abandoned_sweep_resolution' IS NOT NULL THEN
    RETURN true;
  END IF;
  IF v_row.status NOT IN ('pending', 'processing') THEN RETURN true; END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.stamp_abandoned_sweep_resolution_v1(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_abandoned_sweep_resolution_v1(uuid, text, text)
  TO service_role;
