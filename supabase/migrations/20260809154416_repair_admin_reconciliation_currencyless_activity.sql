-- Currency-less settlement ledger rows are operational activity, but cannot
-- contribute to a selected-currency money total. Include the rows and counts
-- while preserving null amount/currency projections.
CREATE OR REPLACE FUNCTION public.get_admin_reconciliation_v3(
  p_period text DEFAULT '30d', p_currency text DEFAULT NULL,
  p_merchant_id uuid DEFAULT NULL, p_lane text DEFAULT 'all',
  p_status text DEFAULT 'all', p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL, p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '8s'
AS $$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_platform_start timestamptz := timestamp '2025-12-18 00:00:00' AT TIME ZONE 'Africa/Lagos';
  v_start_at timestamptz;
  v_limit integer;
  v_result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1(
    (SELECT auth.uid()), 'financials.read'
  ) THEN
    RAISE EXCEPTION 'Platform admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_period NOT IN ('7d', '30d', '90d', 'all') THEN
    RAISE EXCEPTION 'Invalid reconciliation period' USING ERRCODE = '22023';
  END IF;
  IF p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' OR p_currency = 'UNK' THEN
    RAISE EXCEPTION 'Invalid reconciliation currency' USING ERRCODE = '22023';
  END IF;
  IF p_lane NOT IN ('all', 'platform_settlement', 'direct_settlement', 'payout_request', 'refund', 'review')
    OR p_status NOT IN ('all', 'pending', 'processing', 'settled', 'failed', 'completed', 'refunded', 'refund_pending', 'open', 'direct') THEN
    RAISE EXCEPTION 'Invalid reconciliation filter' USING ERRCODE = '22023';
  END IF;
  IF (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'Both pagination cursor fields are required' USING ERRCODE = '22023';
  END IF;
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_start_at := CASE p_period WHEN '7d' THEN v_now - interval '7 days'
    WHEN '30d' THEN v_now - interval '30 days' WHEN '90d' THEN v_now - interval '90 days'
    ELSE v_platform_start END;

  WITH settlement_rows AS MATERIALIZED (
    SELECT ms.id, ms.merchant_id, ms.status, ms.net_amount, ms.gateway,
      COALESCE(ms.created_at, v_platform_start) AS occurred_at
    FROM public.merchant_settlements ms
    WHERE COALESCE(ms.created_at, v_platform_start) >= v_start_at
      AND COALESCE(ms.created_at, v_platform_start) < v_now
      AND (p_merchant_id IS NULL OR ms.merchant_id = p_merchant_id)
  ), paid_orders AS MATERIALIZED (
    SELECT o.merchant_id, COALESCE(o.total, 0)::numeric AS amount
    FROM public.orders o
    WHERE LOWER(BTRIM(COALESCE(o.payment_status, ''))) = 'paid'
      AND COALESCE(o.created_at, v_platform_start) >= v_start_at
      AND COALESCE(o.created_at, v_platform_start) < v_now
      AND (p_merchant_id IS NULL OR o.merchant_id = p_merchant_id)
      AND UPPER(COALESCE(NULLIF(BTRIM(o.currency), ''), 'UNK')) = p_currency
  ), captured_payments AS MATERIALIZED (
    SELECT t.merchant_id, COALESCE(t.amount, 0)::numeric AS amount
    FROM public.transactions t
    WHERE t.transaction_type = 'payment' AND t.status = 'completed'
      AND COALESCE(t.created_at, v_platform_start) >= v_start_at
      AND COALESCE(t.created_at, v_platform_start) < v_now
      AND (p_merchant_id IS NULL OR t.merchant_id = p_merchant_id)
      AND UPPER(COALESCE(NULLIF(BTRIM(t.currency), ''), 'UNK')) = p_currency
  ), settlement_metrics AS MATERIALIZED (
    SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'processing'))::bigint AS pending_count,
      COUNT(*) FILTER (WHERE status = 'settled')::bigint AS settled_count,
      COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed_count
    FROM settlement_rows
  ), direct_metrics AS MATERIALIZED (
    SELECT COUNT(*)::bigint AS count FROM settlement_rows WHERE status = 'direct'
  ), payout_metrics AS MATERIALIZED (
    SELECT COALESCE(SUM(pr.amount) FILTER (WHERE pr.status IN ('pending', 'processing')), 0)::numeric AS pending_amount,
      COALESCE(SUM(pr.amount) FILTER (WHERE pr.status = 'completed'), 0)::numeric AS completed_amount,
      COALESCE(SUM(pr.amount) FILTER (WHERE pr.status = 'failed'), 0)::numeric AS failed_amount,
      COUNT(*) FILTER (WHERE pr.status IN ('pending', 'processing'))::bigint AS pending_count,
      COUNT(*) FILTER (WHERE pr.status = 'completed')::bigint AS completed_count,
      COUNT(*) FILTER (WHERE pr.status = 'failed')::bigint AS failed_count
    FROM public.payout_requests pr
    WHERE COALESCE(pr.created_at, v_platform_start) >= v_start_at
      AND COALESCE(pr.created_at, v_platform_start) < v_now
      AND (p_merchant_id IS NULL OR pr.merchant_id = p_merchant_id)
      AND UPPER(COALESCE(NULLIF(BTRIM(pr.currency), ''), 'UNK')) = p_currency
  ), refund_metrics AS MATERIALIZED (
    SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.status IN ('completed', 'refunded')), 0)::numeric AS refunded_amount,
      COALESCE(SUM(t.amount) FILTER (WHERE t.status = 'refund_pending'), 0)::numeric AS pending_amount,
      COUNT(*) FILTER (WHERE t.status IN ('completed', 'refunded'))::bigint AS refunded_count,
      COUNT(*) FILTER (WHERE t.status = 'refund_pending')::bigint AS pending_count
    FROM public.transactions t
    WHERE ((t.transaction_type = 'refund' AND t.status IN ('completed', 'refunded', 'refund_pending'))
        OR (t.transaction_type = 'payment' AND t.status IN ('refunded', 'refund_pending')))
      AND COALESCE(t.created_at, v_platform_start) >= v_start_at
      AND COALESCE(t.created_at, v_platform_start) < v_now
      AND (p_merchant_id IS NULL OR t.merchant_id = p_merchant_id)
      AND UPPER(COALESCE(NULLIF(BTRIM(t.currency), ''), 'UNK')) = p_currency
  ), wallet_metrics AS MATERIALIZED (
    SELECT COALESCE(SUM(mw.available_balance), 0)::numeric AS available_amount,
      COALESCE(SUM(mw.pending_balance), 0)::numeric AS pending_amount,
      COALESCE(SUM(mw.upcoming_balance), 0)::numeric AS upcoming_amount
    FROM public.merchant_wallets mw INNER JOIN public.merchants m ON m.id = mw.merchant_id
    WHERE (p_merchant_id IS NULL OR mw.merchant_id = p_merchant_id)
      AND UPPER(COALESCE(NULLIF(BTRIM(m.payout_currency), ''), 'UNK')) = p_currency
  ), review_metrics AS MATERIALIZED (
    SELECT COUNT(*)::bigint AS open_count FROM public.reconciliation_review rr
    WHERE rr.resolved_at IS NULL AND (p_merchant_id IS NULL OR rr.merchant_id = p_merchant_id)
  ), currency_values AS MATERIALIZED (
    SELECT UPPER(COALESCE(NULLIF(BTRIM(o.currency), ''), 'UNK')) AS currency FROM public.orders o
    WHERE LOWER(BTRIM(COALESCE(o.payment_status, ''))) = 'paid'
      AND COALESCE(o.created_at, v_platform_start) >= v_start_at AND COALESCE(o.created_at, v_platform_start) < v_now
      AND (p_merchant_id IS NULL OR o.merchant_id = p_merchant_id)
    UNION ALL SELECT UPPER(COALESCE(NULLIF(BTRIM(t.currency), ''), 'UNK')) FROM public.transactions t
    WHERE ((t.transaction_type = 'payment' AND t.status IN ('completed', 'refunded', 'refund_pending'))
      OR (t.transaction_type = 'refund' AND t.status IN ('completed', 'refunded', 'refund_pending')))
      AND COALESCE(t.created_at, v_platform_start) >= v_start_at AND COALESCE(t.created_at, v_platform_start) < v_now
      AND (p_merchant_id IS NULL OR t.merchant_id = p_merchant_id)
    UNION ALL SELECT UPPER(COALESCE(NULLIF(BTRIM(pr.currency), ''), 'UNK')) FROM public.payout_requests pr
    WHERE pr.status IN ('pending', 'processing', 'completed', 'failed')
      AND COALESCE(pr.created_at, v_platform_start) >= v_start_at AND COALESCE(pr.created_at, v_platform_start) < v_now
      AND (p_merchant_id IS NULL OR pr.merchant_id = p_merchant_id)
    UNION ALL SELECT UPPER(COALESCE(NULLIF(BTRIM(m.payout_currency), ''), 'UNK')) FROM public.merchant_wallets mw
      INNER JOIN public.merchants m ON m.id = mw.merchant_id
    WHERE p_merchant_id IS NULL OR mw.merchant_id = p_merchant_id
  ), supported_currencies AS MATERIALIZED (
    SELECT COALESCE(jsonb_agg(currency ORDER BY currency), '[]'::jsonb) AS currencies
    FROM (SELECT DISTINCT cv.currency FROM currency_values cv WHERE cv.currency ~ '^[A-Z]{3}$' AND cv.currency <> 'UNK') AS currency_rows
  ), events AS MATERIALIZED (
    SELECT sr.id, sr.occurred_at, sr.merchant_id, 'platform_settlement'::text AS lane, sr.status,
      NULL::numeric AS amount, COALESCE(NULLIF(BTRIM(sr.gateway), ''), 'unknown') AS provider,
      NULL::text AS issue_type, NULL::text AS currency FROM settlement_rows sr
    WHERE sr.status IN ('pending', 'processing', 'settled', 'failed')
    UNION ALL SELECT sr.id, sr.occurred_at, sr.merchant_id, 'direct_settlement', 'direct', NULL::numeric,
      COALESCE(NULLIF(BTRIM(sr.gateway), ''), 'unknown'), NULL::text, NULL::text FROM settlement_rows sr WHERE sr.status = 'direct'
    UNION ALL SELECT pr.id, COALESCE(pr.created_at, v_platform_start), pr.merchant_id, 'payout_request', pr.status,
      COALESCE(pr.amount, 0)::numeric, 'merchant_wallet', NULL::text, UPPER(COALESCE(NULLIF(BTRIM(pr.currency), ''), 'UNK'))
    FROM public.payout_requests pr WHERE pr.status IN ('pending', 'processing', 'completed', 'failed')
      AND COALESCE(pr.created_at, v_platform_start) >= v_start_at AND COALESCE(pr.created_at, v_platform_start) < v_now
      AND (p_merchant_id IS NULL OR pr.merchant_id = p_merchant_id) AND UPPER(COALESCE(NULLIF(BTRIM(pr.currency), ''), 'UNK')) = p_currency
    UNION ALL SELECT t.id, COALESCE(t.created_at, v_platform_start), t.merchant_id, 'refund', t.status,
      COALESCE(t.amount, 0)::numeric, COALESCE(NULLIF(BTRIM(t.gateway), ''), 'unknown'), NULL::text,
      UPPER(COALESCE(NULLIF(BTRIM(t.currency), ''), 'UNK')) FROM public.transactions t
    WHERE ((t.transaction_type = 'refund' AND t.status IN ('completed', 'refunded', 'refund_pending'))
      OR (t.transaction_type = 'payment' AND t.status IN ('refunded', 'refund_pending')))
      AND COALESCE(t.created_at, v_platform_start) >= v_start_at AND COALESCE(t.created_at, v_platform_start) < v_now
      AND (p_merchant_id IS NULL OR t.merchant_id = p_merchant_id) AND UPPER(COALESCE(NULLIF(BTRIM(t.currency), ''), 'UNK')) = p_currency
    UNION ALL SELECT rr.id, COALESCE(rr.created_at, v_platform_start), rr.merchant_id, 'review', 'open', 0::numeric,
      'reconciliation', rr.issue_type, NULL::text FROM public.reconciliation_review rr
    WHERE rr.resolved_at IS NULL AND (p_merchant_id IS NULL OR rr.merchant_id = p_merchant_id)
  ), filtered_events AS MATERIALIZED (
    SELECT e.*, COALESCE(NULLIF(BTRIM(m.business_name), ''), 'Unnamed merchant') AS merchant_name
    FROM events e LEFT JOIN public.merchants m ON m.id = e.merchant_id
    WHERE (p_lane = 'all' OR e.lane = p_lane) AND (p_status = 'all' OR e.status = p_status)
      AND (p_cursor_created_at IS NULL OR e.occurred_at < p_cursor_created_at
        OR (e.occurred_at = p_cursor_created_at AND e.id < p_cursor_id))
  ), paged_events AS (
    SELECT * FROM filtered_events ORDER BY occurred_at DESC NULLS LAST, id DESC LIMIT v_limit + 1
  ), page_events AS (
    SELECT * FROM paged_events ORDER BY occurred_at DESC NULLS LAST, id DESC LIMIT v_limit
  ), page_meta AS (SELECT COUNT(*) > v_limit AS has_next_page FROM paged_events)
  SELECT jsonb_build_object(
    'generatedAt', v_now, 'periodStart', v_start_at, 'currency', p_currency,
    'supportedCurrencies', (SELECT currencies FROM supported_currencies), 'reviewScope', 'all_unresolved',
    'metrics', jsonb_build_object(
      'paidOrderGmv', (SELECT COALESCE(SUM(amount), 0) FROM paid_orders),
      'capturedPayments', (SELECT COALESCE(SUM(amount), 0) FROM captured_payments),
      'platformSettlements', jsonb_build_object('pendingAmount', NULL, 'pendingCount', sm.pending_count,
        'settledAmount', NULL, 'settledCount', sm.settled_count, 'failedAmount', NULL, 'failedCount', sm.failed_count),
      'directSettlements', jsonb_build_object('amount', NULL, 'count', dm.count),
      'wallet', jsonb_build_object('availableAmount', wm.available_amount, 'pendingAmount', wm.pending_amount, 'upcomingAmount', wm.upcoming_amount),
      'payoutRequests', jsonb_build_object('pendingAmount', pm.pending_amount, 'pendingCount', pm.pending_count,
        'completedAmount', pm.completed_amount, 'completedCount', pm.completed_count, 'failedAmount', pm.failed_amount, 'failedCount', pm.failed_count),
      'refunds', jsonb_build_object('refundedAmount', rm.refunded_amount, 'refundedCount', rm.refunded_count,
        'pendingAmount', rm.pending_amount, 'pendingCount', rm.pending_count), 'openReviews', (SELECT open_count FROM review_metrics)
    ), 'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pe.id, 'occurredAt', pe.occurred_at,
      'merchantId', pe.merchant_id, 'merchantName', pe.merchant_name, 'lane', pe.lane, 'status', pe.status,
      'amount', pe.amount, 'currency', pe.currency, 'provider', pe.provider, 'issueType', pe.issue_type)
      ORDER BY pe.occurred_at DESC NULLS LAST, pe.id DESC) FROM page_events pe), '[]'::jsonb),
    'nextCursor', (SELECT CASE WHEN pm.has_next_page AND EXISTS (SELECT 1 FROM page_events) THEN jsonb_build_object(
      'createdAt', (SELECT pe.occurred_at FROM page_events pe ORDER BY pe.occurred_at ASC NULLS LAST, pe.id ASC LIMIT 1),
      'id', (SELECT pe.id FROM page_events pe ORDER BY pe.occurred_at ASC NULLS LAST, pe.id ASC LIMIT 1)) ELSE NULL END FROM page_meta pm)
  ) INTO v_result
  FROM settlement_metrics sm CROSS JOIN direct_metrics dm CROSS JOIN payout_metrics pm CROSS JOIN refund_metrics rm CROSS JOIN wallet_metrics wm;
  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_admin_reconciliation_v3(text, text, uuid, text, text, timestamptz, uuid, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_reconciliation_v3(text, text, uuid, text, text, timestamptz, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_reconciliation_v3(text, text, uuid, text, text, timestamptz, uuid, integer) TO authenticated;
COMMENT ON FUNCTION public.get_admin_reconciliation_v3(text, text, uuid, text, text, timestamptz, uuid, integer) IS
  'Admin reconciliation v3. Currency-less settlement rows and counts remain visible as activity; their monetary values and currency labels remain withheld.';
