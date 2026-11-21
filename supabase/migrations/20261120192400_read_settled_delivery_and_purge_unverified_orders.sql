-- The existing staff booking route can read the settled delivery terms only.
CREATE FUNCTION public.read_settled_partner_delivery(p_order_id uuid, p_merchant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delivery jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'orders', 'fulfill'
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'service', q.snapshot->'service', 'delivery_minor', q.snapshot->'delivery_minor'
  ) INTO v_delivery
  FROM private.accepted_partner_orders AS a
  JOIN private.partner_order_submissions AS s ON s.id = a.submission_id
  JOIN private.partner_delivery_quotes AS q ON q.id = s.quote_id
    AND q.merchant_id = s.merchant_id AND q.connection_id = s.connection_id
  WHERE a.order_id = p_order_id AND s.merchant_id = p_merchant_id;
  RETURN v_delivery;
END;
$$;

REVOKE ALL ON FUNCTION public.read_settled_partner_delivery(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_settled_partner_delivery(uuid, uuid) TO authenticated;

-- Remove abandoned claims and their address snapshots after the late intake
-- window. A capture row is the parent of both settlements and review holds.
CREATE FUNCTION private.expire_unverified_partner_submissions()
RETURNS bigint
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[];
  v_quotes uuid[];
  v_deleted bigint;
BEGIN
  SELECT array_agg(candidate.id) INTO v_ids
  FROM (
    SELECT s.id
    FROM private.partner_delivery_quotes AS q
    JOIN private.partner_order_submissions AS s ON s.quote_id = q.id
    WHERE q.expires_at < now() - interval '7 days'
      AND s.received_at < now() - interval '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM private.partner_payment_captures AS c WHERE c.submission_id = s.id
      )
    ORDER BY q.expires_at, q.id
    LIMIT 1000
    FOR UPDATE OF q, s SKIP LOCKED
  ) AS candidate;

  -- The fresh snapshot sees a capture that committed before the lock.
  WITH removed AS (
    DELETE FROM private.partner_order_submissions AS s
    WHERE s.id = ANY(v_ids)
      AND NOT EXISTS (
        SELECT 1 FROM private.partner_payment_captures AS c WHERE c.submission_id = s.id
      )
    RETURNING s.quote_id
  )
  SELECT array_agg(quote_id), count(*) INTO v_quotes, v_deleted FROM removed;

  -- The quote locks also block late intake until these quotes are gone.
  DELETE FROM private.partner_delivery_quotes WHERE id = ANY(v_quotes);
  RAISE LOG 'partner_unverified_submission_expiry deleted=% batch_full=%',
    v_deleted, COALESCE(cardinality(v_ids), 0) = 1000;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION private.expire_unverified_partner_submissions()
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    PERFORM cron.schedule(
      'partner-unverified-submission-expiry', '37 * * * *',
      'SELECT private.expire_unverified_partner_submissions();'
    );
  ELSE
    RAISE WARNING 'partner_unverified_submission_expiry scheduler unavailable';
  END IF;
END;
$$;
