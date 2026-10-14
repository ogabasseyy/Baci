-- New grants support the complete command vocabulary. Existing restricted
-- grants are intentionally left unchanged; no migration escalates a grant.
ALTER TABLE public.commerce_cart_grants ALTER COLUMN allowed_operations
  SET DEFAULT '{add,set_quantity,remove,clear,replace}';

-- Keep the reviewed executor private; every public mutation now checks the
-- stored operation grant in the same transaction before reaching it.
ALTER FUNCTION public.commerce_cart_mutate(uuid,text,integer,jsonb)
  RENAME TO commerce_cart_mutate_authorized_impl;
REVOKE ALL ON FUNCTION public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,commerce_cart_shopper,commerce_cart_receiver,commerce_cart_worker;

CREATE FUNCTION public.commerce_cart_mutate(
 p_cart_id uuid,p_operation_id text,p_expected_version integer,p_command jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_claims jsonb := auth.jwt(); v_id uuid;
BEGIN
 IF v_claims->>'role' IS DISTINCT FROM 'commerce_cart_shopper'
   OR v_claims->>'cart_scope' IS DISTINCT FROM 'session'
   OR jsonb_typeof(v_claims->'exp') IS DISTINCT FROM 'number'
   OR coalesce((v_claims->>'exp')::numeric,0) <= extract(epoch from now())
   OR (v_claims->>'cart_id')::uuid IS DISTINCT FROM p_cart_id THEN
   RETURN jsonb_build_object('ok',false,'code','unauthorized','state',null,'currentVersion',null,'replayed',false);
 END IF;
 IF NOT public.commerce_cart_device_is_active() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','state',null,'replayed',false); END IF;
 SELECT id INTO v_id FROM public.commerce_cart_grants
 WHERE id=(v_claims->>'cart_grant_id')::uuid
   AND merchant_id=(v_claims->>'cart_merchant_id')::uuid
   AND cart_id=p_cart_id AND principal_id=v_claims->>'cart_principal_id'
   AND expires_at>now() AND revoked_at IS NULL
   AND (p_command->>'type')=ANY(allowed_operations)
;
 IF FOUND THEN
   -- Match handoff lock order (cart before grant). Recheck after acquiring both.
   PERFORM 1 FROM public.commerce_carts WHERE id=p_cart_id AND merchant_id=(v_claims->>'cart_merchant_id')::uuid FOR UPDATE;
   SELECT id INTO v_id FROM public.commerce_cart_grants
   WHERE id=(v_claims->>'cart_grant_id')::uuid
     AND merchant_id=(v_claims->>'cart_merchant_id')::uuid
     AND cart_id=p_cart_id AND principal_id=v_claims->>'cart_principal_id'
     AND expires_at>now() AND revoked_at IS NULL
     AND (p_command->>'type')=ANY(allowed_operations)
   FOR UPDATE;
 END IF;
 IF NOT FOUND THEN
   RETURN jsonb_build_object('ok',false,'code','unauthorized','state',null,'currentVersion',null,'replayed',false);
 END IF;
 RETURN public.commerce_cart_mutate_authorized_impl(p_cart_id,p_operation_id,p_expected_version,p_command);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RETURN jsonb_build_object('ok',false,'code','unauthorized','state',null,'currentVersion',null,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.commerce_cart_mutate(uuid,text,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commerce_cart_mutate(uuid,text,integer,jsonb) TO commerce_cart_shopper;
