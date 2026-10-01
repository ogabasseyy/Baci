-- Live order breakdowns for the platform-admin analytics RPC.

BEGIN;

CREATE OR REPLACE FUNCTION private.get_admin_platform_analytics_breakdowns_v1(
  p_start_at timestamptz,
  p_end_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH
  current_orders AS MATERIALIZED (
    SELECT
      o.merchant_id,
      o.created_at,
      COALESCE(o.total, 0)::numeric AS total,
      LOWER(COALESCE(NULLIF(BTRIM(o.payment_status), ''), 'unknown')) AS payment_status,
      LOWER(COALESCE(NULLIF(BTRIM(o.shipping_status), ''), 'unknown')) AS shipping_status,
      LOWER(COALESCE(NULLIF(BTRIM(o.payment_method), ''), 'unknown')) AS payment_method,
      LOWER(COALESCE(NULLIF(BTRIM(o.source), ''), 'unknown')) AS source,
      UPPER(NULLIF(BTRIM(o.currency), '')) AS currency
    FROM public.orders o
    WHERE o.created_at >= p_start_at
      AND o.created_at < p_end_at
  ),
  ngn_current_orders AS MATERIALIZED (
    SELECT merchant_id, created_at, total, payment_status, shipping_status,
      payment_method, source
    FROM current_orders
    WHERE currency = 'NGN'
  ),
  paid_current AS MATERIALIZED (
    SELECT merchant_id, created_at, total, payment_method, source
    FROM ngn_current_orders
    WHERE payment_status = 'paid'
  )
  SELECT jsonb_build_object(
    'dailyGmv', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', d.sale_date, 'gmv', d.gmv,
        'orders', d.orders, 'merchants', d.merchants
      ) ORDER BY d.sale_date)
      FROM (
        SELECT (created_at AT TIME ZONE 'Africa/Lagos')::date AS sale_date,
          SUM(total)::numeric AS gmv, COUNT(*)::bigint AS orders,
          COUNT(DISTINCT merchant_id)::bigint AS merchants
        FROM paid_current GROUP BY 1
      ) d
    ), '[]'::jsonb),
    'topMerchants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'gmv', t.gmv, 'orders', t.orders
      ) ORDER BY t.gmv DESC, t.orders DESC, t.name)
      FROM (
        SELECT m.id, COALESCE(NULLIF(BTRIM(m.business_name), ''), 'Unnamed Store') AS name,
          SUM(p.total)::numeric AS gmv, COUNT(*)::bigint AS orders
        FROM paid_current p INNER JOIN public.merchants m ON m.id = p.merchant_id
        GROUP BY m.id, m.business_name ORDER BY gmv DESC, orders DESC LIMIT 10
      ) t
    ), '[]'::jsonb),
    'salesByChannel', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'channel', c.channel, 'gmv', c.gmv, 'orders', c.orders,
        'shareOfGmv', CASE WHEN c.all_gmv > 0 THEN c.gmv / c.all_gmv * 100 ELSE 0 END,
        'shareOfOrders', CASE WHEN c.all_orders > 0 THEN c.orders::numeric / c.all_orders * 100 ELSE 0 END
      ) ORDER BY c.gmv DESC, c.orders DESC, c.channel)
      FROM (
        SELECT source AS channel, SUM(total)::numeric AS gmv, COUNT(*)::bigint AS orders,
          SUM(SUM(total)) OVER ()::numeric AS all_gmv,
          SUM(COUNT(*)) OVER ()::bigint AS all_orders
        FROM paid_current GROUP BY source
      ) c
    ), '[]'::jsonb),
    'paymentStatuses', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'status', s.status,
        'label', CASE s.status WHEN 'bnpl_pending' THEN 'BNPL Pending' WHEN 'partially_paid' THEN 'Partially Paid' ELSE initcap(replace(s.status, '_', ' ')) END,
        'orders', s.orders, 'amount', s.amount,
        'shareOfOrders', CASE WHEN s.all_orders > 0 THEN s.orders::numeric / s.all_orders * 100 ELSE 0 END,
        'shareOfAmount', CASE WHEN s.all_amount > 0 THEN s.amount / s.all_amount * 100 ELSE 0 END
      ) ORDER BY s.sort_order, s.orders DESC, s.status)
      FROM (SELECT payment_status AS status, COUNT(*)::bigint AS orders, SUM(total)::numeric AS amount,
        SUM(COUNT(*)) OVER ()::bigint AS all_orders,
        SUM(SUM(total)) OVER ()::numeric AS all_amount,
        CASE payment_status WHEN 'paid' THEN 1 WHEN 'pending' THEN 2 WHEN 'bnpl_pending' THEN 3
          WHEN 'partially_paid' THEN 4 WHEN 'unpaid' THEN 5 WHEN 'failed' THEN 6
          WHEN 'refunded' THEN 7 WHEN 'cancelled' THEN 8 ELSE 9 END AS sort_order
        FROM ngn_current_orders GROUP BY payment_status) s
    ), '[]'::jsonb),
    'shippingStatuses', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'status', s.status, 'label', initcap(replace(s.status, '_', ' ')),
        'orders', s.orders, 'amount', s.amount,
        'shareOfOrders', CASE WHEN s.all_orders > 0 THEN s.orders::numeric / s.all_orders * 100 ELSE 0 END,
        'shareOfAmount', CASE WHEN s.all_amount > 0 THEN s.amount / s.all_amount * 100 ELSE 0 END
      ) ORDER BY s.sort_order, s.orders DESC, s.status)
      FROM (SELECT shipping_status AS status, COUNT(*)::bigint AS orders, SUM(total)::numeric AS amount,
        SUM(COUNT(*)) OVER ()::bigint AS all_orders,
        SUM(SUM(total)) OVER ()::numeric AS all_amount,
        CASE shipping_status WHEN 'pending' THEN 1 WHEN 'processing' THEN 2 WHEN 'fulfilled' THEN 3
          WHEN 'shipped' THEN 4 WHEN 'delivered' THEN 5 WHEN 'cancelled' THEN 6 ELSE 7 END AS sort_order
        FROM ngn_current_orders GROUP BY shipping_status) s
    ), '[]'::jsonb),
    'paymentMethods', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'method', pm.method,
        'label', CASE pm.method WHEN 'bank_transfer' THEN 'Bank Transfer' WHEN 'bnpl' THEN 'Buy Now, Pay Later'
          WHEN 'cash_on_delivery' THEN 'Cash on Delivery' WHEN 'mobile_money' THEN 'Mobile Money'
          WHEN 'pos' THEN 'POS' WHEN 'ussd' THEN 'USSD' ELSE initcap(replace(pm.method, '_', ' ')) END,
        'orders', pm.orders, 'amount', pm.amount,
        'shareOfPaidOrders', CASE WHEN pm.all_orders > 0 THEN pm.orders::numeric / pm.all_orders * 100 ELSE 0 END,
        'shareOfPaidAmount', CASE WHEN pm.all_amount > 0 THEN pm.amount / pm.all_amount * 100 ELSE 0 END
      ) ORDER BY pm.amount DESC, pm.orders DESC, pm.method)
      FROM (
        SELECT payment_method AS method, COUNT(*)::bigint AS orders, SUM(total)::numeric AS amount,
          SUM(COUNT(*)) OVER ()::bigint AS all_orders,
          SUM(SUM(total)) OVER ()::numeric AS all_amount
        FROM paid_current GROUP BY payment_method
      ) pm
    ), '[]'::jsonb)
  );
$$;

ALTER FUNCTION private.get_admin_platform_analytics_breakdowns_v1(
  timestamptz, timestamptz
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.get_admin_platform_analytics_breakdowns_v1(
  timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
