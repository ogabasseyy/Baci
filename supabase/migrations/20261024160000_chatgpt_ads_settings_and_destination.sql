BEGIN;
-- Public Pixel ID and separately stored server credential. No new public secret projection.
ALTER TABLE public.merchant_feature_settings ADD COLUMN chatgpt_pixel_id text;
CREATE TABLE public.merchant_chatgpt_ads_credentials (
  merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
  capi_key text NOT NULL CHECK (length(capi_key) BETWEEN 1 AND 4096),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.merchant_chatgpt_ads_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merchant_chatgpt_ads_credentials FROM PUBLIC, anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.merchant_chatgpt_ads_credentials TO authenticated;
GRANT SELECT(merchant_id,updated_at) ON public.merchant_chatgpt_ads_credentials TO authenticated;
GRANT ALL ON public.merchant_chatgpt_ads_credentials TO service_role;
CREATE POLICY chatgpt_ads_owner ON public.merchant_chatgpt_ads_credentials
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.merchants m WHERE m.id=merchant_id AND m.user_id=(SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.merchants m WHERE m.id=merchant_id AND m.user_id=(SELECT auth.uid())));

CREATE FUNCTION public.save_chatgpt_ads_settings(p_merchant_id uuid, p_pixel_id text DEFAULT NULL, p_capi_key text DEFAULT NULL, p_disconnect boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.merchants m WHERE m.id=p_merchant_id AND m.user_id=(SELECT auth.uid())) THEN
    RAISE EXCEPTION 'merchant_not_authorized' USING ERRCODE='42501';
  END IF;
  IF p_pixel_id IS NOT NULL AND p_pixel_id !~ '^[A-Za-z0-9_-]{1,128}$' THEN
    RAISE EXCEPTION 'invalid_pixel_id' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.merchant_feature_settings(merchant_id,chatgpt_pixel_id)
    VALUES(p_merchant_id,CASE WHEN p_disconnect THEN NULL ELSE p_pixel_id END)
    ON CONFLICT(merchant_id) DO UPDATE SET chatgpt_pixel_id=
      CASE WHEN p_disconnect THEN NULL
      ELSE COALESCE(EXCLUDED.chatgpt_pixel_id,public.merchant_feature_settings.chatgpt_pixel_id) END,
      updated_at=now();
  IF p_disconnect THEN
    DELETE FROM public.merchant_chatgpt_ads_credentials WHERE merchant_id=p_merchant_id;
  ELSIF NULLIF(pg_catalog.btrim(p_capi_key),'') IS NOT NULL THEN
    -- The feature-row upsert above serializes saves for this merchant. Avoid
    -- credential UPSERT: reading EXCLUDED.capi_key requires SELECT on the key,
    -- which would expose saved secrets through authenticated Data API reads.
    UPDATE public.merchant_chatgpt_ads_credentials
      SET capi_key=pg_catalog.btrim(p_capi_key),updated_at=now()
      WHERE merchant_id=p_merchant_id;
    IF NOT FOUND THEN
      INSERT INTO public.merchant_chatgpt_ads_credentials(merchant_id,capi_key)
        VALUES(p_merchant_id,pg_catalog.btrim(p_capi_key));
    END IF;
  END IF;
END
$fn$;
REVOKE ALL ON FUNCTION public.save_chatgpt_ads_settings(uuid,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_chatgpt_ads_settings(uuid,text,text,boolean) TO authenticated;

ALTER TABLE public.event_deliveries DROP CONSTRAINT event_deliveries_destination_check;
ALTER TABLE public.event_deliveries ADD CONSTRAINT event_deliveries_destination_check
 CHECK (destination IN ('facebook','tiktok','snapchat','ga4','chatgpt')) NOT VALID;

-- Preserve the current function bodies and privileges, asserting the exact
-- projection contracts before extending them. Never expose the credential table.
DO $projection$
DECLARE definition text;
BEGIN
 definition := pg_catalog.pg_get_functiondef('public.resolve_storefront_cached_merchant(text)'::regprocedure);
 IF position($needle$'facebook_pixel_id', fs.facebook_pixel_id,$needle$ in definition)=0 THEN
   RAISE EXCEPTION 'cached merchant pixel projection contract changed';
 END IF;
 EXECUTE replace(definition,$needle$'facebook_pixel_id', fs.facebook_pixel_id,$needle$,
   $replacement$'chatgpt_pixel_id', fs.chatgpt_pixel_id, 'facebook_pixel_id', fs.facebook_pixel_id,$replacement$);
 definition := pg_catalog.pg_get_functiondef('public.resolve_storefront_public_snapshot_v2(text)'::regprocedure);
 IF position($needle$'facebook_pixel_id',$needle$ in definition)=0 THEN
   RAISE EXCEPTION 'public snapshot pixel projection contract changed';
 END IF;
 EXECUTE replace(definition,$needle$'facebook_pixel_id',$needle$,$replacement$'chatgpt_pixel_id', 'facebook_pixel_id',$replacement$);
 definition := pg_catalog.pg_get_functiondef('public.merchant_feature_settings_public_cache_projection(public.merchant_feature_settings)'::regprocedure);
 IF position($needle$'facebook_pixel_id',$needle$ in definition)=0 THEN
   RAISE EXCEPTION 'feature cache pixel projection contract changed';
 END IF;
 EXECUTE replace(definition,$needle$'facebook_pixel_id',$needle$,$replacement$'chatgpt_pixel_id', 'facebook_pixel_id',$replacement$);
END
$projection$;

-- Feature settings audit fails closed on unclassified columns. Extend its
-- presence-only classification and bounded snapshots without recording values.
DO $audit$
DECLARE definition text;
BEGIN
 definition := pg_catalog.pg_get_functiondef('private.audit_merchant_feature_settings_change_v1()'::regprocedure);
 IF position($needle$'facebook_pixel_id', 'ga4_api_secret'$needle$ in definition)=0
 OR position($needle$CASE WHEN OLD.facebook_pixel_id IS DISTINCT FROM NEW.facebook_pixel_id$needle$ in definition)=0
 OR position($needle$'facebook_pixel_id', pg_catalog.jsonb_build_object('present', NULLIF(pg_catalog.btrim(OLD.facebook_pixel_id), '') IS NOT NULL),$needle$ in definition)=0
 OR position($needle$'facebook_pixel_id', pg_catalog.jsonb_build_object('present', NULLIF(pg_catalog.btrim(NEW.facebook_pixel_id), '') IS NOT NULL),$needle$ in definition)=0 THEN
   RAISE EXCEPTION 'feature audit classification contract changed';
 END IF;
 definition := replace(definition,$needle$'facebook_pixel_id', 'ga4_api_secret'$needle$,
   $replacement$'chatgpt_pixel_id', 'facebook_pixel_id', 'ga4_api_secret'$replacement$);
 definition := replace(definition,$needle$'facebook_pixel_id', pg_catalog.jsonb_build_object('present', NULLIF(pg_catalog.btrim(OLD.facebook_pixel_id), '') IS NOT NULL),$needle$,
   $replacement$'chatgpt_pixel_id', pg_catalog.jsonb_build_object('present', NULLIF(pg_catalog.btrim(OLD.chatgpt_pixel_id), '') IS NOT NULL),
      'facebook_pixel_id', pg_catalog.jsonb_build_object('present', NULLIF(pg_catalog.btrim(OLD.facebook_pixel_id), '') IS NOT NULL),$replacement$);
 definition := replace(definition,$needle$'facebook_pixel_id', pg_catalog.jsonb_build_object('present', NULLIF(pg_catalog.btrim(NEW.facebook_pixel_id), '') IS NOT NULL),$needle$,
   $replacement$'chatgpt_pixel_id', pg_catalog.jsonb_build_object('present', NULLIF(pg_catalog.btrim(NEW.chatgpt_pixel_id), '') IS NOT NULL),
      'facebook_pixel_id', pg_catalog.jsonb_build_object('present', NULLIF(pg_catalog.btrim(NEW.facebook_pixel_id), '') IS NOT NULL),$replacement$);
 definition := replace(definition,$needle$CASE WHEN OLD.facebook_pixel_id IS DISTINCT FROM NEW.facebook_pixel_id$needle$,
   $replacement$CASE WHEN OLD.chatgpt_pixel_id IS DISTINCT FROM NEW.chatgpt_pixel_id THEN 'chatgpt_pixel_id' END,
      CASE WHEN OLD.facebook_pixel_id IS DISTINCT FROM NEW.facebook_pixel_id$replacement$);
 EXECUTE definition;
END
$audit$;

-- Routing and operator replay each independently validate destination names.
DO $routing$
DECLARE entry record; definition text; updated_functions integer := 0;
BEGIN
 FOR entry IN SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN ('route_domain_event_v1','list_event_pipeline_deliveries_v1','select_event_pipeline_replay_ids_v1') LOOP
   updated_functions := updated_functions + 1;
   definition := pg_catalog.pg_get_functiondef(entry.oid);
   IF position($needle$('facebook', 'tiktok', 'snapchat', 'ga4')$needle$ in definition)=0 THEN
     RAISE EXCEPTION 'event destination validation contract changed';
   END IF;
   EXECUTE replace(definition,$needle$('facebook', 'tiktok', 'snapchat', 'ga4')$needle$,
     $replacement$('facebook', 'tiktok', 'snapchat', 'ga4', 'chatgpt')$replacement$);
 END LOOP;
 IF updated_functions <> 3 THEN RAISE EXCEPTION 'event routing/replay functions missing'; END IF;
END
$routing$;

COMMIT;
