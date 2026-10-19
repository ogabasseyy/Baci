-- Scoped device logout; account continuity contracts are additive below.
ALTER TABLE public.commerce_cart_grants ADD COLUMN device_principal_id text NULL;
CREATE INDEX commerce_cart_grants_device_idx ON public.commerce_cart_grants(merchant_id,coalesce(device_principal_id,principal_id));
CREATE TABLE public.commerce_cart_device_retirements (
 merchant_id uuid NOT NULL REFERENCES public.merchants(id),device_principal_id text NOT NULL,retired_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(merchant_id,device_principal_id)
);
ALTER TABLE public.commerce_cart_device_retirements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commerce_cart_device_retirements FROM PUBLIC,anon,authenticated,commerce_cart_shopper,commerce_cart_receiver,commerce_cart_worker;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='commerce_cart_revoker') THEN CREATE ROLE commerce_cart_revoker NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; END IF; END $$;
GRANT USAGE ON SCHEMA public TO commerce_cart_revoker;
GRANT commerce_cart_revoker TO authenticator;
CREATE OR REPLACE FUNCTION public.commerce_cart_revoke_device_grants()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claims jsonb:=auth.jwt(); merchant uuid; cart uuid; grant_id uuid; principal text; device text; affected integer;
BEGIN
 IF NOT coalesce(claims->>'role' IN ('commerce_cart_shopper','commerce_cart_revoker'),false)
   OR NOT coalesce(claims->>'cart_scope' IN ('session','bootstrap'),false)
   OR jsonb_typeof(claims->'exp') IS DISTINCT FROM 'number'
   OR coalesce((claims->>'exp')::numeric,0)<=extract(epoch from now()) THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
 merchant:=(claims->>'cart_merchant_id')::uuid; principal:=claims->>'cart_principal_id';
 IF merchant IS NULL OR coalesce(principal,'')='' THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
 IF claims->>'cart_scope'='session' THEN
  cart:=(claims->>'cart_id')::uuid; grant_id:=(claims->>'cart_grant_id')::uuid;
  SELECT coalesce(g.device_principal_id,g.principal_id) INTO device FROM public.commerce_cart_grants g
  WHERE g.id=grant_id AND g.merchant_id=merchant AND g.cart_id=cart AND g.principal_id=principal;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
 ELSE
  IF nullif(claims->>'cart_id','') IS NOT NULL OR nullif(claims->>'cart_grant_id','') IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
  device:=principal;
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cc-device-revoke|'||merchant::text||'|'||device,0));
 INSERT INTO public.commerce_cart_device_retirements(merchant_id,device_principal_id) VALUES(merchant,device) ON CONFLICT DO NOTHING;
 UPDATE public.commerce_cart_grants g SET revoked_at=now()
 WHERE g.merchant_id=merchant AND coalesce(g.device_principal_id,g.principal_id)=device AND g.revoked_at IS NULL;
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN jsonb_build_object('ok',true,'revoked',affected);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR foreign_key_violation THEN RETURN jsonb_build_object('ok',false,'code','unauthorized');
END $$;
REVOKE ALL ON FUNCTION public.commerce_cart_revoke_device_grants() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_cart_revoke_device_grants() TO commerce_cart_shopper,commerce_cart_revoker;

-- Serialize authority acquisition with device retirement, including bootstrap
-- races that have not minted a grant yet. This helper is never callable by clients.
CREATE FUNCTION public.commerce_cart_device_is_active()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claims jsonb:=auth.jwt(); merchant uuid; device text;
BEGIN
 IF claims->>'role' IS DISTINCT FROM 'commerce_cart_shopper'
  OR jsonb_typeof(claims->'exp') IS DISTINCT FROM 'number'
  OR coalesce((claims->>'exp')::numeric,0)<=extract(epoch from now()) THEN RETURN false; END IF;
 merchant:=(claims->>'cart_merchant_id')::uuid;
 IF claims->>'cart_scope'='bootstrap' THEN
  IF nullif(claims->>'cart_id','') IS NOT NULL OR nullif(claims->>'cart_grant_id','') IS NOT NULL THEN RETURN false; END IF;
  device:=claims->>'cart_principal_id';
 ELSIF claims->>'cart_scope'='session' THEN
  SELECT coalesce(g.device_principal_id,g.principal_id) INTO device FROM public.commerce_cart_grants g
  WHERE g.id=(claims->>'cart_grant_id')::uuid AND g.merchant_id=merchant
   AND g.cart_id=(claims->>'cart_id')::uuid AND g.principal_id=claims->>'cart_principal_id';
 ELSE RETURN false;
 END IF;
 IF merchant IS NULL OR coalesce(device,'')='' THEN RETURN false; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cc-device-revoke|'||merchant::text||'|'||device,0));
 RETURN NOT EXISTS(SELECT 1 FROM public.commerce_cart_device_retirements r WHERE r.merchant_id=merchant AND r.device_principal_id=device);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.commerce_cart_device_is_active() FROM PUBLIC,anon,authenticated,service_role,commerce_cart_shopper,commerce_cart_receiver,commerce_cart_worker,commerce_cart_revoker;

ALTER FUNCTION public.commerce_cart_create(text,jsonb,text) RENAME TO commerce_cart_create_device_impl;
REVOKE ALL ON FUNCTION public.commerce_cart_create_device_impl(text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role,commerce_cart_shopper,commerce_cart_receiver,commerce_cart_worker;
CREATE FUNCTION public.commerce_cart_create(p_operation_id text,p_lines jsonb,p_currency text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.commerce_cart_device_is_active() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','state',null,'replayed',false); END IF;
 RETURN public.commerce_cart_create_device_impl(p_operation_id,p_lines,p_currency);
END $$;
REVOKE ALL ON FUNCTION public.commerce_cart_create(text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commerce_cart_create(text,jsonb,text) TO commerce_cart_shopper;
