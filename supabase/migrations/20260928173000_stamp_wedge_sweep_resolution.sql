-- Atomically stamp a wedged-order sweep resolution onto a gateway payment
-- attempt. Client-side read-modify-write of the metadata JSONB would clobber
-- concurrently completed payment metadata (a charge.success webhook may
-- complete the attempt after the sweep reads it) and erase the atomic
-- abandoned_sweep_resolution a duplicate-capture filing just stamped, so the
-- stamp merges database-side. Returns true when the row carries the
-- resolution or no longer needs it (already stamped or deleted); false only
-- on invalid input, so the caller retries.
CREATE FUNCTION public.stamp_wedge_sweep_resolution_v1(
  p_transaction_id uuid,
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
    OR nullif(btrim(coalesce(p_resolution, '')), '') IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.transactions
  SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'wedge_sweep_resolution', p_resolution,
      'wedge_sweep_resolved_at', now()
    )
  WHERE id = p_transaction_id
    AND transaction_type = 'payment'
    AND metadata->>'wedge_sweep_resolution' IS NULL;
  IF FOUND THEN RETURN true; END IF;

  SELECT * INTO v_row FROM public.transactions WHERE id = p_transaction_id;
  IF NOT FOUND THEN RETURN true; END IF;
  IF v_row.metadata->>'wedge_sweep_resolution' IS NOT NULL THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.stamp_wedge_sweep_resolution_v1(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_wedge_sweep_resolution_v1(uuid, text)
  TO service_role;
