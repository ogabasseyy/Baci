-- Resolve scheduled-delivery audiences in stable, bounded pages. This avoids
-- both the PostgREST default row cap and materializing an entire audience.

BEGIN;

CREATE FUNCTION public.get_scheduled_notification_recipient_page_v1(
  p_notification_id uuid,
  p_claim_token uuid,
  p_after_merchant_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 500
)
RETURNS TABLE(merchant_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_claim_token IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'Invalid notification recipient page' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH notification AS (
    SELECT n.target_type, COALESCE(n.target_merchant_ids, '{}'::uuid[]) AS target_merchant_ids,
      n.target_segment
    FROM public.notifications AS n
    WHERE n.id = p_notification_id
      AND n.delivery_state = 'processing'
      AND n.sent_at IS NULL
      AND n.delivery_claim_token = p_claim_token
      AND (n.expires_at IS NULL OR n.expires_at > statement_timestamp())
  ), paid_sales AS (
    SELECT o.merchant_id, MAX(COALESCE(o.paid_at, o.updated_at, o.created_at)) AS last_paid_at
    FROM public.orders AS o
    WHERE LOWER(BTRIM(o.payment_status)) = 'paid'
    GROUP BY o.merchant_id
  )
  SELECT m.id
  FROM public.merchants AS m
  CROSS JOIN notification AS n
  LEFT JOIN paid_sales AS ps ON ps.merchant_id = m.id
  WHERE m.user_id IS NOT NULL
    AND m.is_platform_admin IS NOT TRUE
    AND (p_after_merchant_id IS NULL OR m.id > p_after_merchant_id)
    AND CASE n.target_type
      WHEN 'specific' THEN m.id = ANY(n.target_merchant_ids)
      WHEN 'all' THEN TRUE
      WHEN 'segment' THEN CASE n.target_segment
        WHEN 'new' THEN m.created_at >= statement_timestamp() - interval '30 days'
        WHEN 'active' THEN ps.last_paid_at >= statement_timestamp() - interval '30 days'
        WHEN 'at_risk' THEN ps.last_paid_at < statement_timestamp() - interval '30 days'
          AND ps.last_paid_at >= statement_timestamp() - interval '90 days'
        ELSE FALSE
      END
      ELSE FALSE
    END
  ORDER BY m.id
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_scheduled_notification_recipient_page_v1(uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_scheduled_notification_recipient_page_v1(uuid, uuid, uuid, integer)
  TO service_role;

COMMIT;
