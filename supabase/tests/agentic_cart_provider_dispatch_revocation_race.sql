-- The race must serialize on device_principal_id, not just the per-cart
-- shopper principal. Pause revocation after acquiring that lock but before
-- inserting the tombstone so a stale grant read would otherwise admit.
INSERT INTO public.commerce_carts(id,merchant_id,version,state,expires_at)
VALUES ('eeeeeeee-4000-4000-8000-000000000051','11111111-1111-4111-8111-111111111111',1,'active',now()+interval '1 day');
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,principal_type,expires_at,device_principal_id)
VALUES ('eeeeeeee-4000-4000-8000-000000000052','11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000051','race-cart-principal','guest',now()+interval '1 day','race-device-root');
INSERT INTO public.commerce_cart_checkout_sessions(id,merchant_id,cart_id,checkout_generation,cart_version_reviewed,principal_id,status,expires_at,preparing_grant_id)
VALUES ('eeeeeeee-4000-4000-8000-000000000053','11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000051',1,1,'race-cart-principal','active',now()+interval '1 day','eeeeeeee-4000-4000-8000-000000000052');
INSERT INTO public.checkout_sessions(id,session_id,merchant_id,status,metadata,payment_reference)
VALUES ('eeeeeeee-4000-4000-8000-000000000054','dispatch-linked-race','11111111-1111-4111-8111-111111111111','processing','{"agentic":{"payment_state":"claiming_payment"}}','claim-linked-race');

CREATE FUNCTION private.test_dispatch_slow_retirement_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.device_principal_id='race-device-root' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'dispatch-revocation-test-gate|' || NEW.device_principal_id,0));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER test_dispatch_slow_retirement_insert
  BEFORE INSERT ON public.commerce_cart_device_retirements
  FOR EACH ROW EXECUTE FUNCTION private.test_dispatch_slow_retirement_insert();
CREATE FUNCTION private.test_dispatch_race_revoke() RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',jsonb_build_object(
    'role','commerce_cart_shopper','exp',extract(epoch FROM now())::bigint+3600,
    'cart_scope','session','cart_merchant_id','11111111-1111-4111-8111-111111111111',
    'cart_principal_id','race-cart-principal','cart_id','eeeeeeee-4000-4000-8000-000000000051',
    'cart_grant_id','eeeeeeee-4000-4000-8000-000000000052'
  )::text,true);
  RETURN public.commerce_cart_revoke_device_grants();
END $$;
CREATE FUNCTION private.test_dispatch_race_admit() RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','aud','authenticated','agentic_context','checkout',
    'agentic_session_id','dispatch-linked-race',
    'agentic_merchant_id','11111111-1111-4111-8111-111111111111',
    'agentic_shared_cart_checkout_binding',jsonb_build_object(
      'version',1,'agentic_session_id','dispatch-linked-race',
      'cart_id','eeeeeeee-4000-4000-8000-000000000051',
      'checkout_session_id','eeeeeeee-4000-4000-8000-000000000053',
      'checkout_generation',1,'cart_version',1,'principal_id','race-cart-principal',
      'identity_kind','idempotent','checkout_variant','base'
    ))::text,true);
  RETURN public.commerce_cart_admit_agentic_dva_dispatch('claim-linked-race');
END $$;

CREATE TEMP TABLE linked_race_lock_keys AS
SELECT pg_catalog.hashtextextended('cc-device-revoke|11111111-1111-4111-8111-111111111111|race-device-root',0) AS device_key,
       pg_catalog.hashtextextended('dispatch-revocation-test-gate|race-device-root',0) AS gate_key;
SELECT dblink_connect('linked_gate','__PG_CONN__ application_name=linked_gate');
SELECT dblink_connect('linked_revoker','__PG_CONN__ application_name=linked_revoker');
SELECT dblink_connect('linked_admitter','__PG_CONN__ application_name=linked_admitter');
-- Hold the test gate so the revoker pauses inside the tombstone INSERT only
-- after the production effective-device advisory lock has been acquired.
SELECT * FROM dblink('linked_gate',format(
  'SELECT pg_catalog.pg_advisory_lock(%s) IS NULL',(SELECT gate_key FROM linked_race_lock_keys)
)) AS t(acquired boolean);
SELECT dblink_send_query('linked_revoker','SELECT private.test_dispatch_race_revoke()');
DO $$
DECLARE attempts integer:=0; observed boolean:=false; device_key bigint; gate_key bigint;
BEGIN
  SELECT k.device_key,k.gate_key INTO device_key,gate_key FROM linked_race_lock_keys k;
  WHILE attempts < 1000 AND NOT observed LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_locks l
      JOIN pg_catalog.pg_stat_activity a ON a.pid=l.pid
      WHERE a.application_name='linked_revoker' AND l.locktype='advisory' AND l.granted
        AND l.classid=((device_key >> 32) & 4294967295)::oid
        AND l.objid=(device_key & 4294967295)::oid AND l.objsubid=1
    ) AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_locks l
      JOIN pg_catalog.pg_stat_activity a ON a.pid=l.pid
      WHERE a.application_name='linked_revoker' AND l.locktype='advisory' AND NOT l.granted
        AND l.classid=((gate_key >> 32) & 4294967295)::oid
        AND l.objid=(gate_key & 4294967295)::oid AND l.objsubid=1
    ) INTO observed;
    IF NOT observed THEN PERFORM pg_catalog.pg_sleep(0.01); attempts:=attempts+1; END IF;
  END LOOP;
  IF NOT observed THEN RAISE EXCEPTION 'revoker never reached the observed post-device-lock gate'; END IF;
END $$;
SELECT dblink_send_query('linked_admitter','SELECT private.test_dispatch_race_admit()');
DO $$
DECLARE attempts integer:=0; observed boolean:=false; device_key bigint;
BEGIN
  SELECT k.device_key INTO device_key FROM linked_race_lock_keys k;
  WHILE attempts < 1000 AND NOT observed LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_locks l
      JOIN pg_catalog.pg_stat_activity a ON a.pid=l.pid
      WHERE a.application_name='linked_admitter' AND l.locktype='advisory' AND NOT l.granted
        AND l.classid=((device_key >> 32) & 4294967295)::oid
        AND l.objid=(device_key & 4294967295)::oid AND l.objsubid=1
    ) INTO observed;
    IF NOT observed THEN PERFORM pg_catalog.pg_sleep(0.01); attempts:=attempts+1; END IF;
  END LOOP;
  IF NOT observed THEN RAISE EXCEPTION 'admitter did not wait on the effective device advisory lock'; END IF;
END $$;
SELECT * FROM dblink('linked_gate',format(
  'SELECT pg_catalog.pg_advisory_unlock(%s)',(SELECT gate_key FROM linked_race_lock_keys)
)) AS t(released boolean);
CREATE TEMP TABLE linked_race_results(revocation jsonb, admission jsonb);
INSERT INTO linked_race_results
SELECT revoke_result.result, admit_result.result
FROM dblink_get_result('linked_revoker') AS revoke_result(result jsonb)
CROSS JOIN dblink_get_result('linked_admitter') AS admit_result(result jsonb);
DO $$ BEGIN
  IF (SELECT revocation->>'ok' FROM linked_race_results) IS DISTINCT FROM 'true'
     OR (SELECT admission->>'status' FROM linked_race_results) IS DISTINCT FROM 'blocked'
     OR EXISTS (SELECT 1 FROM private.agentic_cart_dispatch_holds WHERE claim_reference='claim-linked-race') THEN
    RAISE EXCEPTION 'linked-device logout/admission race did not serialize safely: %',(SELECT row_to_json(r) FROM linked_race_results r);
  END IF;
END $$;
SELECT dblink_disconnect('linked_revoker');
SELECT dblink_disconnect('linked_admitter');
SELECT dblink_disconnect('linked_gate');
DROP TRIGGER test_dispatch_slow_retirement_insert ON public.commerce_cart_device_retirements;
