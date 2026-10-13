-- Atomically set or clear the duplicate-capture review retry marker on a
-- gateway payment attempt. When both duplicate-review filings fail after
-- the atomic finalizer already completed the row, the completed row sits
-- on a paid order no sweep reselects, so the captured extra payment
-- permanently loses its operations review. Setting the marker requeues
-- the row for a filing-only retry; clearing it (once the review lands)
-- retires the row. Client-side read-modify-write of the metadata JSONB
-- would clobber concurrently completed payment metadata, so the merge
-- happens database-side. Returns true when the marker state is applied
-- or the row no longer needs it (deleted); false only on invalid input.
CREATE OR REPLACE FUNCTION public.set_duplicate_capture_review_pending_v1(
  p_transaction_id uuid,
  p_pending boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_transaction_id IS NULL OR p_pending IS NULL THEN
    RETURN false;
  END IF;

  IF p_pending THEN
    UPDATE public.transactions
    SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'duplicate_capture_review_pending', true
      )
    WHERE id = p_transaction_id
      AND transaction_type = 'payment';
  ELSE
    UPDATE public.transactions
    SET metadata = coalesce(metadata, '{}'::jsonb) -
      'duplicate_capture_review_pending'
    WHERE id = p_transaction_id
      AND transaction_type = 'payment';
  END IF;
  IF FOUND THEN RETURN true; END IF;

  PERFORM 1 FROM public.transactions WHERE id = p_transaction_id;
  IF NOT FOUND THEN RETURN true; END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.set_duplicate_capture_review_pending_v1(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_duplicate_capture_review_pending_v1(uuid, boolean)
  TO service_role;
