-- Snapshot each claimed audience and renew only the claim token that owns it.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_notification_audience_snapshot (
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  claim_token uuid NOT NULL,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (notification_id, claim_token, merchant_id)
);
ALTER TABLE public.admin_notification_audience_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_notification_audience_snapshot FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS admin_notification_audience_snapshot_page_idx
  ON public.admin_notification_audience_snapshot (notification_id, claim_token, merchant_id);

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_delivery_content_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_delivery_content_check CHECK (
    scheduled_for IS NOT NULL
    AND (expires_at IS NULL OR expires_at > scheduled_for)
    AND (target_type <> 'specific' OR cardinality(COALESCE(target_merchant_ids, '{}'::uuid[])) > 0)
    AND (target_type <> 'segment' OR target_segment IS NOT NULL)
    AND (target_type <> 'all' OR (
      target_segment IS NULL AND cardinality(COALESCE(target_merchant_ids, '{}'::uuid[])) = 0
    ))
  ) NOT VALID;

CREATE FUNCTION public.snapshot_claimed_notification_audience_v1(
  p_notification_id uuid, p_claim_token uuid
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count bigint;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Service role claim required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.notifications AS n WHERE n.id = p_notification_id
      AND n.delivery_state = 'processing' AND n.sent_at IS NULL
      AND n.delivery_claim_token = p_claim_token
  ) THEN RAISE EXCEPTION 'Notification claim is no longer active' USING ERRCODE = 'P0002'; END IF;
  WITH notification AS (
    SELECT n.target_type, COALESCE(n.target_merchant_ids, '{}'::uuid[]) AS target_merchant_ids,
      n.target_segment FROM public.notifications AS n WHERE n.id = p_notification_id
  ), paid_sales AS (
    SELECT o.merchant_id, MAX(COALESCE(o.paid_at, o.updated_at, o.created_at)) AS last_paid_at
    FROM public.orders AS o WHERE LOWER(BTRIM(o.payment_status)) = 'paid' GROUP BY o.merchant_id
  ), inserted AS (
    INSERT INTO public.admin_notification_audience_snapshot (notification_id, claim_token, merchant_id)
    SELECT p_notification_id, p_claim_token, m.id FROM public.merchants AS m
    CROSS JOIN notification AS n LEFT JOIN paid_sales AS ps ON ps.merchant_id = m.id
    WHERE m.user_id IS NOT NULL AND m.is_platform_admin IS NOT TRUE
      AND CASE n.target_type
        WHEN 'specific' THEN m.id = ANY(n.target_merchant_ids)
        WHEN 'all' THEN TRUE
        WHEN 'segment' THEN CASE n.target_segment
          WHEN 'new' THEN m.created_at >= statement_timestamp() - interval '30 days'
          WHEN 'active' THEN ps.last_paid_at >= statement_timestamp() - interval '30 days'
          WHEN 'at_risk' THEN ps.last_paid_at < statement_timestamp() - interval '30 days'
            AND ps.last_paid_at >= statement_timestamp() - interval '90 days'
          ELSE FALSE END
        ELSE FALSE END
    ON CONFLICT DO NOTHING RETURNING 1
  ) SELECT COUNT(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;

CREATE FUNCTION public.renew_scheduled_notification_claim_v1(
  p_notification_id uuid, p_claim_token uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Service role claim required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notifications SET delivery_claimed_at = statement_timestamp()
  WHERE id = p_notification_id AND delivery_state = 'processing' AND sent_at IS NULL
    AND delivery_claim_token = p_claim_token;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_scheduled_notification_recipient_page_v1(
  p_notification_id uuid, p_claim_token uuid, p_after_merchant_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 500
)
RETURNS TABLE(merchant_id uuid) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' OR p_claim_token IS NULL
    OR p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'Invalid notification audience page' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications AS n WHERE n.id = p_notification_id
    AND n.delivery_state = 'processing' AND n.sent_at IS NULL AND n.delivery_claim_token = p_claim_token) THEN
    RAISE EXCEPTION 'Notification claim is no longer active' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY SELECT snapshot.merchant_id
  FROM public.admin_notification_audience_snapshot AS snapshot
  WHERE snapshot.notification_id = p_notification_id AND snapshot.claim_token = p_claim_token
    AND (p_after_merchant_id IS NULL OR snapshot.merchant_id > p_after_merchant_id)
  ORDER BY snapshot.merchant_id LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.snapshot_claimed_notification_audience_v1(uuid, uuid),
  public.renew_scheduled_notification_claim_v1(uuid, uuid),
  public.get_scheduled_notification_recipient_page_v1(uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_claimed_notification_audience_v1(uuid, uuid),
  public.renew_scheduled_notification_claim_v1(uuid, uuid),
  public.get_scheduled_notification_recipient_page_v1(uuid, uuid, uuid, integer) TO service_role;

COMMIT;
