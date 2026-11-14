-- Synthetic contract checks appended to the existing disposable cart chain.
DO $$ BEGIN
  IF has_function_privilege('authenticated','public.commerce_cart_admit_agentic_dva_dispatch(text)','EXECUTE')
     OR has_function_privilege('anon','public.commerce_cart_admit_agentic_dva_dispatch(text)','EXECUTE')
     OR has_function_privilege('service_role','public.commerce_cart_admit_agentic_dva_dispatch(text)','EXECUTE')
     OR has_function_privilege('authenticator','public.commerce_cart_admit_agentic_dva_dispatch(text)','EXECUTE') THEN
    RAISE EXCEPTION 'dispatch admission must remain unreachable to application and gateway roles';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    WHERE p.oid='public.commerce_cart_admit_agentic_dva_dispatch(text)'::regprocedure
      AND acl.privilege_type='EXECUTE'
      AND acl.grantee <> p.proowner
  ) THEN
    RAISE EXCEPTION 'dispatch admission has an execute grant beyond its database owner';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
      WHERE oid='private.agentic_cart_dispatch_rollout'::regclass)
     OR has_table_privilege('anon','private.agentic_cart_dispatch_rollout','SELECT')
     OR has_table_privilege('authenticated','private.agentic_cart_dispatch_rollout','SELECT')
     OR has_table_privilege('service_role','private.agentic_cart_dispatch_rollout','SELECT') THEN
    RAISE EXCEPTION 'dispatch rollout table must have RLS and no application-role grants';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid
    WHERE idx.relname='agentic_cart_dispatch_holds_cart_fk_idx'
      AND i.indrelid='private.agentic_cart_dispatch_holds'::regclass
      AND i.indisvalid AND i.indpred IS NULL
  ) THEN
    RAISE EXCEPTION 'dispatch holds need an unconditional cart foreign-key index';
  END IF;
END $$;
DO $$
DECLARE r jsonb; claims jsonb; missing_key text;
BEGIN
  INSERT INTO public.commerce_carts(id,merchant_id,version,state,expires_at)
  VALUES ('eeeeeeee-4000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',1,'active',now()+interval '1 day');
  INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,principal_type,expires_at)
  VALUES ('eeeeeeee-4000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000001','dispatch-principal','guest',now()+interval '1 day');
  UPDATE public.products SET status='active',price=15,stock=10,stock_quantity=10
   WHERE id='44444444-4444-4444-8444-444444444444';
  INSERT INTO public.commerce_cart_lines(id,merchant_id,cart_id,product_id,quantity,last_unit_price_minor)
  VALUES ('eeeeeeee-4000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111',
    'eeeeeeee-4000-4000-8000-000000000001','44444444-4444-4444-8444-444444444444',1,1500);
  INSERT INTO public.commerce_cart_checkout_sessions(id,merchant_id,cart_id,checkout_generation,cart_version_reviewed,principal_id,status,expires_at,preparing_grant_id,reviewed_snapshot)
  VALUES ('eeeeeeee-4000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000001',7,1,'dispatch-principal','active',now()+interval '1 day','eeeeeeee-4000-4000-8000-000000000002',
    public.commerce_cart_build_checkout_snapshot('11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000001'));
  INSERT INTO public.checkout_sessions(id,session_id,merchant_id,status,metadata,payment_reference,order_id,virtual_account_number)
  VALUES ('eeeeeeee-4000-4000-8000-000000000004','dispatch-agentic-session','11111111-1111-4111-8111-111111111111','processing',
    '{"agentic":{"payment_state":"claiming_payment","shared_cart":{"cart_id":"eeeeeeee-4000-4000-8000-000000000001","checkout_session_id":"eeeeeeee-4000-4000-8000-000000000003","checkout_generation":7,"cart_version":1}}}',
    'claim-dispatch-1',NULL,NULL);
  -- The gate is dormant by default and its trigger must tolerate the real
  -- handoff row shape (source_cart_id, no cart_id column).
  INSERT INTO public.commerce_carts(id,merchant_id,version,state,expires_at)
  VALUES ('eeeeeeee-4000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111',1,'active',now()+interval '1 day');
  INSERT INTO public.commerce_cart_handoffs(handoff_hash,merchant_id,source_cart_id,expires_at)
  VALUES (repeat('e',64),'11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000005',now()+interval '1 day');
  INSERT INTO public.commerce_cart_handoffs(handoff_hash,merchant_id,source_cart_id,expires_at)
  VALUES (repeat('f',64),'11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000001',now()+interval '1 day');
  INSERT INTO public.customers(id,merchant_id,user_id)
  VALUES ('aaaaaaaa-4000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','aaaaaaaa-4000-4000-8000-000000000002');
  INSERT INTO public.commerce_cart_customer_carts(merchant_id,customer_id,cart_id)
  VALUES ('11111111-1111-4111-8111-111111111111','aaaaaaaa-4000-4000-8000-000000000001','eeeeeeee-4000-4000-8000-000000000001');
  UPDATE private.agentic_cart_dispatch_rollout SET enabled=true WHERE singleton;
  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','aud','authenticated','agentic_context','checkout',
    'agentic_session_id','dispatch-agentic-session',
    'agentic_merchant_id','11111111-1111-4111-8111-111111111111',
    'agentic_shared_cart_checkout_binding',jsonb_build_object(
      'version',1,'agentic_session_id','dispatch-agentic-session',
      'cart_id','eeeeeeee-4000-4000-8000-000000000001',
      'checkout_session_id','eeeeeeee-4000-4000-8000-000000000003',
      'checkout_generation',7,'cart_version',1,'idempotency_key','dispatch-key',
      'principal_id','dispatch-principal','identity_kind','idempotent',
      'checkout_variant','base','checkout_request_hash',repeat('a',64)
    ))::text,true);
  -- Even an enabled rollout flag cannot make the RPC callable by authenticated
  -- API sessions before a later reviewed recovery migration restores a grant.
  PERFORM set_config('role','authenticated',true);
  BEGIN
    PERFORM public.commerce_cart_admit_agentic_dva_dispatch('claim-dispatch-1');
    RAISE EXCEPTION 'authenticated dispatch admission unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  PERFORM set_config('role','postgres',true);
  IF EXISTS (SELECT 1 FROM private.agentic_cart_dispatch_holds WHERE claim_reference='claim-dispatch-1') THEN
    RAISE EXCEPTION 'denied authenticated call created a dispatch hold';
  END IF;
  -- Remaining SQL calls run as the disposable database owner to exercise the
  -- admission function's private race/hold invariants behind the revoked API ACL.
  claims:=auth.jwt();
  FOREACH missing_key IN ARRAY ARRAY['cart_id','checkout_session_id','checkout_generation','cart_version'] LOOP
    PERFORM set_config('request.jwt.claims',jsonb_set(claims,
      '{agentic_shared_cart_checkout_binding}',
      (claims->'agentic_shared_cart_checkout_binding')-missing_key)::text,true);
    r:=public.commerce_cart_admit_agentic_dva_dispatch('claim-dispatch-1');
    IF r->>'status' IS DISTINCT FROM 'blocked' OR EXISTS (
      SELECT 1 FROM private.agentic_cart_dispatch_holds
      WHERE claim_reference='claim-dispatch-1'
    ) THEN
      RAISE EXCEPTION 'missing binding field % did not fail closed: %',missing_key,r;
    END IF;
    PERFORM set_config('request.jwt.claims',jsonb_set(claims,
      ARRAY['agentic_shared_cart_checkout_binding',missing_key],'null'::jsonb,true)::text,true);
    r:=public.commerce_cart_admit_agentic_dva_dispatch('claim-dispatch-1');
    IF r->>'status' IS DISTINCT FROM 'blocked' OR EXISTS (
      SELECT 1 FROM private.agentic_cart_dispatch_holds
      WHERE claim_reference='claim-dispatch-1'
    ) THEN
      RAISE EXCEPTION 'explicit-null binding field % did not fail closed: %',missing_key,r;
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claims',claims::text,true);
  -- A processing payment row alone is insufficient: an absent claim state
  -- must fail closed and must not persist a dispatch hold.
  UPDATE public.checkout_sessions SET metadata='{"agentic":{}}'
   WHERE session_id='dispatch-agentic-session';
  r:=public.commerce_cart_admit_agentic_dva_dispatch('claim-dispatch-1');
  IF r->>'status' IS DISTINCT FROM 'blocked' OR EXISTS (
    SELECT 1 FROM private.agentic_cart_dispatch_holds
    WHERE claim_reference='claim-dispatch-1'
  ) THEN
    RAISE EXCEPTION 'missing payment_state did not fail closed: %',r;
  END IF;
  UPDATE public.checkout_sessions SET metadata='{"agentic":{"payment_state":"claiming_payment","shared_cart":{"cart_id":"eeeeeeee-4000-4000-8000-000000000001","checkout_session_id":"eeeeeeee-4000-4000-8000-000000000003","checkout_generation":7,"cart_version":1}}}'
   WHERE session_id='dispatch-agentic-session';
  r:=public.commerce_cart_admit_agentic_dva_dispatch('claim-dispatch-1');
  IF r->>'status' IS DISTINCT FROM 'dispatch_permitted' THEN RAISE EXCEPTION 'first admission not permitted: %',r; END IF;
  IF (SELECT provider_dispatch_fence FROM public.commerce_carts WHERE id='eeeeeeee-4000-4000-8000-000000000001') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'admission did not write cart fence tuple';
  END IF;
  r:=public.commerce_cart_admit_agentic_dva_dispatch('claim-dispatch-1');
  IF r->>'status' IS DISTINCT FROM 'dispatch_unknown' THEN RAISE EXCEPTION 'replay unexpectedly permitted dispatch: %',r; END IF;
  BEGIN
    UPDATE public.commerce_carts SET version=version+1 WHERE id='eeeeeeee-4000-4000-8000-000000000001';
    RAISE EXCEPTION 'held cart mutation unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    UPDATE public.commerce_cart_lines SET cart_id='eeeeeeee-4000-4000-8000-000000000005'
      WHERE id='eeeeeeee-4000-4000-8000-000000000006';
    RAISE EXCEPTION 'line moved away from held cart';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    UPDATE public.commerce_cart_handoffs SET source_cart_id='eeeeeeee-4000-4000-8000-000000000005'
      WHERE handoff_hash=repeat('f',64);
    RAISE EXCEPTION 'handoff moved away from held cart';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.commerce_cart_customer_carts(merchant_id,customer_id,cart_id)
    VALUES ('11111111-1111-4111-8111-111111111111','aaaaaaaa-4000-4000-8000-000000000001','eeeeeeee-4000-4000-8000-000000000005')
    ON CONFLICT (merchant_id,customer_id) DO UPDATE SET cart_id=EXCLUDED.cart_id;
    RAISE EXCEPTION 'account-link UPSERT moved mapping away from held cart';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.commerce_cart_grants(merchant_id,cart_id,principal_id,expires_at)
    VALUES ('11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000001','new-principal',now()+interval '1 day');
    RAISE EXCEPTION 'held cart identity grant unexpectedly inserted';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.commerce_cart_customer_carts(merchant_id,customer_id,cart_id)
    VALUES ('11111111-1111-4111-8111-111111111111','aaaaaaaa-4000-4000-8000-000000000001','eeeeeeee-4000-4000-8000-000000000001');
    RAISE EXCEPTION 'held cart customer identity unexpectedly changed';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF NOT private.agentic_cart_dispatch_hold_is_live('11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'unknown provider outcome released automatically';
  END IF;
  -- Wrong claim references are rejected and do not mint a second hold.
  r:=public.commerce_cart_admit_agentic_dva_dispatch('other-claim');
  IF r->>'status' IS DISTINCT FROM 'blocked' THEN RAISE EXCEPTION 'mismatched claim reference accepted: %',r; END IF;

  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'role','commerce_cart_shopper','exp',extract(epoch FROM now())::bigint+3600,
    'cart_scope','session','cart_merchant_id','11111111-1111-4111-8111-111111111111',
    'cart_principal_id','dispatch-principal','cart_id','eeeeeeee-4000-4000-8000-000000000001',
    'cart_grant_id','eeeeeeee-4000-4000-8000-000000000002'
  )::text,true);
  BEGIN
    r:=public.commerce_cart_mutate('eeeeeeee-4000-4000-8000-000000000001','held-mutation',1,
      '{"type":"add","item":{"productId":"44444444-4444-4444-8444-444444444444"},"quantity":1}'::jsonb);
    RAISE EXCEPTION 'canonical cart mutation unexpectedly succeeded: %',r;
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    r:=public.commerce_cart_prepare_checkout('eeeeeeee-4000-4000-8000-000000000001',1,'held-prepare');
    RAISE EXCEPTION 'checkout prepare unexpectedly succeeded: %',r;
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    r:=public.commerce_cart_issue_handoff(repeat('d',64),'eeeeeeee-4000-4000-8000-000000000031',
      'eeeeeeee-4000-4000-8000-000000000001','held-handoff','{"type":"web"}'::jsonb);
    RAISE EXCEPTION 'handoff issuance unexpectedly succeeded: %',r;
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'role','commerce_cart_account_linker','exp',extract(epoch FROM now())::bigint+3600,
    'cart_scope','session','cart_merchant_id','11111111-1111-4111-8111-111111111111',
    'cart_customer_id','aaaaaaaa-4000-4000-8000-000000000001',
    'cart_account_user_id','aaaaaaaa-4000-4000-8000-000000000002',
    'cart_principal_id','dispatch-principal','cart_id','eeeeeeee-4000-4000-8000-000000000001',
    'cart_grant_id','eeeeeeee-4000-4000-8000-000000000002'
  )::text,true);
  BEGIN
    r:=public.commerce_cart_prepare_account_link('{"choice":"keep_current","operationId":"held-account-link"}'::jsonb);
    RAISE EXCEPTION 'account-link prepare unexpectedly succeeded: %',r;
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

END $$;

DO $$
DECLARE r jsonb; bound jsonb;
BEGIN
  -- Exercise the latest effective order binder. It marks the exact session
  -- submitted and completes the cart with a version increment plus outbox.
  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','aud','authenticated','agentic_context','checkout',
    'agentic_session_id','dispatch-agentic-session',
    'agentic_merchant_id','11111111-1111-4111-8111-111111111111',
    'agentic_shared_cart_checkout_binding',jsonb_build_object(
      'version',1,'agentic_session_id','dispatch-agentic-session',
      'cart_id','eeeeeeee-4000-4000-8000-000000000001',
      'checkout_session_id','eeeeeeee-4000-4000-8000-000000000003',
      'checkout_generation',7,'cart_version',1,'principal_id','dispatch-principal',
      'identity_kind','idempotent','checkout_variant','base'
    ))::text,true);
  bound:=public.create_storefront_order_with_cart_binding('base',
    'eeeeeeee-4000-4000-8000-000000000003',7,
    jsonb_build_object('p_merchant_id','11111111-1111-4111-8111-111111111111',
      'p_customer_email','dispatch@example.invalid','p_customer_name','Dispatch fixture',
      'p_items','[]'::jsonb,'p_checkout_idempotency_key','dispatch-wrapper-finalize',
      'p_checkout_request_hash',repeat('f',64),'p_expected_total',15,
      'p_cart_id','eeeeeeee-4000-4000-8000-000000000001','p_cart_version',1,
      'p_cart_principal_id','dispatch-principal'));
  IF bound->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'effective binder did not complete: %',bound; END IF;
  IF private.agentic_cart_dispatch_hold_is_live('11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'effective order binding did not consume the hold';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.agentic_cart_dispatch_holds WHERE claim_reference='claim-dispatch-1' AND state='order_completed') THEN
    RAISE EXCEPTION 'final order did not record terminal hold state';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.commerce_carts WHERE id='eeeeeeee-4000-4000-8000-000000000001' AND state='completed' AND version=2)
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_checkout_sessions WHERE id='eeeeeeee-4000-4000-8000-000000000003' AND status='submitted' AND order_id IS NOT NULL) THEN
    RAISE EXCEPTION 'effective binder completion did not persist cart and session state';
  END IF;
END $$;

-- Commit the disposable fixture so independent backend sessions can contend.
COMMIT;
CREATE EXTENSION IF NOT EXISTS dblink;
INSERT INTO public.commerce_carts(id,merchant_id,version,state,expires_at)
VALUES ('eeeeeeee-4000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111',1,'active',now()+interval '1 day');
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,principal_type,expires_at)
VALUES ('eeeeeeee-4000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000011','race-principal','guest',now()+interval '1 day');
INSERT INTO public.commerce_cart_checkout_sessions(id,merchant_id,cart_id,checkout_generation,cart_version_reviewed,principal_id,status,expires_at,preparing_grant_id)
VALUES ('eeeeeeee-4000-4000-8000-000000000013','11111111-1111-4111-8111-111111111111','eeeeeeee-4000-4000-8000-000000000011',8,1,'race-principal','active',now()+interval '1 day','eeeeeeee-4000-4000-8000-000000000012');
INSERT INTO public.checkout_sessions(id,session_id,merchant_id,status,metadata,payment_reference)
VALUES ('eeeeeeee-4000-4000-8000-000000000014','dispatch-race-session','11111111-1111-4111-8111-111111111111','processing','{"agentic":{"payment_state":"claiming_payment"}}','claim-race-1');
CREATE FUNCTION private.test_agentic_dispatch_race_writer() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.commerce_carts SET version=version+1 WHERE id='eeeeeeee-4000-4000-8000-000000000011';
  PERFORM pg_catalog.pg_sleep(1);
  RETURN 'writer_committed';
END $$;
CREATE FUNCTION private.test_agentic_dispatch_race_admission() RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','aud','authenticated','agentic_context','checkout',
    'agentic_session_id','dispatch-race-session',
    'agentic_merchant_id','11111111-1111-4111-8111-111111111111',
    'agentic_shared_cart_checkout_binding',jsonb_build_object(
      'version',1,'agentic_session_id','dispatch-race-session',
      'cart_id','eeeeeeee-4000-4000-8000-000000000011',
      'checkout_session_id','eeeeeeee-4000-4000-8000-000000000013',
      'checkout_generation',8,'cart_version',1,'idempotency_key','race-key',
      'principal_id','race-principal','identity_kind','idempotent',
      'checkout_variant','base','checkout_request_hash',repeat('b',64)
    ))::text,true);
  RETURN public.commerce_cart_admit_agentic_dva_dispatch('claim-race-1');
END $$;
SELECT dblink_connect('dispatch_writer','__PG_CONN__');
SELECT dblink_connect('dispatch_admitter','__PG_CONN__');
SELECT dblink_send_query('dispatch_writer','SELECT private.test_agentic_dispatch_race_writer()');
SELECT pg_catalog.pg_sleep(0.1);
SELECT dblink_send_query('dispatch_admitter','SELECT private.test_agentic_dispatch_race_admission()');
CREATE TEMP TABLE dispatch_race_results(value text);
INSERT INTO dispatch_race_results SELECT result FROM dblink_get_result('dispatch_writer') AS t(result text);
INSERT INTO dispatch_race_results SELECT result::jsonb::text FROM dblink_get_result('dispatch_admitter') AS t(result jsonb);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dispatch_race_results WHERE value='writer_committed')
     OR NOT EXISTS (SELECT 1 FROM dispatch_race_results WHERE value LIKE '%"status": "blocked"%')
     OR EXISTS (SELECT 1 FROM private.agentic_cart_dispatch_holds WHERE claim_reference='claim-race-1') THEN
    RAISE EXCEPTION 'concurrent cart write did not win before admission with stale-version rejection: %',
      (SELECT array_agg(value) FROM dispatch_race_results);
  END IF;
END $$;
SELECT dblink_disconnect('dispatch_writer');
SELECT dblink_disconnect('dispatch_admitter');
