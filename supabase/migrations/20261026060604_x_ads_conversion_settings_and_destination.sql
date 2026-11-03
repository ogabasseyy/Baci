BEGIN;
ALTER TABLE public.merchant_feature_settings ADD COLUMN twitter_event_ids jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE FUNCTION public.is_valid_x_event_ids(p_pixel text,p_ids jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $valid$
 SELECT CASE WHEN p_ids IS NULL OR jsonb_typeof(p_ids)<>'object' OR octet_length(p_ids::text)>4096 THEN false
 WHEN p_ids='{}'::jsonb THEN true
 WHEN p_pixel IS NULL OR p_pixel!~'^[A-Za-z0-9]{1,64}$' THEN false
 ELSE NOT EXISTS(SELECT 1 FROM jsonb_each(p_ids) item WHERE item.key NOT IN('pageView','viewContent','addToCart','initiateCheckout','purchase','search','signUp','addToWishlist') OR jsonb_typeof(item.value)<>'string' OR (item.value#>>'{}')!~('^tw-'||p_pixel||'-[A-Za-z0-9]{1,128}$')) END
$valid$;
ALTER TABLE public.merchant_feature_settings ADD CONSTRAINT twitter_event_ids_object CHECK(public.is_valid_x_event_ids(twitter_pixel_id,twitter_event_ids));
CREATE TABLE public.merchant_x_ads_credentials (
 merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id) ON DELETE CASCADE,
 consumer_key text NOT NULL CHECK(length(consumer_key) BETWEEN 1 AND 4096),
 consumer_secret text NOT NULL CHECK(length(consumer_secret) BETWEEN 1 AND 4096),
 access_token text NOT NULL CHECK(length(access_token) BETWEEN 1 AND 4096),
 access_token_secret text NOT NULL CHECK(length(access_token_secret) BETWEEN 1 AND 4096),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.merchant_x_ads_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merchant_x_ads_credentials FROM PUBLIC,anon,authenticated;
GRANT INSERT,UPDATE,DELETE ON public.merchant_x_ads_credentials TO authenticated;
GRANT SELECT(merchant_id,updated_at) ON public.merchant_x_ads_credentials TO authenticated;
GRANT ALL ON public.merchant_x_ads_credentials TO service_role;
CREATE POLICY x_ads_owner ON public.merchant_x_ads_credentials FOR ALL TO authenticated
 USING(EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=merchant_id AND m.user_id=(SELECT auth.uid())))
 WITH CHECK(EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=merchant_id AND m.user_id=(SELECT auth.uid())));
CREATE FUNCTION public.save_x_ads_settings(p_merchant_id uuid,p_pixel_id text,p_event_ids jsonb DEFAULT '{}'::jsonb,p_credentials jsonb DEFAULT NULL,p_disconnect boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE item record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=p_merchant_id AND m.user_id=(SELECT auth.uid())) THEN RAISE EXCEPTION 'merchant_not_authorized' USING ERRCODE='42501';END IF;
 IF p_disconnect IS NOT TRUE THEN
  IF p_pixel_id IS NULL OR p_pixel_id!~'^[A-Za-z0-9]{1,64}$' OR p_event_ids IS NULL OR jsonb_typeof(p_event_ids)<>'object' OR octet_length(p_event_ids::text)>4096 THEN RAISE EXCEPTION 'invalid_x_settings' USING ERRCODE='22023';END IF;
  FOR item IN SELECT key,value FROM jsonb_each(p_event_ids) LOOP
   IF item.key NOT IN('pageView','viewContent','addToCart','initiateCheckout','purchase','search','signUp','addToWishlist') OR jsonb_typeof(item.value)<>'string' OR (item.value#>>'{}')!~('^tw-'||p_pixel_id||'-[A-Za-z0-9]{1,128}$') THEN RAISE EXCEPTION 'invalid_x_event_code' USING ERRCODE='22023';END IF;
  END LOOP;
  IF p_credentials IS NOT NULL THEN
   IF jsonb_typeof(p_credentials)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_credentials))<>4 THEN RAISE EXCEPTION 'invalid_x_credentials' USING ERRCODE='22023';END IF;
   FOR item IN SELECT key,value FROM jsonb_each(p_credentials) LOOP
    IF item.key NOT IN('consumerKey','consumerSecret','accessToken','accessTokenSecret') OR jsonb_typeof(item.value)<>'string' OR length(btrim(item.value#>>'{}')) NOT BETWEEN 1 AND 4096 THEN RAISE EXCEPTION 'invalid_x_credentials' USING ERRCODE='22023';END IF;
   END LOOP;
  END IF;
 END IF;
 INSERT INTO public.merchant_feature_settings(merchant_id,twitter_pixel_id,twitter_event_ids)
 VALUES(p_merchant_id,CASE WHEN p_disconnect IS TRUE THEN NULL ELSE p_pixel_id END,CASE WHEN p_disconnect IS TRUE THEN '{}'::jsonb ELSE p_event_ids END)
 ON CONFLICT(merchant_id) DO UPDATE SET twitter_pixel_id=EXCLUDED.twitter_pixel_id,twitter_event_ids=EXCLUDED.twitter_event_ids,updated_at=now();
 IF p_disconnect THEN DELETE FROM public.merchant_x_ads_credentials WHERE merchant_id=p_merchant_id;
 ELSIF p_credentials IS NOT NULL THEN
  UPDATE public.merchant_x_ads_credentials SET consumer_key=btrim(p_credentials->>'consumerKey'),consumer_secret=btrim(p_credentials->>'consumerSecret'),access_token=btrim(p_credentials->>'accessToken'),access_token_secret=btrim(p_credentials->>'accessTokenSecret'),updated_at=now() WHERE merchant_id=p_merchant_id;
  IF NOT FOUND THEN INSERT INTO public.merchant_x_ads_credentials(merchant_id,consumer_key,consumer_secret,access_token,access_token_secret) VALUES(p_merchant_id,btrim(p_credentials->>'consumerKey'),btrim(p_credentials->>'consumerSecret'),btrim(p_credentials->>'accessToken'),btrim(p_credentials->>'accessTokenSecret'));END IF;
 END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.save_x_ads_settings(uuid,text,jsonb,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_x_ads_settings(uuid,text,jsonb,jsonb,boolean) TO authenticated;
ALTER TABLE public.event_deliveries DROP CONSTRAINT event_deliveries_destination_check;
ALTER TABLE public.event_deliveries ADD CONSTRAINT event_deliveries_destination_check CHECK(destination IN('facebook','tiktok','snapchat','ga4','chatgpt','x')) NOT VALID;
ALTER TABLE public.event_deliveries VALIDATE CONSTRAINT event_deliveries_destination_check;
DO $projection$
DECLARE definition text; entry record; count_updated integer:=0;
BEGIN
 definition:=pg_catalog.pg_get_functiondef('public.resolve_storefront_cached_merchant(text)'::regprocedure);
 IF position($needle$'facebook_pixel_id', fs.facebook_pixel_id,$needle$ IN definition)=0 THEN RAISE EXCEPTION 'cached merchant projection changed';END IF;
 EXECUTE replace(definition,$needle$'facebook_pixel_id', fs.facebook_pixel_id,$needle$,$replacement$'twitter_event_ids', fs.twitter_event_ids, 'facebook_pixel_id', fs.facebook_pixel_id,$replacement$);
 FOR entry IN SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('resolve_storefront_public_snapshot_v2','merchant_feature_settings_public_cache_projection') LOOP
  definition:=pg_catalog.pg_get_functiondef(entry.oid);IF position($needle$'facebook_pixel_id',$needle$ IN definition)=0 THEN RAISE EXCEPTION 'public pixel projection changed';END IF;
  EXECUTE replace(definition,$needle$'facebook_pixel_id',$needle$,$replacement$'twitter_event_ids', 'facebook_pixel_id',$replacement$);count_updated:=count_updated+1;
 END LOOP;
 IF count_updated<>2 THEN RAISE EXCEPTION 'public projection functions missing';END IF;
 definition:=pg_catalog.pg_get_functiondef('private.audit_merchant_feature_settings_change_v1()'::regprocedure);
 IF position($needle$'facebook_pixel_id', 'ga4_api_secret'$needle$ IN definition)=0 OR position($needle$CASE WHEN OLD.facebook_pixel_id IS DISTINCT FROM NEW.facebook_pixel_id$needle$ IN definition)=0 THEN RAISE EXCEPTION 'feature audit classification changed';END IF;
 definition:=replace(definition,$needle$'facebook_pixel_id', 'ga4_api_secret'$needle$,$replacement$'twitter_event_ids', 'facebook_pixel_id', 'ga4_api_secret'$replacement$);
 definition:=replace(definition,$needle$'facebook_pixel_id', pg_catalog.jsonb_build_object('present', NULLIF(pg_catalog.btrim(OLD.facebook_pixel_id), '') IS NOT NULL),$needle$,$replacement$'twitter_event_ids', pg_catalog.jsonb_build_object('present', OLD.twitter_event_ids<>'{}'::jsonb), 'facebook_pixel_id', pg_catalog.jsonb_build_object('present', NULLIF(pg_catalog.btrim(OLD.facebook_pixel_id), '') IS NOT NULL),$replacement$);
 definition:=replace(definition,$needle$'facebook_pixel_id', pg_catalog.jsonb_build_object('present', NULLIF(pg_catalog.btrim(NEW.facebook_pixel_id), '') IS NOT NULL),$needle$,$replacement$'twitter_event_ids', pg_catalog.jsonb_build_object('present', NEW.twitter_event_ids<>'{}'::jsonb), 'facebook_pixel_id', pg_catalog.jsonb_build_object('present', NULLIF(pg_catalog.btrim(NEW.facebook_pixel_id), '') IS NOT NULL),$replacement$);
 definition:=replace(definition,$needle$CASE WHEN OLD.facebook_pixel_id IS DISTINCT FROM NEW.facebook_pixel_id$needle$,$replacement$CASE WHEN OLD.twitter_event_ids IS DISTINCT FROM NEW.twitter_event_ids THEN 'twitter_event_ids' END, CASE WHEN OLD.facebook_pixel_id IS DISTINCT FROM NEW.facebook_pixel_id$replacement$);EXECUTE definition;
 count_updated:=0;
 FOR entry IN SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('route_domain_event_v1','list_event_pipeline_deliveries_v1','select_event_pipeline_replay_ids_v1','list_event_pipeline_deliveries_admin_v3') LOOP
  definition:=pg_catalog.pg_get_functiondef(entry.oid);IF position($needle$('facebook', 'tiktok', 'snapchat', 'ga4', 'chatgpt')$needle$ IN definition)=0 THEN RAISE EXCEPTION 'destination validation changed';END IF;
  EXECUTE replace(definition,$needle$('facebook', 'tiktok', 'snapchat', 'ga4', 'chatgpt')$needle$,$replacement$('facebook', 'tiktok', 'snapchat', 'ga4', 'chatgpt', 'x')$replacement$);count_updated:=count_updated+1;
 END LOOP;
 IF count_updated<>4 THEN RAISE EXCEPTION 'routing functions missing';END IF;
END $projection$;
COMMIT;
