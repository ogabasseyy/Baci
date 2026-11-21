-- Record cleanup throughput without including quote or recipient data.
CREATE OR REPLACE FUNCTION private.expire_unclaimed_partner_quotes()
RETURNS bigint
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[];
  v_deleted bigint;
BEGIN
  -- Leave a week for partners to deliver an already captured order. Skip
  -- submissions currently claiming the quote with their FOR KEY SHARE lock.
  SELECT array_agg(candidate.id) INTO v_ids
  FROM (
    SELECT q.id
    FROM private.partner_delivery_quotes AS q
    WHERE q.expires_at < now() - interval '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM private.partner_order_submissions AS s WHERE s.quote_id = q.id
      )
    ORDER BY q.expires_at, q.id
    LIMIT 1000
    FOR UPDATE OF q SKIP LOCKED
  ) AS candidate;

  -- Recheck relationships after taking the exclusive quote locks. An intake
  -- may have committed just before cleanup took its lock.
  DELETE FROM private.partner_delivery_quotes AS q
  WHERE q.id = ANY(v_ids)
    AND NOT EXISTS (
      SELECT 1 FROM private.partner_order_submissions AS s WHERE s.quote_id = q.id
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE LOG 'partner_unclaimed_quote_expiry deleted=% batch_full=%',
    v_deleted, COALESCE(cardinality(v_ids), 0) = 1000;
  RETURN v_deleted;
END;
$$;
