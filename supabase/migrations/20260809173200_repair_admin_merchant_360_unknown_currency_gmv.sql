-- A currency code is required before a paid-order amount can become Merchant
-- 360 GMV. In particular, `UNK` must not make null or blank order currencies
-- look comparable and thereby turn an unlabeled amount into a money total.
ALTER FUNCTION public.get_admin_merchant_360_v2(uuid)
  RENAME TO get_admin_merchant_360_v2_currency_ambiguous;

CREATE OR REPLACE FUNCTION public.get_admin_merchant_360_v2(p_merchant_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH base AS (
    SELECT public.get_admin_merchant_360_v2_currency_ambiguous(p_merchant_id) AS payload
  ), money_context AS (
    SELECT
      base.payload,
      CASE
        WHEN UPPER(NULLIF(BTRIM(base.payload ->> 'moneyCurrency'), '')) ~ '^[A-Z]{3}$'
          AND UPPER(NULLIF(BTRIM(base.payload ->> 'moneyCurrency'), '')) <> 'UNK'
          THEN UPPER(NULLIF(BTRIM(base.payload ->> 'moneyCurrency'), ''))
        ELSE NULL
      END AS display_currency
    FROM base
  ), paid_orders AS (
    SELECT
      order_row.total,
      order_row.created_at,
      UPPER(NULLIF(BTRIM(order_row.currency), '')) AS order_currency
    FROM public.orders AS order_row
    WHERE order_row.merchant_id = p_merchant_id
      AND LOWER(COALESCE(NULLIF(BTRIM(order_row.payment_status), ''), 'unknown')) = 'paid'
  ), paid_sales AS (
    SELECT
      COUNT(*)::bigint AS paid_orders,
      COUNT(*) FILTER (
        WHERE money_context.display_currency IS NOT NULL
          AND paid_orders.order_currency = money_context.display_currency
      )::bigint AS display_currency_paid_orders,
      COUNT(*) FILTER (
        WHERE money_context.display_currency IS NULL
          OR paid_orders.order_currency IS DISTINCT FROM money_context.display_currency
      )::bigint AS excluded_non_display_currency_paid_orders,
      COALESCE(SUM(COALESCE(paid_orders.total, 0)) FILTER (
        WHERE money_context.display_currency IS NOT NULL
          AND paid_orders.order_currency = money_context.display_currency
      ), 0)::numeric AS paid_gmv,
      MAX(paid_orders.created_at) AS last_paid_at
    FROM paid_orders
    CROSS JOIN money_context
  )
  SELECT CASE
    WHEN money_context.payload IS NULL THEN NULL
    ELSE jsonb_set(
      money_context.payload,
      '{sales}',
      jsonb_build_object(
        'paidGmv', paid_sales.paid_gmv,
        'paidOrders', paid_sales.paid_orders,
        'displayCurrencyPaidOrders', paid_sales.display_currency_paid_orders,
        'excludedNonDisplayCurrencyPaidOrders', paid_sales.excluded_non_display_currency_paid_orders,
        'lastPaidAt', paid_sales.last_paid_at
      )
    )
  END
  FROM money_context
  CROSS JOIN paid_sales;
$$;

ALTER FUNCTION public.get_admin_merchant_360_v2_currency_ambiguous(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_merchant_360_v2_currency_ambiguous(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.get_admin_merchant_360_v2(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_merchant_360_v2(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_merchant_360_v2(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_admin_merchant_360_v2(uuid) IS
  'Platform-admin Merchant 360 v2. Storefront readiness uses the Baci slug, publication, payment, and shipping; settlement amounts and GMV are withheld unless their currency is known.';
