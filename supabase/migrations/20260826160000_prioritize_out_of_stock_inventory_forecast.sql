-- Prioritize out-of-stock products before applying the dashboard page limit.
-- Products with no recent sales report 999 days of stock, so ordering only by
-- days_of_stock can otherwise hide out-of-stock rows behind healthy products.
-- Keep the explicit-zero low-stock threshold behavior introduced previously.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_inventory_forecast_dashboard(
  p_merchant_id uuid,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0,
  p_low_stock_only boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL
     OR NOT public.check_staff_permission(
       (SELECT auth.uid()), p_merchant_id, 'products', 'view'
     ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  IF p_limit < 1 OR p_limit > 100 OR p_offset < 0 THEN
    RAISE EXCEPTION 'invalid_inventory_forecast_window'
      USING ERRCODE = '22023';
  END IF;

  WITH sales AS MATERIALIZED (
    SELECT
      oi.product_id,
      COALESCE(SUM(oi.quantity) FILTER (
        WHERE o.created_at >= NOW() - INTERVAL '7 days'
      ), 0)::numeric AS sales_7d,
      COALESCE(SUM(oi.quantity) FILTER (
        WHERE o.created_at >= NOW() - INTERVAL '30 days'
      ), 0)::numeric AS sales_30d,
      COALESCE(SUM(oi.quantity) FILTER (
        WHERE o.created_at >= NOW() - INTERVAL '60 days'
          AND o.created_at < NOW() - INTERVAL '30 days'
      ), 0)::numeric AS previous_sales_30d
    FROM public.order_items oi
    INNER JOIN public.orders o ON o.id = oi.order_id
    WHERE o.merchant_id = p_merchant_id
      AND o.payment_status = 'paid'
      AND o.created_at >= NOW() - INTERVAL '60 days'
    GROUP BY oi.product_id
  ), forecast_base AS MATERIALIZED (
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.image,
      COALESCE(p.stock, 0)::integer AS current_stock,
      COALESCE(p.low_stock_threshold, 5)::integer
        AS low_stock_threshold,
      ((COALESCE(s.sales_7d, 0) * 2.0 / 7.0)
        + (COALESCE(s.sales_30d, 0) / 30.0)) / 3.0 AS avg_daily_sales,
      COALESCE(s.sales_30d, 0) AS sales_30d,
      COALESCE(s.previous_sales_30d, 0) AS previous_sales_30d
    FROM public.products p
    LEFT JOIN sales s ON s.product_id = p.id
    WHERE p.merchant_id = p_merchant_id
      AND p.status = 'active'
      AND p.manage_stock = true
  ), classified AS MATERIALIZED (
    SELECT
      f.*,
      CASE
        WHEN f.avg_daily_sales > 0 THEN f.current_stock / f.avg_daily_sales
        ELSE 999::numeric
      END AS days_of_stock,
      CASE
        WHEN f.current_stock <= 0 THEN 'out_of_stock'
        WHEN f.current_stock <= f.low_stock_threshold
          OR (f.avg_daily_sales > 0 AND f.current_stock / f.avg_daily_sales <= 7)
          THEN 'critical'
        WHEN f.avg_daily_sales > 0 AND f.current_stock / f.avg_daily_sales <= 14
          THEN 'warning'
        ELSE 'healthy'
      END AS stock_status,
      CASE
        WHEN f.sales_30d > f.previous_sales_30d * 1.2 THEN 'increasing'
        WHEN f.sales_30d < f.previous_sales_30d * 0.8 THEN 'decreasing'
        ELSE 'stable'
      END AS sales_trend
    FROM forecast_base f
  ), visible AS MATERIALIZED (
    SELECT *
    FROM classified
    WHERE NOT p_low_stock_only OR stock_status <> 'healthy'
  ), page_rows AS (
    SELECT *
    FROM visible
    ORDER BY
      CASE WHEN current_stock <= 0 THEN 0 ELSE 1 END ASC,
      days_of_stock ASC,
      product_id ASC
    LIMIT p_limit
    OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'forecasts', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'productId', r.product_id,
          'productName', r.product_name,
          'image', r.image,
          'currentStock', r.current_stock,
          'lowStockThreshold', r.low_stock_threshold,
          'avgDailySales', r.avg_daily_sales,
          'daysOfStock', r.days_of_stock,
          'predictedStockoutDate', CASE
            WHEN r.avg_daily_sales > 0
              THEN CURRENT_DATE + r.days_of_stock::integer
            ELSE NULL
          END,
          'reorderQuantity', GREATEST(
            CEIL(r.avg_daily_sales * 51) - r.current_stock, 0
          )::integer,
          'salesTrend', r.sales_trend,
          'status', r.stock_status
        )
        ORDER BY
          CASE WHEN r.current_stock <= 0 THEN 0 ELSE 1 END ASC,
          r.days_of_stock ASC,
          r.product_id ASC
      )
      FROM page_rows r
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'totalProducts', (SELECT COUNT(*) FROM visible),
      'outOfStock', (SELECT COUNT(*) FROM visible WHERE stock_status = 'out_of_stock'),
      'critical', (SELECT COUNT(*) FROM visible WHERE stock_status = 'critical'),
      'warning', (SELECT COUNT(*) FROM visible WHERE stock_status = 'warning'),
      'healthy', (SELECT COUNT(*) FROM visible WHERE stock_status = 'healthy')
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_forecast_dashboard(
  uuid, integer, integer, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_forecast_dashboard(
  uuid, integer, integer, boolean
) TO authenticated;

COMMIT;
