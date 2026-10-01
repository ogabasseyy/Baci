-- Platform-admin authority is an account role, not a reason to remove a real
-- merchant from merchant-facing notification audiences. Preserve dual-role
-- merchants while still excluding rows that are not attached to a user.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_admin_notification_segment_merchant_ids(
  p_segment text
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_segment NOT IN ('new', 'active', 'at_risk') THEN
    RAISE EXCEPTION 'Invalid notification segment' USING ERRCODE = '22023';
  END IF;

  WITH paid_sales AS (
    SELECT o.merchant_id,
      MAX(COALESCE(o.paid_at, o.updated_at, o.created_at)) AS last_paid_at
    FROM public.orders AS o
    WHERE LOWER(BTRIM(o.payment_status)) = 'paid'
    GROUP BY o.merchant_id
  )
  SELECT COALESCE(array_agg(m.id ORDER BY m.id), '{}'::uuid[])
    INTO v_ids
  FROM public.merchants AS m
  LEFT JOIN paid_sales AS ps ON ps.merchant_id = m.id
  WHERE m.user_id IS NOT NULL
    AND CASE p_segment
      WHEN 'new' THEN m.created_at >= statement_timestamp() - interval '30 days'
      WHEN 'active' THEN ps.last_paid_at >= statement_timestamp() - interval '30 days'
      WHEN 'at_risk' THEN ps.last_paid_at < statement_timestamp() - interval '30 days'
        AND ps.last_paid_at >= statement_timestamp() - interval '90 days'
      ELSE FALSE
    END;

  RETURN v_ids;
END;
$$;

CREATE OR REPLACE FUNCTION public.snapshot_claimed_notification_audience_v1(
  p_notification_id uuid,
  p_claim_token uuid
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count bigint;
BEGIN
  IF NOT public.renew_scheduled_notification_claim_v1(
    p_notification_id,
    p_claim_token
  ) THEN
    RAISE EXCEPTION 'Notification claim is no longer active'
      USING ERRCODE = 'P0002';
  END IF;

  WITH notification AS (
    SELECT n.target_type,
      COALESCE(n.target_merchant_ids, '{}'::uuid[]) AS target_merchant_ids,
      n.target_segment
    FROM public.notifications AS n
    WHERE n.id = p_notification_id
  ), paid_sales AS (
    SELECT o.merchant_id,
      MAX(COALESCE(o.paid_at, o.updated_at, o.created_at)) AS last_paid_at
    FROM public.orders AS o
    WHERE LOWER(BTRIM(o.payment_status)) = 'paid'
    GROUP BY o.merchant_id
  ), inserted AS (
    INSERT INTO public.admin_notification_audience_snapshot (
      notification_id,
      claim_token,
      merchant_id
    )
    SELECT p_notification_id, p_claim_token, m.id
    FROM public.merchants AS m
    CROSS JOIN notification AS n
    LEFT JOIN paid_sales AS ps ON ps.merchant_id = m.id
    WHERE m.user_id IS NOT NULL
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
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;

ALTER FUNCTION public.get_admin_notification_segment_merchant_ids(text)
  OWNER TO postgres;
ALTER FUNCTION public.snapshot_claimed_notification_audience_v1(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  public.get_admin_notification_segment_merchant_ids(text),
  public.snapshot_claimed_notification_audience_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.get_admin_notification_segment_merchant_ids(text),
  public.snapshot_claimed_notification_audience_v1(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.get_admin_notification_segment_merchant_ids(text) IS
  'Worker-only merchant segments. Dual-role platform admins remain eligible merchants.';
COMMENT ON FUNCTION public.snapshot_claimed_notification_audience_v1(uuid, uuid) IS
  'Snapshots the claim-bound merchant audience without conflating platform-admin authority with merchant eligibility.';

COMMIT;
