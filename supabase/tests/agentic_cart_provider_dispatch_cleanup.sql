-- Lost acknowledgement and retention behavior run after the base fence
-- fixture commits its durable tables and enables the dormant gate.
INSERT INTO public.commerce_carts(id,merchant_id,version,state,expires_at)
VALUES ('eeeeeeee-4000-4000-8000-000000000021','11111111-1111-4111-8111-111111111111',1,'active',now()+interval '1 day');
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,principal_type,expires_at,device_principal_id)
VALUES ('eeeeeeee-4000-4000-8000-000000000022','11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000021','lost-ack-principal','guest',now()+interval '1 day','lost-ack-root');
INSERT INTO public.commerce_cart_checkout_sessions(id,merchant_id,cart_id,checkout_generation,cart_version_reviewed,principal_id,status,expires_at,preparing_grant_id)
VALUES ('eeeeeeee-4000-4000-8000-000000000023','11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000021',9,1,'lost-ack-principal','active',now()+interval '1 day','eeeeeeee-4000-4000-8000-000000000022');
-- Simulate the older checkout generation left behind after prepare creates a
-- newer generation on this same cart. It is not referenced by the hold itself.
INSERT INTO public.commerce_cart_checkout_sessions(id,merchant_id,cart_id,checkout_generation,cart_version_reviewed,principal_id,status,expires_at,preparing_grant_id)
VALUES ('eeeeeeee-4000-4000-8000-000000000032','11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000021',8,1,'lost-ack-principal','active',now()-interval '3 days','eeeeeeee-4000-4000-8000-000000000022');
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

-- A live hold blocks grant edits but must not block logout's exact grant
-- revocation. The effective device key differs from the prepared principal.
-- Positive control: the same effective device can admit a valid checkout
-- before its retirement tombstone exists.
INSERT INTO public.commerce_carts(id,merchant_id,version,state,expires_at)
VALUES ('eeeeeeee-4000-4000-8000-000000000045','11111111-1111-4111-8111-111111111111',1,'active',now()+interval '1 day');
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,principal_type,expires_at,device_principal_id)
VALUES ('eeeeeeee-4000-4000-8000-000000000046','11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000045','control-principal','guest',now()+interval '1 day','lost-ack-root');
INSERT INTO public.commerce_cart_checkout_sessions(id,merchant_id,cart_id,checkout_generation,cart_version_reviewed,principal_id,status,expires_at,preparing_grant_id)
VALUES ('eeeeeeee-4000-4000-8000-000000000047','11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000045',1,1,'control-principal','active',now()+interval '1 day','eeeeeeee-4000-4000-8000-000000000046');
INSERT INTO public.checkout_sessions(id,session_id,merchant_id,status,metadata,payment_reference)
VALUES ('eeeeeeee-4000-4000-8000-000000000048','dispatch-before-revoke','11111111-1111-4111-8111-111111111111','processing','{"agentic":{"payment_state":"claiming_payment"}}','claim-before-revoke');
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','aud','authenticated','agentic_context','checkout',
    'agentic_session_id','dispatch-before-revoke',
    'agentic_merchant_id','11111111-1111-4111-8111-111111111111',
    'agentic_shared_cart_checkout_binding',jsonb_build_object(
      'version',1,'agentic_session_id','dispatch-before-revoke',
      'cart_id','eeeeeeee-4000-4000-8000-000000000045',
      'checkout_session_id','eeeeeeee-4000-4000-8000-000000000047',
      'checkout_generation',1,'cart_version',1,'principal_id','control-principal',
      'identity_kind','idempotent','checkout_variant','base'
    ))::text,true);
  r:=public.commerce_cart_admit_agentic_dva_dispatch('claim-before-revoke');
  IF r->>'status' IS DISTINCT FROM 'dispatch_permitted' THEN
    RAISE EXCEPTION 'valid non-retired linked device positive control failed: %',r;
  END IF;
END $$;
DO $$
DECLARE r jsonb;
BEGIN
  BEGIN
    UPDATE public.commerce_cart_grants SET expires_at=expires_at+interval '1 hour'
     WHERE id='eeeeeeee-4000-4000-8000-000000000022';
    RAISE EXCEPTION 'held grant allowed non-revocation mutation';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'role','commerce_cart_shopper','exp',extract(epoch FROM now())::bigint+3600,
    'cart_scope','session','cart_merchant_id','11111111-1111-4111-8111-111111111111',
    'cart_principal_id','lost-ack-principal','cart_id','eeeeeeee-4000-4000-8000-000000000021',
    'cart_grant_id','eeeeeeee-4000-4000-8000-000000000022'
  )::text,true);
  r:=public.commerce_cart_revoke_device_grants();
  IF r->>'ok' IS DISTINCT FROM 'true'
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_grants WHERE id='eeeeeeee-4000-4000-8000-000000000022' AND revoked_at IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_grants WHERE id='eeeeeeee-4000-4000-8000-000000000046' AND revoked_at IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_device_retirements WHERE merchant_id='11111111-1111-4111-8111-111111111111' AND device_principal_id='lost-ack-root')
     OR NOT private.agentic_cart_dispatch_hold_is_live('11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000021')
     OR NOT private.agentic_cart_dispatch_hold_is_live('11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000045') THEN
    RAISE EXCEPTION 'scoped device logout failed or released the admitted hold: %',r;
  END IF;
END $$;

-- A new, otherwise-valid grant for the retired device cannot start dispatch
-- on another cart after logout.
INSERT INTO public.commerce_carts(id,merchant_id,version,state,expires_at)
VALUES ('eeeeeeee-4000-4000-8000-000000000041','11111111-1111-4111-8111-111111111111',1,'active',now()+interval '1 day');
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,principal_type,expires_at,device_principal_id)
VALUES ('eeeeeeee-4000-4000-8000-000000000042','11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000041','new-lost-ack-principal','guest',now()+interval '1 day','lost-ack-root');
INSERT INTO public.commerce_cart_checkout_sessions(id,merchant_id,cart_id,checkout_generation,cart_version_reviewed,principal_id,status,expires_at,preparing_grant_id)
VALUES ('eeeeeeee-4000-4000-8000-000000000043','11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000041',1,1,'new-lost-ack-principal','active',now()+interval '1 day','eeeeeeee-4000-4000-8000-000000000042');
INSERT INTO public.checkout_sessions(id,session_id,merchant_id,status,metadata,payment_reference)
VALUES ('eeeeeeee-4000-4000-8000-000000000044','dispatch-after-revoke','11111111-1111-4111-8111-111111111111','processing','{"agentic":{"payment_state":"claiming_payment"}}','claim-after-revoke');
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','aud','authenticated','agentic_context','checkout',
    'agentic_session_id','dispatch-after-revoke',
    'agentic_merchant_id','11111111-1111-4111-8111-111111111111',
    'agentic_shared_cart_checkout_binding',jsonb_build_object(
      'version',1,'agentic_session_id','dispatch-after-revoke',
      'cart_id','eeeeeeee-4000-4000-8000-000000000041',
      'checkout_session_id','eeeeeeee-4000-4000-8000-000000000043',
      'checkout_generation',1,'cart_version',1,'principal_id','new-lost-ack-principal',
      'identity_kind','idempotent','checkout_variant','base'
    ))::text,true);
  r:=public.commerce_cart_admit_agentic_dva_dispatch('claim-after-revoke');
  IF r->>'status' IS DISTINCT FROM 'blocked'
     OR EXISTS (SELECT 1 FROM private.agentic_cart_dispatch_holds WHERE claim_reference='claim-after-revoke') THEN
    RAISE EXCEPTION 'retired linked device created a new dispatch hold: %',r;
  END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'role','commerce_cart_shopper','exp',extract(epoch FROM now())::bigint+3600,
    'cart_scope','session','cart_merchant_id','11111111-1111-4111-8111-111111111111',
    'cart_principal_id','new-lost-ack-principal','cart_id','eeeeeeee-4000-4000-8000-000000000041',
    'cart_grant_id','eeeeeeee-4000-4000-8000-000000000042'
  )::text,true);
  r:=public.commerce_cart_mutate('eeeeeeee-4000-4000-8000-000000000041','after-revoke',1,
    '{"type":"clear"}'::jsonb);
  IF r->>'code' IS DISTINCT FROM 'unauthorized' THEN
    RAISE EXCEPTION 'revoked device retained shopper authority: %',r;
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
UPDATE public.commerce_carts SET updated_at=now()-interval '120 days'
  WHERE id='eeeeeeee-4000-4000-8000-000000000001';
SELECT set_config('session_replication_role','origin',false);
DO $$ BEGIN
  PERFORM public.cleanup_commerce_carts();
  IF NOT EXISTS (SELECT 1 FROM public.commerce_carts WHERE id='eeeeeeee-4000-4000-8000-000000000021' AND state='active')
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_checkout_sessions WHERE id='eeeeeeee-4000-4000-8000-000000000032') THEN
    RAISE EXCEPTION 'cleanup changed active expired held cart or deleted an older generation';
  END IF;
END $$;
-- Turn the same held cart terminal only after proving the expiry cleanup path;
-- the terminal purge then exercises its separate hold-retention predicate.
SELECT set_config('session_replication_role','replica',false);
UPDATE public.commerce_carts SET state='expired',updated_at=now()-interval '120 days'
  WHERE id='eeeeeeee-4000-4000-8000-000000000021';
SELECT set_config('session_replication_role','origin',false);
DO $$ BEGIN
  PERFORM public.cleanup_commerce_carts();
  IF NOT private.agentic_cart_dispatch_hold_is_live('11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000021')
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_checkout_sessions WHERE id='eeeeeeee-4000-4000-8000-000000000023')
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_checkout_sessions WHERE id='eeeeeeee-4000-4000-8000-000000000032')
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_checkout_sessions WHERE id='eeeeeeee-4000-4000-8000-000000000003')
     OR NOT EXISTS (SELECT 1 FROM public.commerce_carts WHERE id='eeeeeeee-4000-4000-8000-000000000021' AND state='expired')
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_handoffs WHERE handoff_hash=repeat('b',64))
     OR EXISTS (SELECT 1 FROM public.commerce_cart_handoffs WHERE handoff_hash=repeat('c',64))
     OR NOT EXISTS (SELECT 1 FROM public.commerce_carts WHERE id='eeeeeeee-4000-4000-8000-000000000031' AND state='expired') THEN
    RAISE EXCEPTION 'cleanup did not retain held audit rows and drain unrelated expired rows';
  END IF;
END $$;

-- Terminal purge must retain carts for any dispatch hold (live or terminal)
-- while still purging an unrelated old terminal cart in the same batch.
INSERT INTO public.commerce_carts(id,merchant_id,version,state,updated_at,expires_at)
VALUES ('eeeeeeee-4000-4000-8000-000000000033','11111111-1111-4111-8111-111111111111',1,'expired',now()-interval '120 days',now()-interval '120 days');
DO $$ BEGIN
  PERFORM public.commerce_cart_purge_terminal_carts(interval '90 days',10000);
  IF NOT EXISTS (SELECT 1 FROM public.commerce_carts WHERE id='eeeeeeee-4000-4000-8000-000000000001')
     OR NOT EXISTS (SELECT 1 FROM public.commerce_carts WHERE id='eeeeeeee-4000-4000-8000-000000000021')
     OR EXISTS (SELECT 1 FROM public.commerce_carts WHERE id='eeeeeeee-4000-4000-8000-000000000033') THEN
    RAISE EXCEPTION 'terminal purge did not retain held carts and remove unrelated terminal cart';
  END IF;
END $$;
SELECT dblink_disconnect('dispatch_lost_ack');
