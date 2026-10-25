-- Aggregate existing durable lookup rows, not browser events or polling requests.
-- Normal authenticated admin sessions only; never return hashes/identifiers/people.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_admin_imei_check_analytics(
  p_period text DEFAULT '30d', p_merchant_slug text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_start timestamptz;
  v_result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR private.has_platform_admin_permission_v1((SELECT auth.uid()), 'analytics.read') IS NOT TRUE THEN
    RAISE EXCEPTION 'Analytics permission required' USING ERRCODE = '42501';
  END IF;
  IF p_period IS NULL OR p_period NOT IN ('7d','30d','90d','all') THEN
    RAISE EXCEPTION 'Invalid analytics period' USING ERRCODE = '22023';
  END IF;
  v_start := CASE p_period WHEN '7d' THEN v_now - interval '7 days' WHEN '30d' THEN v_now - interval '30 days' WHEN '90d' THEN v_now - interval '90 days' ELSE '-infinity'::timestamptz END;
  WITH scoped AS MATERIALIZED (
    SELECT l.merchant_id, l.imei_hash, l.status, l.tier,
      nullif(l.cached_response #>> '{data,deviceProfile,model}', '') AS model,
      coalesce(nullif(l.cached_response #>> '{data,deviceProfile,brand}', ''), 'Unknown') AS brand,
      nullif(l.cached_response #>> '{data,deviceProfile,color}', '') AS color,
      nullif(l.cached_response #>> '{data,deviceProfile,storage}', '') AS storage,
      l.cached_response #>> '{data,deviceProfile,imageMatch}' AS image_match
    FROM public.imei_lookups l JOIN public.merchants m ON m.id = l.merchant_id
    WHERE l.created_at >= v_start AND l.created_at < v_now
      AND (p_merchant_slug IS NULL OR m.slug = p_merchant_slug)
  ), complete AS MATERIALIZED (
    SELECT merchant_id, imei_hash, tier, model, brand, color, storage, image_match FROM scoped WHERE status = 'completed'
  ), models AS (
    SELECT min(brand) AS brand, min(model) AS model, count(*) AS checks, count(DISTINCT (merchant_id, imei_hash)) AS "uniqueDevices"
    FROM complete WHERE model IS NOT NULL GROUP BY lower(brand), lower(model) ORDER BY checks DESC, brand, model LIMIT 10
  ), variants AS (
    SELECT min(brand) AS brand, min(model) AS model, min(color) AS color, storage, count(*) AS checks FROM complete WHERE model IS NOT NULL
    GROUP BY lower(brand), lower(model), lower(color), storage ORDER BY checks DESC, brand, model, color NULLS LAST, storage NULLS LAST LIMIT 10
  ), brands AS (
    SELECT min(brand) AS brand, count(*) AS checks FROM complete WHERE brand <> 'Unknown' GROUP BY lower(brand) ORDER BY checks DESC, brand LIMIT 10
  ), services AS (
    SELECT tier, count(*) AS checks FROM complete GROUP BY tier ORDER BY checks DESC, tier LIMIT 10
  )
  SELECT jsonb_build_object(
    'generatedAt', v_now,
    'summary', jsonb_build_object(
      'requests', (SELECT count(*) FROM scoped),
      'completed', (SELECT count(*) FROM complete),
      'uniqueDevices', (SELECT count(DISTINCT (merchant_id, imei_hash)) FROM complete),
      'unidentified', (SELECT count(*) FROM complete WHERE model IS NULL),
      'matchedImages', (SELECT count(*) FROM complete WHERE image_match IN ('model','color'))
    ),
    'topModels', coalesce((SELECT jsonb_agg(to_jsonb(models) ORDER BY checks DESC, brand, model) FROM models), '[]'::jsonb),
    'topVariants', coalesce((SELECT jsonb_agg(to_jsonb(variants) ORDER BY checks DESC, brand, model, color NULLS LAST, storage NULLS LAST) FROM variants), '[]'::jsonb),
    'topBrands', coalesce((SELECT jsonb_agg(to_jsonb(brands) ORDER BY checks DESC, brand) FROM brands), '[]'::jsonb),
    'services', coalesce((SELECT jsonb_agg(to_jsonb(services) ORDER BY checks DESC, tier) FROM services), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_imei_check_analytics(text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_imei_check_analytics(text,text) TO authenticated;
COMMENT ON FUNCTION public.get_admin_imei_check_analytics(text,text) IS 'Permission-gated IMEI aggregates. Each lookup row counts once; date window uses request created_at. Only completed lookups contribute model/variant rankings. Historical results without normalized identity count as unidentified.';
COMMIT;
