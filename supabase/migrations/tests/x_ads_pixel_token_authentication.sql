BEGIN;
INSERT INTO public.merchants(id,user_id) VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SELECT public.save_x_ads_settings('11111111-1111-4111-8111-111111111111','abc','{}','{"pixelToken":"synthetic-token"}',false);
DO $$ BEGIN
 BEGIN PERFORM pixel_token FROM public.merchant_x_ads_credentials;RAISE EXCEPTION 'token readable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.save_x_ads_settings('11111111-1111-4111-8111-111111111111','abc','{}','{"pixelToken":"synthetic-token","consumerKey":"mixed"}',false);RAISE EXCEPTION 'mixed mode accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.save_x_ads_settings('11111111-1111-4111-8111-111111111111','abc','{}',jsonb_build_object('pixelToken',E'bad\r\nheader'),false);RAISE EXCEPTION 'malformed token accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.merchant_x_ads_credentials WHERE pixel_token='synthetic-token' AND consumer_key IS NULL AND consumer_secret IS NULL AND access_token IS NULL AND access_token_secret IS NULL) THEN RAISE EXCEPTION 'token auth not exclusive';END IF;
 BEGIN UPDATE public.merchant_x_ads_credentials SET consumer_key='mixed';RAISE EXCEPTION 'CHECK accepted mixed authentication';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN UPDATE public.merchant_x_ads_credentials SET pixel_token=NULL;RAISE EXCEPTION 'CHECK accepted missing authentication';EXCEPTION WHEN check_violation THEN NULL;END;
 IF has_column_privilege('authenticated','public.merchant_x_ads_credentials','pixel_token','SELECT') OR has_table_privilege('anon','public.merchant_x_ads_credentials','SELECT') THEN RAISE EXCEPTION 'token privilege leaked';END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.merchant_x_ads_credentials) THEN RAISE EXCEPTION 'cross-tenant presence leak';END IF;
 BEGIN PERFORM public.save_x_ads_settings('11111111-1111-4111-8111-111111111111','abc','{}','{"pixelToken":"other"}',false);RAISE EXCEPTION 'cross-tenant mutation';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SELECT public.save_x_ads_settings('11111111-1111-4111-8111-111111111111','abc','{}','{"consumerKey":"key","consumerSecret":"secret","accessToken":"token","accessTokenSecret":"secret"}',false);
RESET ROLE;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.merchant_x_ads_credentials WHERE pixel_token IS NULL AND consumer_key='key') THEN RAISE EXCEPTION 'OAuth did not clear token';END IF;END $$;
SET LOCAL ROLE authenticated;
SELECT public.save_x_ads_settings('11111111-1111-4111-8111-111111111111','abc','{}','{"pixelToken":"replacement-token"}',false);
SELECT public.save_x_ads_settings('11111111-1111-4111-8111-111111111111','abc','{}',NULL,false);
RESET ROLE;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.merchant_x_ads_credentials WHERE pixel_token='replacement-token' AND consumer_secret IS NULL) THEN RAISE EXCEPTION 'OAuth not cleared or blank save erased token';END IF;END $$;
SET LOCAL ROLE authenticated;
SELECT public.save_x_ads_settings('11111111-1111-4111-8111-111111111111',NULL,'{}',NULL,true);
RESET ROLE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.merchant_x_ads_credentials) THEN RAISE EXCEPTION 'disconnect retained token';END IF;END $$;
SELECT 'x_pixel_token_contract_passed';
ROLLBACK;
