-- Direct PostgreSQL contract; run only through the disposable cluster runner.
-- The finalizer role has no authenticator membership; PostgREST reachability
-- and live hook reload are separate gates.
CREATE EXTENSION IF NOT EXISTS dblink;
BEGIN;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT coalesce(auth.jwt() ->> 'role', current_setting('role', true)) $$;
INSERT INTO public.commerce_carts(id,merchant_id,version,state,expires_at)
VALUES ('f6f6f6f6-6666-4666-8666-000000000001','11111111-1111-4111-8111-111111111111',1,'active',now()+interval '1 day');
INSERT INTO public.commerce_cart_lines(id,merchant_id,cart_id,product_id,quantity,last_unit_price_minor)
VALUES ('f6f6f6f6-6666-4666-8666-000000000007','11111111-1111-4111-8111-111111111111','f6f6f6f6-6666-4666-8666-000000000001','44444444-4444-4444-8444-444444444444',1,1500);
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,principal_type,expires_at,revoked_at)
VALUES ('f6f6f6f6-6666-4666-8666-000000000002','11111111-1111-4111-8111-111111111111','f6f6f6f6-6666-4666-8666-000000000001','dva-recovery-principal','guest',now()+interval '1 day',now());
INSERT INTO public.commerce_cart_checkout_sessions(id,merchant_id,cart_id,checkout_generation,cart_version_reviewed,principal_id,status,expires_at,preparing_grant_id,reviewed_snapshot)
VALUES ('f6f6f6f6-6666-4666-8666-000000000003','11111111-1111-4111-8111-111111111111','f6f6f6f6-6666-4666-8666-000000000001',11,1,'dva-recovery-principal','active',now()+interval '1 day','f6f6f6f6-6666-4666-8666-000000000002',public.commerce_cart_build_checkout_snapshot('11111111-1111-4111-8111-111111111111','f6f6f6f6-6666-4666-8666-000000000001'));
INSERT INTO public.checkout_sessions(id,session_id,merchant_id,status,metadata,payment_reference,order_id)
VALUES ('f6f6f6f6-6666-4666-8666-000000000004','agentic_recovery_session_1','11111111-1111-4111-8111-111111111111','processing',
  jsonb_build_object('agentic',jsonb_build_object(
    'payment_state','order_finalizing',
    'finalization_claim','agentic_order_recovery_1',
    'shared_cart',jsonb_build_object(
      'cart_id','f6f6f6f6-6666-4666-8666-000000000001',
      'checkout_session_id','f6f6f6f6-6666-4666-8666-000000000003',
      'cart_version',1,
      'checkout_generation',11
    )
  )),
  '1234567890',NULL);
INSERT INTO private.agentic_cart_dispatch_holds(id,merchant_id,cart_id,checkout_session_id,checkout_generation,cart_version,principal_id,claim_reference,state,evidence_reference)
VALUES ('f6f6f6f6-6666-4666-8666-000000000005','11111111-1111-4111-8111-111111111111','f6f6f6f6-6666-4666-8666-000000000001','f6f6f6f6-6666-4666-8666-000000000003',11,1,'dva-recovery-principal','provider-claim-recovery-1','account_ready','f6f6f6f6-6666-4666-8666-000000000006');
INSERT INTO private.agentic_cart_dispatch_provider_evidence(hold_id,merchant_id,cart_id,checkout_session_id,checkout_generation,cart_version,principal_id,claim_reference,attestation_jti,account_number,account_name,bank_name,currency,subaccount_code)
VALUES ('f6f6f6f6-6666-4666-8666-000000000005','11111111-1111-4111-8111-111111111111','f6f6f6f6-6666-4666-8666-000000000001','f6f6f6f6-6666-4666-8666-000000000003',11,1,'dva-recovery-principal','provider-claim-recovery-1','f6f6f6f6-6666-4666-8666-000000000006','1234567890','Recovery Account','Recovery Bank','NGN','ACCT_123456789012345');

SET ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object(
  'role','authenticated','aud','authenticated','agentic_context','checkout',
  'agentic_session_id','agentic_recovery_session_1',
  'agentic_merchant_id','11111111-1111-4111-8111-111111111111'
)::text,true);
DO $$
BEGIN
  IF NOT public.commerce_cart_agentic_dva_recovery_available(
    '11111111-1111-4111-8111-111111111111','f6f6f6f6-6666-4666-8666-000000000003',
    'agentic_recovery_session_1',
    'f6f6f6f6-6666-4666-8666-000000000001',1,11,'1234567890','agentic_order_recovery_1'
  ) THEN RAISE EXCEPTION 'exact immutable DVA evidence was not recognized'; END IF;
  IF public.commerce_cart_agentic_dva_recovery_available(
    '11111111-1111-4111-8111-111111111111','f6f6f6f6-6666-4666-8666-000000000003',
    'f6f6f6f6-6666-4666-8666-000000000003',
    'f6f6f6f6-6666-4666-8666-000000000001',1,11,'1234567890','agentic_order_recovery_1'
  ) THEN RAISE EXCEPTION 'conflated agentic session id passed recovery probe'; END IF;
  IF public.commerce_cart_agentic_dva_recovery_available(
    '11111111-1111-4111-8111-111111111111','f6f6f6f6-6666-4666-8666-000000000003',
    'agentic_recovery_session_1',
    'f6f6f6f6-6666-4666-8666-000000000001',1,11,'9999999999','agentic_order_recovery_1'
  ) THEN RAISE EXCEPTION 'mismatched DVA account passed recovery probe'; END IF;
END $$;
RESET ROLE;

DO $$
DECLARE
  v_rejected boolean;
  v_message text;
  v_order_args jsonb;
  v_scope jsonb := jsonb_build_object(
    'version','1','merchant_id','11111111-1111-4111-8111-111111111111',
    'agentic_session_id','agentic_recovery_session_1',
    'checkout_session_id','f6f6f6f6-6666-4666-8666-000000000003',
    'cart_id','f6f6f6f6-6666-4666-8666-000000000001',
    'cart_version',1,'checkout_generation',11,
    'account_number','1234567890','finalization_claim','agentic_order_recovery_1'
  );
BEGIN
  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'role','agentic_dva_finalizer','aud','authenticated',
    'agentic_context','checkout',
    'agentic_merchant_id','11111111-1111-4111-8111-111111111111',
    'iat',extract(epoch FROM clock_timestamp())::bigint,
    'exp',extract(epoch FROM clock_timestamp())::bigint+30,
    'agentic_dva_post_logout',v_scope
  )::text,true);

  -- The strict pre-request hook allows only the binder RPC for this role.
  PERFORM set_config('request.method','POST',true);
  PERFORM set_config('request.path','/rpc/create_storefront_order_with_cart_binding',true);
  PERFORM public.enforce_gigl_tracking_worker_request_scope();
  PERFORM set_config('request.path','/rpc/create_storefront_order',true);
  BEGIN
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
    RAISE EXCEPTION 'finalizer hook accepted a non-binder path';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.path','/rpc/create_storefront_order_with_cart_binding',true);

  -- A mismatched account is rejected before order creation.
  v_rejected := false;
  PERFORM set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,
    '{agentic_dva_post_logout,account_number}',to_jsonb('9999999999'::text),true)::text,true);
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding('base','f6f6f6f6-6666-4666-8666-000000000003',11,
      jsonb_build_object('p_merchant_id','11111111-1111-4111-8111-111111111111','p_items','[]'::jsonb,
        'p_cart_id','f6f6f6f6-6666-4666-8666-000000000001','p_cart_version',1,'p_cart_principal_id','forged'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF SQLSTATE = 'P0001' AND v_message = 'cart_order_unauthorized' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'mismatched account unexpectedly passed binder'; END IF;

  -- A stale body version is rejected before the binder can create an order.
  v_rejected := false;
  PERFORM set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,
    '{agentic_dva_post_logout,account_number}',to_jsonb('1234567890'::text),true)::text,true);
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding('base','f6f6f6f6-6666-4666-8666-000000000003',11,
      jsonb_build_object('p_merchant_id','11111111-1111-4111-8111-111111111111','p_items','[]'::jsonb,
        'p_cart_id','f6f6f6f6-6666-4666-8666-000000000001','p_cart_version',2,'p_cart_principal_id','forged'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF SQLSTATE = 'P0001' AND v_message = 'cart_checkout_stale' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'stale cart version unexpectedly passed binder'; END IF;

  v_order_args := jsonb_build_object(
    'p_merchant_id','11111111-1111-4111-8111-111111111111',
    'p_customer_email','dva-recovery@example.invalid','p_customer_name','DVA recovery fixture',
    'p_items','[]'::jsonb,'p_checkout_request_hash',repeat('c',64),'p_expected_total',15,
    'p_payment_method','bank_transfer','p_payment_status','pending',
    'p_cart_id','f6f6f6f6-6666-4666-8666-000000000001','p_cart_version',1,
    'p_cart_principal_id','forged'
  );
  v_rejected := false;
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding('base','f6f6f6f6-6666-4666-8666-000000000003',11,
      jsonb_set(v_order_args || jsonb_build_object('p_checkout_idempotency_key','dva-forged-paid'),
        '{p_payment_status}',to_jsonb('paid'::text),true));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF SQLSTATE = 'P0001' AND v_message = 'cart_order_unauthorized' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected OR EXISTS (SELECT 1 FROM public.orders WHERE checkout_idempotency_key='dva-forged-paid') THEN
    RAISE EXCEPTION 'finalizer role created or claimed a paid order';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding('base','f6f6f6f6-6666-4666-8666-000000000003',11,
      jsonb_set(v_order_args || jsonb_build_object('p_checkout_idempotency_key','dva-forged-method'),
        '{p_payment_method}',to_jsonb('card'::text),true));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF SQLSTATE = 'P0001' AND v_message = 'cart_order_unauthorized' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected OR EXISTS (SELECT 1 FROM public.orders WHERE checkout_idempotency_key='dva-forged-method') THEN
    RAISE EXCEPTION 'finalizer role created an order under a non-transfer payment method';
  END IF;

  -- A token minted with forward clock skew (+2s) and a 60s lifetime relative to iat passes JWT expiry validation.
  v_rejected := false;
  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'role','agentic_dva_finalizer','aud','authenticated',
    'agentic_context','checkout',
    'agentic_merchant_id','11111111-1111-4111-8111-111111111111',
    'iat',extract(epoch FROM clock_timestamp())::bigint+2,
    'exp',extract(epoch FROM clock_timestamp())::bigint+62,
    'agentic_dva_post_logout',v_scope
  )::text,true);
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding('base','f6f6f6f6-6666-4666-8666-000000000003',11,
      jsonb_build_object('p_merchant_id','11111111-1111-4111-8111-111111111111','p_items','[]'::jsonb,
        'p_cart_id','f6f6f6f6-6666-4666-8666-000000000001','p_cart_version',2,'p_cart_principal_id','forged'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF SQLSTATE = 'P0001' AND v_message = 'cart_checkout_stale' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'skewed 60s token failed JWT validation before cart check'; END IF;

  -- A token with exp exceeding iat + 60 is rejected even if exp is within now + 60.
  v_rejected := false;
  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'role','agentic_dva_finalizer','aud','authenticated',
    'agentic_context','checkout',
    'agentic_merchant_id','11111111-1111-4111-8111-111111111111',
    'iat',extract(epoch FROM clock_timestamp())::bigint-30,
    'exp',extract(epoch FROM clock_timestamp())::bigint+35,
    'agentic_dva_post_logout',v_scope
  )::text,true);
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding('base','f6f6f6f6-6666-4666-8666-000000000003',11,
      jsonb_build_object('p_merchant_id','11111111-1111-4111-8111-111111111111','p_items','[]'::jsonb,
        'p_cart_id','f6f6f6f6-6666-4666-8666-000000000001','p_cart_version',1,'p_cart_principal_id','forged'));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF SQLSTATE = 'P0001' AND v_message = 'cart_order_unauthorized' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'token lifetime > 60s relative to iat unexpectedly passed'; END IF;

END $$;
RESET ROLE;
-- Commit only in the ephemeral cluster owned and dropped by the runner so two
-- independent sessions can race from the same eligible, unsubmitted claim.
COMMIT;

DO $$
DECLARE
  v_claims jsonb := jsonb_build_object(
    'role','agentic_dva_finalizer','aud','authenticated','agentic_context','checkout',
    'agentic_merchant_id','11111111-1111-4111-8111-111111111111',
    'iat',extract(epoch FROM clock_timestamp())::bigint,
    'exp',extract(epoch FROM clock_timestamp())::bigint+30,
    'agentic_dva_post_logout',jsonb_build_object(
      'version','1','merchant_id','11111111-1111-4111-8111-111111111111',
      'agentic_session_id','agentic_recovery_session_1',
      'checkout_session_id','f6f6f6f6-6666-4666-8666-000000000003',
      'cart_id','f6f6f6f6-6666-4666-8666-000000000001',
      'cart_version',1,'checkout_generation',11,
      'account_number','1234567890','finalization_claim','agentic_order_recovery_1'
    )
  );
  v_query text;
  v_first jsonb;
  v_second jsonb;
BEGIN
  v_query := format($query$
    WITH claims AS (SELECT set_config('request.jwt.claims', %L, false)),
    timeout AS (SELECT set_config('statement_timeout','10000',false) FROM claims),
    result AS (SELECT public.create_storefront_order_with_cart_binding(
      'base','f6f6f6f6-6666-4666-8666-000000000003',11,
      jsonb_build_object('p_merchant_id','11111111-1111-4111-8111-111111111111',
        'p_customer_email','dva-recovery@example.invalid','p_customer_name','DVA recovery fixture',
        'p_items','[]'::jsonb,'p_checkout_idempotency_key','dva-recovery-create',
        'p_checkout_request_hash',repeat('a',64),'p_expected_total',15,
        'p_payment_method','bank_transfer','p_payment_status','pending',
        'p_cart_id','f6f6f6f6-6666-4666-8666-000000000001','p_cart_version',1,
        'p_cart_principal_id','untrusted')
    ) AS payload FROM timeout)
    SELECT payload FROM result
  $query$,v_claims::text);

  PERFORM dblink_connect('dva_race_one',format(
    'host=%s port=%s user=postgres dbname=postgres',
    split_part(current_setting('unix_socket_directories'),',',1),current_setting('port')));
  PERFORM dblink_connect('dva_race_two',format(
    'host=%s port=%s user=postgres dbname=postgres',
    split_part(current_setting('unix_socket_directories'),',',1),current_setting('port')));
  IF dblink_send_query('dva_race_one',v_query) <> 1
     OR dblink_send_query('dva_race_two',v_query) <> 1 THEN
    RAISE EXCEPTION 'could not launch concurrent finalizer replay calls';
  END IF;
  SELECT payload INTO v_first FROM dblink_get_result('dva_race_one') AS t(payload jsonb);
  SELECT payload INTO v_second FROM dblink_get_result('dva_race_two') AS t(payload jsonb);
  PERFORM dblink_disconnect('dva_race_one');
  PERFORM dblink_disconnect('dva_race_two');

  IF v_first->>'ok' IS DISTINCT FROM 'true' OR v_second->>'ok' IS DISTINCT FROM 'true'
     OR v_first->'order'->>'id' IS DISTINCT FROM v_second->'order'->>'id'
     OR (CASE WHEN v_first->>'replayed'='true' THEN 1 ELSE 0 END
       + CASE WHEN v_second->>'replayed'='true' THEN 1 ELSE 0 END) <> 1 THEN
    RAISE EXCEPTION 'concurrent first-finalization calls did not return the same order safely';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.agentic_cart_dispatch_holds
      WHERE id='f6f6f6f6-6666-4666-8666-000000000005' AND state='order_completed')
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_checkout_sessions
      WHERE id='f6f6f6f6-6666-4666-8666-000000000003' AND status='submitted' AND order_id IS NOT NULL) THEN
    RAISE EXCEPTION 'concurrent finalization did not atomically complete the same hold and cart session';
  END IF;
  IF (SELECT count(*) FROM public.orders
      WHERE id=(v_first->'order'->>'id')::uuid AND payment_status='pending') <> 1
     OR (SELECT count(*) FROM public.orders WHERE checkout_idempotency_key='dva-recovery-create') <> 1 THEN
    RAISE EXCEPTION 'concurrent same-claim calls created extra or paid orders';
  END IF;
END $$;
