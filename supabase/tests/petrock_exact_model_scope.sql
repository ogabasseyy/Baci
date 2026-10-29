-- Disposable isolated database only.
DO $$ BEGIN
 IF public.petrock_model_scope_matches('iPhone 17 Pro Max (A3525)', '{"kind":"set","models":["iphone-17"]}'::jsonb) IS DISTINCT FROM false THEN RAISE EXCEPTION 'base scope accepted Pro Max'; END IF;
 IF public.petrock_model_scope_matches('iPhone 17 Pro Max (A3525)', '{"kind":"set","models":["iphone-17-pro-max"]}'::jsonb) IS DISTINCT FROM true THEN RAISE EXCEPTION 'exact variant rejected'; END IF;
 IF public.petrock_model_scope_matches('iPhone 17 Pro Max (A3525)', '{"kind":"range","family":"iphone","min":17,"max":17}'::jsonb) IS DISTINCT FROM true THEN RAISE EXCEPTION 'series range rejected'; END IF;
 IF public.petrock_model_scope_matches('iPhone 17 Ultra', '{"kind":"set","models":["iphone-17"]}'::jsonb) IS DISTINCT FROM false THEN RAISE EXCEPTION 'ambiguous model accepted'; END IF;
 IF public.petrock_model_scope_matches('iPhone 17 Pro Max 512GB', '{"kind":"set","models":["iphone-17-pro-max"]}'::jsonb) IS DISTINCT FROM false THEN RAISE EXCEPTION 'ambiguous description accepted'; END IF;
 IF public.petrock_model_scope_matches('iPhone 17 Ultra', '{"kind":"set","models":[""]}'::jsonb) IS DISTINCT FROM false THEN RAISE EXCEPTION 'empty canonical matched malformed set'; END IF;
 IF public.petrock_model_scope_matches('Samsung Galaxy S25 Ultra', '{"kind":"set","models":["samsung-s25"]}'::jsonb) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Samsung variant collapsed'; END IF;
 IF public.petrock_model_scope_matches('iPad Pro 11', '{"kind":"set","models":["ipad-11"]}'::jsonb) IS DISTINCT FROM false THEN RAISE EXCEPTION 'iPad variant collapsed'; END IF;
 IF has_function_privilege('anon','public.petrock_model_scope_matches(text,jsonb)','execute') OR has_function_privilege('authenticated','public.petrock_model_scope_matches(text,jsonb)','execute') THEN RAISE EXCEPTION 'model function ACL widened'; END IF;
 IF public.petrock_model_scope_matches('Unknown Device', '{"kind":"generic"}'::jsonb) IS DISTINCT FROM false THEN RAISE EXCEPTION 'placeholder matched generic scope'; END IF;
 IF public.petrock_model_scope_matches('iPad Pro 11', '{"kind":"range","min":11,"max":11}'::jsonb) IS DISTINCT FROM false THEN RAISE EXCEPTION 'iPad screen size matched series'; END IF;
 IF public.petrock_model_scope_matches('iPhone 17', '{"kind":"generic","family":null}'::jsonb) IS DISTINCT FROM false THEN RAISE EXCEPTION 'null family accepted'; END IF;
 IF public.petrock_model_scope_matches('iPhone 17', '{"kind":"generic","family":""}'::jsonb) IS DISTINCT FROM false THEN RAISE EXCEPTION 'empty family accepted'; END IF;
 IF public.petrock_model_scope_matches('iPhone 17', '{"kind":"set","models":["iphone-17",null]}'::jsonb) IS DISTINCT FROM false THEN RAISE EXCEPTION 'invalid set accepted'; END IF;
 IF public.petrock_model_scope_matches('iPhone 17', '{"kind":"range"}'::jsonb) IS DISTINCT FROM false THEN RAISE EXCEPTION 'missing bounds did not fail closed'; END IF;
 IF public.petrock_model_scope_matches('iPhone 17', '{"kind":"range","min":16}'::jsonb) IS DISTINCT FROM false THEN RAISE EXCEPTION 'missing max did not fail closed'; END IF;
 IF public.petrock_model_scope_matches('iPhone 17', '{"kind":"range","min":"16","max":17}'::jsonb) IS DISTINCT FROM false THEN RAISE EXCEPTION 'string bound accepted'; END IF;
 IF public.petrock_model_scope_matches('iPhone 17', '{"kind":"range","min":18,"max":17}'::jsonb) IS DISTINCT FROM false THEN RAISE EXCEPTION 'reversed bounds accepted'; END IF;
 IF public.petrock_model_scope_matches('iPhone 17', '{"kind":"range","min":16.5,"max":17}'::jsonb) IS DISTINCT FROM false THEN RAISE EXCEPTION 'fractional bound accepted'; END IF;
 IF public.petrock_model_scope_matches('iPhone18,2', '{"kind":"range","family":"iphone","min":18,"max":18}'::jsonb) IS DISTINCT FROM false THEN RAISE EXCEPTION 'hardware identifier matched generation'; END IF;
 IF public.petrock_model_scope_matches('iPhone 17', '{"kind":"set","models":["iphone-17"]}'::jsonb) IS DISTINCT FROM true THEN RAISE EXCEPTION 'base model rejected'; END IF;
END $$;
