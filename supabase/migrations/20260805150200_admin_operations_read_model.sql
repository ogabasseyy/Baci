-- Platform-admin read model for operational triage. The response deliberately
-- excludes customer, merchant-contact, token, payload, and provider metadata.
-- Operators inspect an incident here, then use the owned operational workflow
-- rather than treating a dashboard as a universal replay surface.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_admin_operations_v1(
  p_section text DEFAULT 'all',
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 25), 100));
  v_offset integer := GREATEST(0, LEAST(COALESCE(p_offset, 0), 10000));
  v_now timestamptz := statement_timestamp();
  v_can_read_financials boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1(
    (SELECT auth.uid()),
    'operations.read'
  ) THEN
    RAISE EXCEPTION 'Platform admin access required' USING ERRCODE = '42501';
  END IF;

  IF p_section NOT IN ('all', 'financial', 'notifications', 'shipping', 'workers') THEN
    RAISE EXCEPTION 'Invalid operations section' USING ERRCODE = '22023';
  END IF;
  v_can_read_financials := private.has_platform_admin_permission_v1(
    (SELECT auth.uid()), 'financials.read'
  );

  RETURN (
    WITH
    unresolved_reconciliation AS MATERIALIZED (
      SELECT rr.id, rr.merchant_id, rr.issue_type, rr.created_at,
        COALESCE(m.business_name, 'Unnamed merchant') AS merchant_name
      FROM public.reconciliation_review rr
      LEFT JOIN public.merchants m ON m.id = rr.merchant_id
      WHERE rr.resolved_at IS NULL
      ORDER BY rr.created_at DESC
      LIMIT v_limit OFFSET v_offset
    ),
    payment_side_effect_failures AS MATERIALIZED (
      SELECT pse.order_id, o.merchant_id, pse.step, pse.status, pse.attempts,
        pse.claimed_at, COALESCE(m.business_name, 'Unnamed merchant') AS merchant_name
      FROM public.payment_side_effects pse
      INNER JOIN public.orders o ON o.id = pse.order_id
      LEFT JOIN public.merchants m ON m.id = o.merchant_id
      WHERE LOWER(COALESCE(pse.status, '')) = 'failed'
        OR (
          LOWER(COALESCE(pse.status, '')) = 'processing'
          AND (pse.claimed_at IS NULL OR pse.claimed_at < v_now - interval '15 minutes')
        )
      ORDER BY pse.claimed_at DESC
      LIMIT v_limit OFFSET v_offset
    ),
    settlement_review AS MATERIALIZED (
      SELECT ms.id, ms.merchant_id, ms.status, ms.gateway, ms.net_amount,
        ms.expected_settlement_date, ms.created_at,
        'UNK'::text AS currency,
        COALESCE(m.business_name, 'Unnamed merchant') AS merchant_name
      FROM public.merchant_settlements ms
      LEFT JOIN public.merchants m ON m.id = ms.merchant_id
      WHERE v_can_read_financials AND (LOWER(COALESCE(ms.status, '')) = 'failed'
        OR (
          ms.expected_settlement_date < v_now::date
          AND LOWER(COALESCE(ms.status, '')) NOT IN ('settled', 'paid', 'completed', 'credited', 'cancelled', 'direct')
        ))
      ORDER BY ms.expected_settlement_date ASC, ms.created_at DESC
      LIMIT v_limit OFFSET v_offset
    ),
    payout_review AS MATERIALIZED (
      SELECT p.id, p.merchant_id, p.status, p.amount,
        CASE WHEN UPPER(COALESCE(NULLIF(BTRIM(p.currency), ''), 'UNK')) ~ '^[A-Z]{3}$'
          THEN UPPER(COALESCE(NULLIF(BTRIM(p.currency), ''), 'UNK')) ELSE 'UNK' END AS currency,
        'merchant_wallet'::text AS payout_mode, p.created_at, p.processed_at,
        COALESCE(m.business_name, 'Unnamed merchant') AS merchant_name
      FROM public.payout_requests p
      LEFT JOIN public.merchants m ON m.id = p.merchant_id
      WHERE v_can_read_financials AND (LOWER(COALESCE(p.status, '')) = 'failed'
        OR (
          LOWER(COALESCE(p.status, '')) IN ('pending', 'processing')
          AND COALESCE(p.created_at, '-infinity'::timestamptz)
            < v_now - interval '24 hours'
        ))
      ORDER BY p.created_at DESC NULLS LAST
      LIMIT v_limit OFFSET v_offset
    ),
    failed_email AS MATERIALIZED (
      SELECT esa.id, esa.merchant_id, esa.provider, esa.email_type,
        esa.provider_error_code, esa.attempt_count, esa.created_at,
        COALESCE(m.business_name, 'Platform message') AS merchant_name
      FROM public.email_send_attempts esa
      LEFT JOIN public.merchants m ON m.id = esa.merchant_id
      WHERE esa.status = 'failed'
      ORDER BY esa.created_at DESC
      LIMIT v_limit OFFSET v_offset
    ),
    failed_push AS MATERIALIZED (
      SELECT pna.id, pna.merchant_id, pna.app_type, pna.notification_type,
        pna.status, pna.failed_count, pna.created_at,
        COALESCE(m.business_name, 'Platform message') AS merchant_name
      FROM public.push_notification_attempts pna
      LEFT JOIN public.merchants m ON m.id = pna.merchant_id
      WHERE pna.status IN ('failed', 'partial_failure')
      ORDER BY pna.created_at DESC
      LIMIT v_limit OFFSET v_offset
    ),
    order_notification_failures AS MATERIALIZED (
      SELECT ono.id, ono.order_id, ono.merchant_id, ono.event_type, ono.status,
        ono.attempt_count, ono.max_attempts, ono.created_at,
        COALESCE(m.business_name, 'Unnamed merchant') AS merchant_name
      FROM public.order_notification_outbox ono
      LEFT JOIN public.merchants m ON m.id = ono.merchant_id
      WHERE ono.status = 'failed'
        OR (ono.status = 'processing' AND (ono.locked_at IS NULL OR ono.locked_at < v_now - interval '15 minutes'))
      ORDER BY ono.created_at DESC
      LIMIT v_limit OFFSET v_offset
    ),
    tracking_notification_failures AS MATERIALIZED (
      SELECT stno.id, stno.order_id, stno.merchant_id, stno.audience,
        stno.notification_kind, stno.status, stno.attempt_count, stno.max_attempts,
        stno.created_at,
        COALESCE(m.business_name, 'Unnamed merchant') AS merchant_name
      FROM public.shipment_tracking_notification_outbox stno
      LEFT JOIN public.merchants m ON m.id = stno.merchant_id
      WHERE stno.status = 'failed'
        OR (stno.status = 'processing' AND (stno.locked_at IS NULL OR stno.locked_at < v_now - interval '15 minutes'))
      ORDER BY stno.created_at DESC
      LIMIT v_limit OFFSET v_offset
    ),
    shipping_webhook_failures AS MATERIALIZED (
      SELECT swe.id, swe.shipment_id, swe.provider, swe.event_type,
        swe.processed, swe.created_at
      FROM public.shipping_webhook_events swe
      WHERE swe.processed IS NOT TRUE
        AND (
          swe.error IS NOT NULL
          OR swe.created_at < v_now - interval '15 minutes'
        )
      ORDER BY swe.created_at DESC NULLS LAST
      LIMIT v_limit OFFSET v_offset
    ),
    shipment_failures AS MATERIALIZED (
      SELECT s.id, s.order_id, s.merchant_id, s.provider, s.status, s.updated_at,
        COALESCE(m.business_name, 'Unnamed merchant') AS merchant_name
      FROM public.shipments s
      LEFT JOIN public.merchants m ON m.id = s.merchant_id
      WHERE LOWER(COALESCE(s.status, '')) IN (
        'failed', 'exception', 'shipment_exception', 'delivery_attempt_failed',
        'returned'
      )
      ORDER BY s.updated_at DESC NULLS LAST
      LIMIT v_limit OFFSET v_offset
    ),
    workers AS MATERIALIZED (
      SELECT eph.worker_id, eph.worker_name, eph.processed_count,
        eph.last_succeeded_at, eph.last_error_at, eph.last_error_code, eph.updated_at,
        CASE
          WHEN eph.updated_at < v_now - interval '15 minutes' THEN 'stale'
          WHEN eph.last_error_at IS NOT NULL
            AND eph.last_error_at > COALESCE(eph.last_succeeded_at, '-infinity'::timestamptz)
            THEN 'error'
          ELSE 'healthy'
        END AS state
      FROM public.event_pipeline_worker_heartbeats eph
      ORDER BY eph.updated_at DESC
      LIMIT v_limit OFFSET v_offset
    ),
    counts AS MATERIALIZED (
      SELECT
        (SELECT COUNT(*) FROM public.reconciliation_review WHERE resolved_at IS NULL)::bigint AS reconciliation_review,
        (SELECT COUNT(*) FROM public.payment_side_effects pse
          WHERE LOWER(COALESCE(pse.status, '')) = 'failed'
            OR (LOWER(COALESCE(pse.status, '')) = 'processing' AND (pse.claimed_at IS NULL
              OR pse.claimed_at < v_now - interval '15 minutes')))::bigint AS payment_side_effects,
        CASE WHEN v_can_read_financials THEN (SELECT COUNT(*) FROM public.merchant_settlements ms
          WHERE LOWER(COALESCE(ms.status, '')) = 'failed'
            OR (ms.expected_settlement_date < v_now::date
              AND LOWER(COALESCE(ms.status, '')) NOT IN ('settled', 'paid', 'completed', 'credited', 'cancelled', 'direct')))
          ELSE 0 END::bigint AS settlements,
        CASE WHEN v_can_read_financials THEN (SELECT COUNT(*) FROM public.payout_requests p
          WHERE LOWER(COALESCE(p.status, '')) = 'failed'
            OR (LOWER(COALESCE(p.status, '')) IN ('pending', 'processing')
              AND COALESCE(p.created_at, '-infinity'::timestamptz)
                < v_now - interval '24 hours')) ELSE 0 END::bigint AS payouts,
        ((SELECT COUNT(*) FROM public.email_send_attempts WHERE status = 'failed') +
          (SELECT COUNT(*) FROM public.push_notification_attempts WHERE status IN ('failed', 'partial_failure')) +
          (SELECT COUNT(*) FROM public.order_notification_outbox
            WHERE status = 'failed' OR (status = 'processing' AND (locked_at IS NULL OR locked_at < v_now - interval '15 minutes'))) +
          (SELECT COUNT(*) FROM public.shipment_tracking_notification_outbox
            WHERE status = 'failed' OR (status = 'processing' AND (locked_at IS NULL OR locked_at < v_now - interval '15 minutes'))))::bigint AS notifications,
        ((SELECT COUNT(*) FROM public.shipping_webhook_events
            WHERE processed IS NOT TRUE
              AND (error IS NOT NULL OR created_at < v_now - interval '15 minutes')) +
          (SELECT COUNT(*) FROM public.shipments
            WHERE LOWER(COALESCE(status, '')) IN ('failed', 'exception', 'shipment_exception', 'delivery_attempt_failed', 'returned')))::bigint AS shipping,
        (SELECT COUNT(*) FROM public.event_pipeline_worker_heartbeats eph
          WHERE eph.updated_at < v_now - interval '15 minutes'
            OR (eph.last_error_at IS NOT NULL
              AND eph.last_error_at > COALESCE(eph.last_succeeded_at, '-infinity'::timestamptz)))::bigint AS workers
    )
    SELECT jsonb_build_object(
      'generatedAt', v_now,
      'summary', jsonb_build_object(
        'notifications', counts.notifications,
        'paymentSideEffects', counts.payment_side_effects,
        'payouts', counts.payouts,
        'reconciliationReview', counts.reconciliation_review,
        'settlements', counts.settlements,
        'shipping', counts.shipping,
        'workers', counts.workers
      ),
      'financial', CASE WHEN p_section IN ('all', 'financial') THEN jsonb_build_object(
        'paymentSideEffects', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'attempts', attempts, 'claimedAt', claimed_at, 'merchantId', merchant_id,
          'merchantName', merchant_name, 'orderId', order_id, 'status', status, 'step', step
        )) FROM payment_side_effect_failures), '[]'::jsonb),
        'payouts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'amount', amount, 'createdAt', created_at, 'currency', currency, 'id', id,
          'merchantId', merchant_id, 'merchantName', merchant_name, 'payoutMode', payout_mode,
          'processedAt', processed_at, 'status', status
        )) FROM payout_review), '[]'::jsonb),
        'reconciliationReview', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'createdAt', created_at, 'id', id, 'issueType', issue_type,
          'merchantId', merchant_id, 'merchantName', merchant_name
        )) FROM unresolved_reconciliation), '[]'::jsonb),
        'settlements', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'createdAt', created_at, 'currency', currency, 'expectedSettlementDate', expected_settlement_date,
          'gateway', gateway, 'id', id, 'merchantId', merchant_id, 'merchantName', merchant_name,
          'netAmount', net_amount, 'status', status
        )) FROM settlement_review), '[]'::jsonb)
      ) ELSE jsonb_build_object('paymentSideEffects', '[]'::jsonb, 'payouts', '[]'::jsonb, 'reconciliationReview', '[]'::jsonb, 'settlements', '[]'::jsonb) END,
      'notifications', CASE WHEN p_section IN ('all', 'notifications') THEN jsonb_build_object(
        'email', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'attemptCount', attempt_count, 'createdAt', created_at, 'emailType', email_type,
          'id', id, 'merchantId', merchant_id, 'merchantName', merchant_name,
          'provider', provider, 'providerErrorCode', provider_error_code
        )) FROM failed_email), '[]'::jsonb),
        'orderOutbox', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'attemptCount', attempt_count, 'createdAt', created_at, 'eventType', event_type,
          'id', id, 'maxAttempts', max_attempts, 'merchantId', merchant_id,
          'merchantName', merchant_name, 'orderId', order_id, 'status', status
        )) FROM order_notification_failures), '[]'::jsonb),
        'push', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'appType', app_type, 'createdAt', created_at, 'failedCount', failed_count,
          'id', id, 'merchantId', merchant_id, 'merchantName', merchant_name,
          'notificationType', notification_type, 'status', status
        )) FROM failed_push), '[]'::jsonb),
        'trackingOutbox', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'attemptCount', attempt_count, 'audience', audience, 'createdAt', created_at,
          'id', id, 'merchantId', merchant_id, 'merchantName', merchant_name,
          'notificationKind', notification_kind, 'orderId', order_id, 'status', status
        )) FROM tracking_notification_failures), '[]'::jsonb)
      ) ELSE jsonb_build_object('email', '[]'::jsonb, 'orderOutbox', '[]'::jsonb, 'push', '[]'::jsonb, 'trackingOutbox', '[]'::jsonb) END,
      'shipping', CASE WHEN p_section IN ('all', 'shipping') THEN jsonb_build_object(
        'shipments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', id, 'merchantId', merchant_id, 'merchantName', merchant_name,
          'orderId', order_id, 'provider', provider, 'status', status, 'updatedAt', updated_at
        )) FROM shipment_failures), '[]'::jsonb),
        'webhooks', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'createdAt', created_at, 'eventType', event_type, 'id', id,
          'processed', processed, 'provider', provider, 'shipmentId', shipment_id
        )) FROM shipping_webhook_failures), '[]'::jsonb)
      ) ELSE jsonb_build_object('shipments', '[]'::jsonb, 'webhooks', '[]'::jsonb) END,
      'workers', CASE WHEN p_section IN ('all', 'workers') THEN COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'lastErrorAt', last_error_at, 'lastErrorCode', last_error_code,
        'lastSucceededAt', last_succeeded_at, 'processedCount', processed_count,
        'state', state, 'updatedAt', updated_at, 'workerId', worker_id, 'workerName', worker_name
      )) FROM workers), '[]'::jsonb) ELSE '[]'::jsonb END
    ) FROM counts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_operations_v1(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_operations_v1(text, integer, integer)
  TO authenticated;

COMMENT ON FUNCTION public.get_admin_operations_v1(text, integer, integer) IS
  'Platform-admin operational read model. Redacts raw payloads, provider metadata, contact data, and secrets.';

COMMIT;
