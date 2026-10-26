BEGIN;
-- Secrets remain write-only to authenticated owners; no public projection changes.
ALTER TABLE public.merchant_x_ads_credentials
 ADD COLUMN pixel_token text,
 ALTER COLUMN consumer_key DROP NOT NULL,
 ALTER COLUMN consumer_secret DROP NOT NULL,
 ALTER COLUMN access_token DROP NOT NULL,
 ALTER COLUMN access_token_secret DROP NOT NULL;
ALTER TABLE public.merchant_x_ads_credentials ADD CONSTRAINT x_ads_exclusive_authentication CHECK (
 (pixel_token IS NOT NULL AND length(pixel_token) BETWEEN 1 AND 4096 AND pixel_token ~ '^[!-~]+$' AND consumer_key IS NULL AND consumer_secret IS NULL AND access_token IS NULL AND access_token_secret IS NULL)
 OR (pixel_token IS NULL AND consumer_key IS NOT NULL AND consumer_secret IS NOT NULL AND access_token IS NOT NULL AND access_token_secret IS NOT NULL)
);
REVOKE SELECT(pixel_token) ON public.merchant_x_ads_credentials FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.save_x_ads_settings(p_merchant_id uuid,p_pixel_id text,p_event_ids jsonb DEFAULT '{}'::jsonb,p_credentials jsonb DEFAULT NULL,p_disconnect boolean DEFAULT false)
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
   IF jsonb_typeof(p_credentials)<>'object' THEN RAISE EXCEPTION 'invalid_x_credentials' USING ERRCODE='22023';END IF;
   IF p_credentials ? 'pixelToken' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(p_credentials))<>1 OR jsonb_typeof(p_credentials->'pixelToken')<>'string' OR length(p_credentials->>'pixelToken') NOT BETWEEN 1 AND 4096 OR (p_credentials->>'pixelToken')!~'^[!-~]+$' THEN RAISE EXCEPTION 'invalid_x_credentials' USING ERRCODE='22023';END IF;
   ELSE
    IF (SELECT count(*) FROM jsonb_object_keys(p_credentials))<>4 THEN RAISE EXCEPTION 'invalid_x_credentials' USING ERRCODE='22023';END IF;
    FOR item IN SELECT key,value FROM jsonb_each(p_credentials) LOOP
     IF item.key NOT IN('consumerKey','consumerSecret','accessToken','accessTokenSecret') OR jsonb_typeof(item.value)<>'string' OR length(btrim(item.value#>>'{}')) NOT BETWEEN 1 AND 4096 THEN RAISE EXCEPTION 'invalid_x_credentials' USING ERRCODE='22023';END IF;
    END LOOP;
   END IF;
  END IF;
 END IF;
 INSERT INTO public.merchant_feature_settings(merchant_id,twitter_pixel_id,twitter_event_ids)
 VALUES(p_merchant_id,CASE WHEN p_disconnect IS TRUE THEN NULL ELSE p_pixel_id END,CASE WHEN p_disconnect IS TRUE THEN '{}'::jsonb ELSE p_event_ids END)
 ON CONFLICT(merchant_id) DO UPDATE SET twitter_pixel_id=EXCLUDED.twitter_pixel_id,twitter_event_ids=EXCLUDED.twitter_event_ids,updated_at=now();
 IF p_disconnect THEN DELETE FROM public.merchant_x_ads_credentials WHERE merchant_id=p_merchant_id;
 ELSIF p_credentials IS NOT NULL THEN
  UPDATE public.merchant_x_ads_credentials SET pixel_token=p_credentials->>'pixelToken',consumer_key=btrim(p_credentials->>'consumerKey'),consumer_secret=btrim(p_credentials->>'consumerSecret'),access_token=btrim(p_credentials->>'accessToken'),access_token_secret=btrim(p_credentials->>'accessTokenSecret'),updated_at=now() WHERE merchant_id=p_merchant_id;
  IF NOT FOUND THEN
   INSERT INTO public.merchant_x_ads_credentials(merchant_id,pixel_token,consumer_key,consumer_secret,access_token,access_token_secret)
   VALUES(p_merchant_id,p_credentials->>'pixelToken',btrim(p_credentials->>'consumerKey'),btrim(p_credentials->>'consumerSecret'),btrim(p_credentials->>'accessToken'),btrim(p_credentials->>'accessTokenSecret'));
  END IF;
 END IF;
END $fn$;
COMMIT;
