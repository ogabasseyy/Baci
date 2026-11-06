-- Lost acknowledgement and retention behavior run after the base fence
-- fixture commits its durable tables and enables the dormant gate.
INSERT INTO public.commerce_carts(id,merchant_id,version,state,expires_at)
VALUES ('eeeeeeee-4000-4000-8000-000000000021','11111111-1111-4111-8111-111111111111',1,'active',now()+interval '1 day');
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,principal_type,expires_at)
VALUES ('eeeeeeee-4000-4000-8000-000000000022','11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000021','lost-ack-principal','guest',now()+interval '1 day');
INSERT INTO public.commerce_cart_checkout_sessions(id,merchant_id,cart_id,checkout_generation,cart_version_reviewed,principal_id,status,expires_at,preparing_grant_id)
VALUES ('eeeeeeee-4000-4000-8000-000000000023','11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000021',9,1,'lost-ack-principal','active',now()+interval '1 day','eeeeeeee-4000-4000-8000-000000000022');
INSERT INTO public.checkout_sessions(id,session_id,merchant_id,status,metadata,payment_reference)
VALUES ('eeeeeeee-4000-4000-8000-000000000024','dispatch-lost-ack-session','11111111-1111-4111-8111-111111111111','processing','{"agentic":{"payment_state":"claiming_payment"}}','claim-lost-ack-1');
INSERT INTO public.commerce_cart_handoffs(handoff_hash,merchant_id,source_cart_id,expires_at)
VALUES (repeat('b',64),'11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000021',now()-interval '3 days');
INSERT INTO public.commerce_cart_handoffs(handoff_hash,merchant_id,source_cart_id,expires_at)
VALUES (repeat('c',64),'11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000005',now()-interval '3 days');
INSERT INTO public.commerce_carts(id,merchant_id,version,state,expires_at)
VALUES ('eeeeeeee-4000-4000-8000-000000000031','11111111-1111-4111-8111-111111111111',1,'active',now()-interval '3 days');

CREATE FUNCTION private.test_agentic_dispatch_lost_ack_admission() RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','aud','authenticated','agentic_context','checkout',
    'agentic_session_id','dispatch-lost-ack-session',
    'agentic_merchant_id','11111111-1111-4111-8111-111111111111',
    'agentic_shared_cart_checkout_binding',jsonb_build_object(
      'version',1,'agentic_session_id','dispatch-lost-ack-session',
      'cart_id','eeeeeeee-4000-4000-8000-000000000021',
      'checkout_session_id','eeeeeeee-4000-4000-8000-000000000023',
      'checkout_generation',9,'cart_version',1,'idempotency_key','lost-ack-key',
      'principal_id','lost-ack-principal','identity_kind','idempotent',
      'checkout_variant','base','checkout_request_hash',repeat('c',64)
    ))::text,true);
  RETURN public.commerce_cart_admit_agentic_dva_dispatch('claim-lost-ack-1');
END $$;
SELECT dblink_connect('dispatch_lost_ack','__PG_CONN__');
SELECT dblink_send_query('dispatch_lost_ack','SELECT private.test_agentic_dispatch_lost_ack_admission()');
SELECT * FROM dblink_get_result('dispatch_lost_ack') AS t(result jsonb); -- discard lost acknowledgement
SELECT * FROM dblink_get_result('dispatch_lost_ack') AS t(result jsonb); -- clear completed command
SELECT dblink_send_query('dispatch_lost_ack','SELECT private.test_agentic_dispatch_lost_ack_admission()');
CREATE TEMP TABLE lost_ack_retry(result jsonb);
INSERT INTO lost_ack_retry SELECT result FROM dblink_get_result('dispatch_lost_ack') AS t(result jsonb);
DO $$ BEGIN
  IF (SELECT result->>'status' FROM lost_ack_retry) IS DISTINCT FROM 'dispatch_unknown'
     OR NOT private.agentic_cart_dispatch_hold_is_live('11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000021') THEN
    RAISE EXCEPTION 'lost acknowledgement retry did not fail closed: %',(SELECT result FROM lost_ack_retry);
  END IF;
END $$;

-- Expire both a live unresolved generation and the submitted session for the
-- earlier order_completed hold; cleanup must retain both for audit/recovery.
SELECT set_config('session_replication_role','replica',false);
UPDATE public.commerce_carts SET expires_at=now()-interval '3 days'
  WHERE id='eeeeeeee-4000-4000-8000-000000000021';
UPDATE public.commerce_cart_checkout_sessions SET expires_at=now()-interval '3 days'
  WHERE id='eeeeeeee-4000-4000-8000-000000000023';
UPDATE public.commerce_cart_checkout_sessions SET submitted_at=now()-interval '120 days'
  WHERE id='eeeeeeee-4000-4000-8000-000000000003';
SELECT set_config('session_replication_role','origin',false);
DO $$ BEGIN
  PERFORM public.cleanup_commerce_carts();
  IF NOT private.agentic_cart_dispatch_hold_is_live('11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000021')
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_checkout_sessions WHERE id='eeeeeeee-4000-4000-8000-000000000023')
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_checkout_sessions WHERE id='eeeeeeee-4000-4000-8000-000000000003')
     OR NOT EXISTS (SELECT 1 FROM public.commerce_carts WHERE id='eeeeeeee-4000-4000-8000-000000000021' AND state='active')
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_handoffs WHERE handoff_hash=repeat('b',64))
     OR EXISTS (SELECT 1 FROM public.commerce_cart_handoffs WHERE handoff_hash=repeat('c',64))
     OR NOT EXISTS (SELECT 1 FROM public.commerce_carts WHERE id='eeeeeeee-4000-4000-8000-000000000031' AND state='expired') THEN
    RAISE EXCEPTION 'cleanup did not retain held audit rows and drain unrelated expired rows';
  END IF;
END $$;
SELECT dblink_disconnect('dispatch_lost_ack');
