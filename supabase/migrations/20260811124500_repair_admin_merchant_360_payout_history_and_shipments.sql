-- Keep Merchant 360 payout history visible after a merchant changes its current
-- payout currency, and count every operational shipment-exception status.
ALTER FUNCTION public.get_admin_merchant_360_v2(uuid)
  RENAME TO get_admin_merchant_360_v2_payout_history;

CREATE OR REPLACE FUNCTION public.get_admin_merchant_360_v2(p_merchant_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH base AS (
    SELECT public.get_admin_merchant_360_v2_payout_history(p_merchant_id) AS payload
  ), payout_summary AS (
    SELECT
      COUNT(*) FILTER (WHERE payout.status IN ('pending', 'processing'))::bigint AS pending_count,
      NULL::numeric AS pending_amount,
      COUNT(*) FILTER (WHERE payout.status = 'failed')::bigint AS failed_count,
      NULL::numeric AS failed_amount,
      COUNT(*) FILTER (WHERE payout.status = 'completed')::bigint AS completed_count,
      NULL::numeric AS completed_amount
    FROM public.payout_requests AS payout
    WHERE payout.merchant_id = p_merchant_id
  ), shipment_summary AS (
    SELECT COUNT(*)::bigint AS shipment_failures_30d
    FROM public.shipments AS shipment
    WHERE shipment.merchant_id = p_merchant_id
      AND LOWER(COALESCE(shipment.status, '')) IN (
        'failed', 'exception', 'shipment_exception', 'delivery_attempt_failed', 'returned'
      )
      AND shipment.updated_at >= statement_timestamp() - INTERVAL '30 days'
  )
  SELECT CASE
    WHEN base.payload IS NULL THEN NULL
    ELSE jsonb_set(
      jsonb_set(
        base.payload,
        '{payouts}',
        jsonb_build_object(
          'pendingCount', payout_summary.pending_count,
          'pendingAmount', payout_summary.pending_amount,
          'failedCount', payout_summary.failed_count,
          'failedAmount', payout_summary.failed_amount,
          'completedCount', payout_summary.completed_count,
          'completedAmount', payout_summary.completed_amount
        ),
        true
      ),
      '{incidents,shipmentFailures30d}',
      to_jsonb(shipment_summary.shipment_failures_30d),
      true
    )
  END
  FROM base
  CROSS JOIN payout_summary
  CROSS JOIN shipment_summary;
$$;

ALTER FUNCTION public.get_admin_merchant_360_v2_payout_history(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_merchant_360_v2_payout_history(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.get_admin_merchant_360_v2(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_merchant_360_v2(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_merchant_360_v2(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_admin_merchant_360_v2(uuid) IS
  'Platform-admin Merchant 360 v2. Payout requests are historical merchant activity and are not filtered by the merchant current payout currency. Payout amounts are withheld because the aggregate can span currencies; shipment incidents include all supported exception statuses.';
