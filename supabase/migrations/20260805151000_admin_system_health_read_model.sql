-- Replace the user-facing service-role database-health path with a narrow,
-- live platform-operations read model. The function exposes only bounded
-- probes and index recommendations; it never returns row data or secrets.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_admin_system_health_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $$
DECLARE
  v_checked_at text := to_char(
    clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  v_now timestamptz := statement_timestamp();
  v_has_core_commerce_data boolean;
  v_open_reviews boolean;
  v_stale_reviews boolean;
  v_payment_side_effect_failure boolean;
  v_settlement_exception boolean;
  v_payout_exception boolean;
  v_notification_failure boolean;
  v_shipping_exception boolean;
  v_event_ingress_dead_letter boolean;
  v_event_delivery_dead_letter boolean;
  v_event_delivery_unknown boolean;
  v_workers_registered boolean;
  v_worker_unhealthy boolean;
  v_checks jsonb;
  v_index_recommendations jsonb;
  v_missing_indexes jsonb;
BEGIN
  IF NOT private.has_platform_admin_permission_v1(
    (SELECT auth.uid()),
    'operations.read'
  ) THEN
    RAISE EXCEPTION 'platform_permission_denied'
      USING ERRCODE = '42501';
  END IF;

  v_has_core_commerce_data := EXISTS (SELECT 1 FROM public.merchants)
    AND EXISTS (SELECT 1 FROM public.products)
    AND EXISTS (SELECT 1 FROM public.orders);

  SELECT EXISTS (SELECT 1 FROM public.reconciliation_review AS review WHERE review.resolved_at IS NULL)
  INTO v_open_reviews;
  SELECT EXISTS (SELECT 1 FROM public.reconciliation_review AS review
    WHERE review.resolved_at IS NULL AND review.created_at < v_now - interval '24 hours')
  INTO v_stale_reviews;

  SELECT EXISTS (SELECT 1 FROM public.payment_side_effects AS side_effect
    WHERE lower(side_effect.status) = 'failed' OR (lower(side_effect.status) = 'processing'
      AND (side_effect.claimed_at IS NULL
        OR side_effect.claimed_at < v_now - interval '15 minutes')))
  INTO v_payment_side_effect_failure;

  SELECT EXISTS (SELECT 1 FROM public.merchant_settlements AS settlement
    WHERE lower(settlement.status) = 'failed' OR (settlement.expected_settlement_date < v_now
      AND lower(settlement.status) NOT IN ('settled', 'paid', 'completed', 'credited')))
  INTO v_settlement_exception;

  SELECT EXISTS (SELECT 1 FROM public.payout_requests AS payout
    WHERE lower(payout.status) = 'failed' OR (lower(payout.status) IN ('pending', 'processing')
      AND COALESCE(payout.created_at, '-infinity'::timestamptz) < v_now - interval '24 hours'))
  INTO v_payout_exception;

  SELECT EXISTS (SELECT 1 FROM public.order_notification_outbox AS notification
    WHERE notification.status = 'failed' OR (notification.status = 'processing'
      AND (notification.locked_at IS NULL
        OR notification.locked_at < v_now - interval '15 minutes')))
  INTO v_notification_failure;

  SELECT EXISTS (
    SELECT 1
    FROM public.shipping_webhook_events AS webhook
    WHERE webhook.processed IS NOT TRUE
      AND (webhook.error IS NOT NULL OR webhook.created_at < v_now - interval '15 minutes')
  ) OR EXISTS (
    SELECT 1
    FROM public.shipments AS shipment
    WHERE lower(shipment.status) IN (
      'failed', 'exception', 'shipment_exception', 'delivery_attempt_failed'
    )
      AND shipment.updated_at >= v_now - interval '24 hours'
  ) INTO v_shipping_exception;

  SELECT EXISTS (
    SELECT 1
    FROM public.domain_event_failures AS failure
    INNER JOIN public.domain_event_ledger AS event
      ON event.domain_event_id = failure.domain_event_id
    WHERE event.status = 'ingress_dead_letter'
  ) INTO v_event_ingress_dead_letter;

  SELECT EXISTS (SELECT 1 FROM public.event_deliveries AS delivery
    WHERE delivery.status = 'dead_letter') INTO v_event_delivery_dead_letter;
  SELECT EXISTS (SELECT 1 FROM public.event_deliveries AS delivery
    WHERE delivery.status = 'delivery_unknown') INTO v_event_delivery_unknown;
  SELECT EXISTS (SELECT 1 FROM public.event_pipeline_worker_heartbeats) INTO v_workers_registered;

  SELECT EXISTS (SELECT 1 FROM public.event_pipeline_worker_heartbeats AS heartbeat
    WHERE heartbeat.updated_at < v_now - interval '15 minutes' OR (heartbeat.last_error_at IS NOT NULL
      AND heartbeat.last_error_at > COALESCE(heartbeat.last_succeeded_at, '-infinity'::timestamptz)))
  INTO v_worker_unhealthy;

  v_checks := jsonb_build_array(
    jsonb_build_object(
      'check_name', 'Database query',
      'status', 'healthy',
      'message', 'PostgreSQL responded to the live operations check.',
      'details', jsonb_build_object('server_time', v_checked_at)
    ),
    jsonb_build_object(
      'check_name', 'Core commerce data',
      'status', CASE
        WHEN v_has_core_commerce_data THEN 'healthy'
        ELSE 'warning'
      END,
      'message', CASE WHEN v_has_core_commerce_data
        THEN 'Merchants, products, and orders are present.'
        ELSE 'One or more core commerce datasets have no rows.'
      END,
      'details', jsonb_build_object(
        'probe', 'bounded_existence'
      )
    ),
    jsonb_build_object(
      'check_name', 'Payment reconciliation queue',
      'status', CASE
        WHEN v_stale_reviews THEN 'critical'
        WHEN v_open_reviews THEN 'warning'
        ELSE 'healthy'
      END,
      'message', CASE
        WHEN v_stale_reviews THEN 'At least one review has been unresolved for more than 24 hours.'
        WHEN v_open_reviews THEN 'At least one review is open.'
        ELSE 'No open reconciliation reviews were found.'
      END,
      'details', jsonb_build_object(
        'open', v_open_reviews,
        'stale', v_stale_reviews,
        'probe', 'bounded_existence'
      )
    ),
    jsonb_build_object(
      'check_name', 'Payment side effects',
      'status', CASE WHEN v_payment_side_effect_failure THEN 'critical' ELSE 'healthy' END,
      'message', CASE WHEN v_payment_side_effect_failure
        THEN 'A payment side effect is failed or stale.'
        ELSE 'No failed or stale payment side effects were found.'
      END,
      'details', jsonb_build_object('probe', 'bounded_existence')
    ),
    jsonb_build_object(
      'check_name', 'Merchant settlements',
      'status', CASE WHEN v_settlement_exception THEN 'critical' ELSE 'healthy' END,
      'message', CASE WHEN v_settlement_exception
        THEN 'A settlement is failed or overdue.'
        ELSE 'No failed or overdue settlements were found.'
      END,
      'details', jsonb_build_object('probe', 'bounded_existence')
    ),
    jsonb_build_object(
      'check_name', 'Payout requests',
      'status', CASE WHEN v_payout_exception THEN 'critical' ELSE 'healthy' END,
      'message', CASE WHEN v_payout_exception
        THEN 'A payout is failed or stale.'
        ELSE 'No failed or stale payouts were found.'
      END,
      'details', jsonb_build_object('probe', 'bounded_existence')
    ),
    jsonb_build_object(
      'check_name', 'Shipping operations',
      'status', CASE WHEN v_shipping_exception THEN 'critical' ELSE 'healthy' END,
      'message', CASE WHEN v_shipping_exception
        THEN 'A shipment exception or unprocessed shipping webhook needs attention.'
        ELSE 'No shipment exceptions or stale shipping webhooks were found.'
      END,
      'details', jsonb_build_object('probe', 'bounded_existence')
    ),
    jsonb_build_object(
      'check_name', 'Event pipeline dead letters',
      'status', CASE
        WHEN v_event_ingress_dead_letter OR v_event_delivery_dead_letter THEN 'critical'
        WHEN v_event_delivery_unknown THEN 'warning'
        ELSE 'healthy'
      END,
      'message', CASE
        WHEN v_event_ingress_dead_letter OR v_event_delivery_dead_letter
          THEN 'An ingress or delivery dead letter requires operator review.'
        WHEN v_event_delivery_unknown
          THEN 'A delivery outcome is unknown and needs investigation.'
        ELSE 'No active ingress or delivery dead letters were found.'
      END,
      'details', jsonb_build_object('probe', 'bounded_existence')
    ),
    jsonb_build_object(
      'check_name', 'Event pipeline workers',
      'status', CASE
        WHEN NOT v_workers_registered THEN 'warning'
        WHEN v_worker_unhealthy THEN 'critical'
        ELSE 'healthy'
      END,
      'message', CASE
        WHEN NOT v_workers_registered
          THEN 'No worker heartbeat is registered; no expected-worker registry is configured.'
        WHEN v_worker_unhealthy
          THEN 'At least one registered worker is stale or last reported an error.'
        ELSE 'All registered workers have recent successful heartbeats.'
      END,
      'details', jsonb_build_object(
        'registry', 'observed_heartbeats',
        'registered', v_workers_registered,
        'probe', 'bounded_existence'
      )
    ),
    jsonb_build_object(
      'check_name', 'Order notifications',
      'status', CASE WHEN v_notification_failure THEN 'warning' ELSE 'healthy' END,
      'message', CASE WHEN v_notification_failure
        THEN 'A notification delivery is failed or stale.'
        ELSE 'No failed or stale order notifications were found.'
      END,
      'details', jsonb_build_object('probe', 'bounded_existence')
    )
  );

  SELECT COALESCE(jsonb_agg(to_jsonb(recommendation)), '[]'::jsonb)
  INTO v_index_recommendations
  FROM (
    SELECT
      stats.relname::text AS table_name,
      'Review table indexes'::text AS index_name,
      CASE
        WHEN stats.idx_scan = 0 AND stats.seq_scan > 0
          THEN 'No index scans are recorded for this active table.'
        ELSE 'Sequential scans substantially exceed index scans.'
      END::text AS reason,
      CASE
        WHEN stats.seq_scan > 1000 AND stats.n_live_tup > 10000 THEN 'high'
        WHEN stats.seq_scan > 100 AND stats.n_live_tup > 1000 THEN 'medium'
        ELSE 'low'
      END::text AS priority
    FROM pg_catalog.pg_stat_user_tables AS stats
    WHERE stats.schemaname = 'public'
      AND stats.n_live_tup > 100
      AND (
        (stats.idx_scan = 0 AND stats.seq_scan > 0)
        OR stats.seq_scan > COALESCE(stats.idx_scan, 0) * 10
      )
    ORDER BY stats.seq_scan DESC, stats.relname ASC
    LIMIT 25
  ) AS recommendation;

  SELECT COALESCE(
    jsonb_agg(suggestion.suggested_index ORDER BY suggestion.table_name),
    '[]'::jsonb
  )
  INTO v_missing_indexes
  FROM public.get_missing_index_suggestions() AS suggestion;

  RETURN jsonb_build_object(
    'health', v_checks,
    'indexRecommendations', v_index_recommendations,
    'missingIndexes', v_missing_indexes,
    'checkedAt', v_checked_at
  );
END;
$$;

ALTER FUNCTION public.get_admin_system_health_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_system_health_v1()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_system_health_v1()
  TO authenticated;

-- The legacy helper exposed schema introspection directly. It is now reachable
-- only through the permission-gated read model above.
REVOKE ALL ON FUNCTION public.get_missing_index_suggestions()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_admin_system_health_v1() IS
  'Returns bounded live database and operations health to callers with operations.read.';

COMMIT;
