-- Disposable standalone fixture exercising the actual public projection under anon.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE FUNCTION public.resolve_storefront_cached_merchant(text)
RETURNS TABLE(merchant_data jsonb, custom_domain text, feature_settings jsonb)
LANGUAGE sql AS $$
 SELECT current_setting('test.merchant')::jsonb, 'shop.example.com'::text,
 '{"facebook_pixel_id":"2099259280261589","facebook_capi_token":"secret-sentinel"}'::jsonb
$$;
\ir ../migrations/20261020042734_storefront_shared_cart_public_hints.sql
\if :apply_fix
\ir ../migrations/20261025220509_storefront_growth_integration_hint.sql
\endif
SET ROLE anon;
DO $test$
DECLARE source jsonb; output jsonb; settings jsonb; expected boolean;
BEGIN
 FOR source, expected IN
   SELECT * FROM (VALUES
     ('{"plan_tier":"pro","plan_expires_at":null}'::jsonb,true),
     ('{"plan_tier":"pro","plan_expires_at":"2099-01-01T00:00:00Z"}'::jsonb,true),
     ('{"plan_tier":"pro","plan_expires_at":"2000-01-01T00:00:00Z"}'::jsonb,false),
     ('{"plan_tier":"pro"}'::jsonb,false),
     ('{"plan_tier":"free","premium_features":["growth_integrations"]}'::jsonb,true),
     ('{"plan_tier":"free","premium_features":[" ALL_FEATURES "]}'::jsonb,true),
     ('{"plan_tier":"free","premium_features":{"growth_integrations":true}}'::jsonb,false),
     ('{"plan_tier":"free","premium_features":[]}'::jsonb,false)
   ) AS cases(data, enabled)
 LOOP
   PERFORM set_config('test.merchant', (source || '{"is_published":true,"id":"merchant-1"}'::jsonb)::text,false);
   SELECT merchant_data, feature_settings INTO STRICT output, settings
   FROM public.resolve_storefront_public_snapshot_v2('shop.example.com');
   IF output->'growth_integrations_enabled' IS DISTINCT FROM to_jsonb(expected) THEN
     RAISE EXCEPTION 'growth hint incorrect for %',source;
   END IF;
   IF output ?| ARRAY['plan_tier','plan_expires_at','premium_features']
     OR settings ? 'facebook_capi_token' THEN RAISE EXCEPTION 'private data leaked'; END IF;
   IF settings->>'facebook_pixel_id' IS DISTINCT FROM '2099259280261589' THEN RAISE EXCEPTION 'public pixel lost'; END IF;
 END LOOP;
 PERFORM set_config('test.merchant','{"is_published":false,"plan_tier":"pro","plan_expires_at":null}',false);
 SELECT merchant_data, feature_settings INTO STRICT output,settings
 FROM public.resolve_storefront_public_snapshot_v2('shop.example.com');
 IF output ? 'growth_integrations_enabled' OR settings IS NOT NULL THEN
   RAISE EXCEPTION 'unpublished merchant leaked capabilities'; END IF;
END;
$test$;
