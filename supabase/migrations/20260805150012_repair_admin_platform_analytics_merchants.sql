-- Live merchant-profile analytics for the platform-admin analytics RPC.

BEGIN;

CREATE OR REPLACE FUNCTION private.get_admin_platform_analytics_merchants_v1(
  p_now timestamptz,
  p_platform_start timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH
  activation AS (
    SELECT
      COUNT(*)::bigint AS signed_up,
      COUNT(*) FILTER (WHERE NULLIF(BTRIM(m.business_type), '') IS NOT NULL)::bigint AS business_type_set,
      COUNT(*) FILTER (
        WHERE NULLIF(BTRIM(m.business_name), '') IS NOT NULL
          AND NULLIF(BTRIM(m.slug), '') IS NOT NULL
      )::bigint AS store_configured,
      COUNT(*) FILTER (
        WHERE NULLIF(BTRIM(m.support_email), '') IS NOT NULL
          OR NULLIF(BTRIM(m.support_phone), '') IS NOT NULL
      )::bigint AS support_ready,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.products p WHERE p.merchant_id = m.id
      ))::bigint AS products_added,
      COUNT(*) FILTER (
        WHERE NULLIF(BTRIM(m.paystack_subaccount_code), '') IS NOT NULL
          OR (
            NULLIF(BTRIM(m.bank_account_name), '') IS NOT NULL
            AND NULLIF(BTRIM(m.bank_account_number), '') IS NOT NULL
            AND NULLIF(BTRIM(m.bank_code), '') IS NOT NULL
          )
      )::bigint AS payout_ready,
      COUNT(*) FILTER (WHERE m.is_published IS TRUE)::bigint AS published,
      COUNT(*) FILTER (WHERE m.kyc_status = 'verified')::bigint AS kyc_verified,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.merchant_id = m.id
          AND LOWER(COALESCE(NULLIF(BTRIM(o.payment_status), ''), 'unknown')) = 'paid'
          AND o.created_at >= p_platform_start
      ))::bigint AS first_paid_order
    FROM public.merchants m
  ),
  -- Merchant growth intentionally compares Lagos calendar months, independent
  -- of the selected rolling order window used for GMV growth in the wrapper.
  growth AS (
    SELECT
      COUNT(*) FILTER (
        WHERE m.created_at >= (
          date_trunc('month', p_now AT TIME ZONE 'Africa/Lagos')
          AT TIME ZONE 'Africa/Lagos'
        )
      )::bigint AS current_month,
      COUNT(*) FILTER (
        WHERE m.created_at >= (
          (
            date_trunc('month', p_now AT TIME ZONE 'Africa/Lagos')
            - interval '1 month'
          )
          AT TIME ZONE 'Africa/Lagos'
        )
          AND m.created_at < (
            date_trunc('month', p_now AT TIME ZONE 'Africa/Lagos')
            AT TIME ZONE 'Africa/Lagos'
          )
      )::bigint AS previous_month
    FROM public.merchants m
  ),
  merchant_paid_sales AS MATERIALIZED (
    SELECT
      m.id AS merchant_id,
      MAX(o.created_at) AS last_paid_at
    FROM public.merchants m
    LEFT JOIN public.orders o
      ON o.merchant_id = m.id
      AND LOWER(COALESCE(NULLIF(BTRIM(o.payment_status), ''), 'unknown')) = 'paid'
      AND o.created_at >= p_platform_start
    GROUP BY m.id
  ),
  health AS (
    SELECT
      COUNT(*) FILTER (WHERE last_paid_at >= p_now - interval '30 days')::bigint AS healthy,
      COUNT(*) FILTER (
        WHERE last_paid_at < p_now - interval '30 days'
          AND last_paid_at >= p_now - interval '90 days'
      )::bigint AS at_risk,
      COUNT(*) FILTER (WHERE last_paid_at < p_now - interval '90 days')::bigint AS churned,
      COUNT(*) FILTER (WHERE last_paid_at IS NULL)::bigint AS new
    FROM merchant_paid_sales
  ),
  business_type_counts AS (
    SELECT NULLIF(BTRIM(m.business_type), '') AS business_type, COUNT(*)::bigint AS merchants
    FROM public.merchants m
    GROUP BY NULLIF(BTRIM(m.business_type), '')
  ),
  merchant_counts AS (
    SELECT COUNT(*)::bigint AS total_merchants FROM public.merchants
  )
  SELECT jsonb_build_object(
    'merchantHealth', jsonb_build_object(
      'healthy', h.healthy, 'atRisk', h.at_risk,
      'churned', h.churned, 'new', h.new
    ),
    'growth', jsonb_build_object(
      'newMerchantsThisMonth', g.current_month,
      'merchantGrowthRate', CASE
        WHEN g.previous_month > 0 THEN ((g.current_month - g.previous_month)::numeric / g.previous_month) * 100
        WHEN g.current_month > 0 THEN 100 ELSE 0 END
    ),
    'merchantActivation', jsonb_build_array(
      jsonb_build_object('key', 'signed_up', 'label', 'Signed Up', 'merchants', a.signed_up,
        'completionRate', CASE WHEN a.signed_up > 0 THEN 100 ELSE 0 END,
        'description', 'All merchant records'),
      jsonb_build_object('key', 'business_type_set', 'label', 'Business Type Set', 'merchants', a.business_type_set,
        'completionRate', CASE WHEN a.signed_up > 0 THEN a.business_type_set::numeric / a.signed_up * 100 ELSE 0 END,
        'description', 'Merchants categorized during onboarding'),
      jsonb_build_object('key', 'store_configured', 'label', 'Store Configured', 'merchants', a.store_configured,
        'completionRate', CASE WHEN a.signed_up > 0 THEN a.store_configured::numeric / a.signed_up * 100 ELSE 0 END,
        'description', 'Merchants with business name and storefront slug'),
      jsonb_build_object('key', 'support_ready', 'label', 'Support Ready', 'merchants', a.support_ready,
        'completionRate', CASE WHEN a.signed_up > 0 THEN a.support_ready::numeric / a.signed_up * 100 ELSE 0 END,
        'description', 'Merchants with customer-facing support details'),
      jsonb_build_object('key', 'products_added', 'label', 'Products Added', 'merchants', a.products_added,
        'completionRate', CASE WHEN a.signed_up > 0 THEN a.products_added::numeric / a.signed_up * 100 ELSE 0 END,
        'description', 'Merchants with at least one catalog product'),
      jsonb_build_object('key', 'payout_ready', 'label', 'Payout Ready', 'merchants', a.payout_ready,
        'completionRate', CASE WHEN a.signed_up > 0 THEN a.payout_ready::numeric / a.signed_up * 100 ELSE 0 END,
        'description', 'Merchants with payout details configured'),
      jsonb_build_object('key', 'published', 'label', 'Published', 'merchants', a.published,
        'completionRate', CASE WHEN a.signed_up > 0 THEN a.published::numeric / a.signed_up * 100 ELSE 0 END,
        'description', 'Stores currently live for shoppers'),
      jsonb_build_object('key', 'kyc_verified', 'label', 'KYC Verified', 'merchants', a.kyc_verified,
        'completionRate', CASE WHEN a.signed_up > 0 THEN a.kyc_verified::numeric / a.signed_up * 100 ELSE 0 END,
        'description', 'Merchants cleared for compliance review'),
      jsonb_build_object('key', 'first_paid_order', 'label', 'First Paid Order', 'merchants', a.first_paid_order,
        'completionRate', CASE WHEN a.signed_up > 0 THEN a.first_paid_order::numeric / a.signed_up * 100 ELSE 0 END,
        'description', 'Merchants with at least one paid order since launch')
    ),
    'businessTypeCounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'businessType', btc.business_type, 'merchants', btc.merchants
      ) ORDER BY btc.merchants DESC, btc.business_type NULLS LAST)
      FROM business_type_counts btc
    ), '[]'::jsonb),
    'signupSources', (
      SELECT jsonb_agg(jsonb_build_object(
        'source', sources.source, 'merchants', COALESCE(sc.merchants, 0),
        'shareOfMerchants', CASE WHEN mc.total_merchants > 0
          THEN COALESCE(sc.merchants, 0)::numeric / mc.total_merchants * 100 ELSE 0 END
      ) ORDER BY sources.position)
      FROM (VALUES ('web', 1), ('ios', 2), ('android', 3)) sources(source, position)
      LEFT JOIN (
        SELECT LOWER(COALESCE(m.signup_source::text, 'web')) AS source, COUNT(*)::bigint AS merchants
        FROM public.merchants m GROUP BY 1
      ) sc ON sc.source = sources.source
    )
  )
  FROM activation a
  CROSS JOIN growth g
  CROSS JOIN health h
  CROSS JOIN merchant_counts mc;
$$;

ALTER FUNCTION private.get_admin_platform_analytics_merchants_v1(
  timestamptz, timestamptz
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.get_admin_platform_analytics_merchants_v1(
  timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
