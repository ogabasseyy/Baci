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
VALUES ('f6f6f6f6-6666-4666-8666-000000000004','f6f6f6f6-6666-4666-8666-000000000003','11111111-1111-4111-8111-111111111111','processing',
  '{"agentic":{"payment_state":"order_finalizing","finalization_claim":"agentic_order_recovery_1"}}',
  '1234567890',NULL);
INSERT INTO private.agentic_cart_dispatch_holds(id,merchant_id,cart_id,checkout_session_id,checkout_generation,cart_version,principal_id,claim_reference,state,evidence_reference)
VALUES ('f6f6f6f6-6666-4666-8666-000000000005','11111111-1111-4111-8111-111111111111','f6f6f6f6-6666-4666-8666-000000000001','f6f6f6f6-6666-4666-8666-000000000003',11,1,'dva-recovery-principal','provider-claim-recovery-1','account_ready','f6f6f6f6-6666-4666-8666-000000000006');
INSERT INTO private.agentic_cart_dispatch_provider_evidence(hold_id,merchant_id,cart_id,checkout_session_id,checkout_generation,cart_version,principal_id,claim_reference,attestation_jti,account_number,account_name,bank_name,currency,subaccount_code)
VALUES ('f6f6f6f6-6666-4666-8666-000000000005','11111111-1111-4111-8111-111111111111','f6f6f6f6-6666-4666-8666-000000000001','f6f6f6f6-6666-4666-8666-000000000003',11,1,'dva-recovery-principal','provider-claim-recovery-1','f6f6f6f6-6666-4666-8666-000000000006','1234567890','Recovery Account','Recovery Bank','NGN','ACCT_123456789012345');

SET ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object(
  'role','authenticated','aud','authenticated','agentic_context','checkout',
  'agentic_session_id','f6f6f6f6-6666-4666-8666-000000000003',
  'agentic_merchant_id','11111111-1111-4111-8111-111111111111'
)::text,true);
DO $$
BEGIN
  IF NOT public.commerce_cart_agentic_dva_recovery_available(
    '11111111-1111-4111-8111-111111111111','f6f6f6f6-6666-4666-8666-000000000003',
    'f6f6f6f6-6666-4666-8666-000000000001',1,11,'1234567890','agentic_order_recovery_1'
  ) THEN RAISE EXCEPTION 'exact immutable DVA evidence was not recognized'; END IF;
  IF public.commerce_cart_agentic_dva_recovery_available(
    '11111111-1111-4111-8111-111111111111','f6f6f6f6-6666-4666-8666-000000000003',
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
    'checkout_session_id','f6f6f6f6-6666-4666-8666-000000000003',
    'cart_id','f6f6f6f6-6666-4666-8666-000000000001',
    'cart_version',1,'checkout_generation',11,
    'account_number','1234567890','finalization_claim','agentic_order_recovery_1'
  );
BEGIN
  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'role','agentic_dva_finalizer','aud','authenticated',
    'agentic_context','checkout',
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

END $$;
RESET ROLE;
-- Commit only in the ephemeral cluster owned and dropped by the runner so two
-- independent sessions can race from the same eligible, unsubmitted claim.
COMMIT;

DO $$
DECLARE
  v_claims jsonb := jsonb_build_object(
    'role','agentic_dva_finalizer','aud','authenticated','agentic_context','checkout',
    'iat',extract(epoch FROM clock_timestamp())::bigint,
    'exp',extract(epoch FROM clock_timestamp())::bigint+30,
    'agentic_dva_post_logout',jsonb_build_object(
      'version','1','merchant_id','11111111-1111-4111-8111-111111111111',
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

-- A second independent eligible session races an explicit device retirement.
-- Revocation owns the advisory lock first; finalization must wait, then make
-- its decision from the committed retirement and immutable provider evidence.
BEGIN;
INSERT INTO public.commerce_carts(id,merchant_id,version,state,expires_at)
VALUES ('f8f8f8f8-8888-4888-8888-000000000001','11111111-1111-4111-8111-111111111111',1,'active',now()+interval '1 day');
INSERT INTO public.commerce_cart_lines(id,merchant_id,cart_id,product_id,quantity,last_unit_price_minor)
VALUES ('f8f8f8f8-8888-4888-8888-000000000007','11111111-1111-4111-8111-111111111111','f8f8f8f8-8888-4888-8888-000000000001','44444444-4444-4444-8444-444444444444',1,1500);
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,principal_type,expires_at,revoked_at)
VALUES ('f8f8f8f8-8888-4888-8888-000000000002','11111111-1111-4111-8111-111111111111','f8f8f8f8-8888-4888-8888-000000000001','dva-revoke-principal','guest',now()+interval '1 day',NULL);
INSERT INTO public.commerce_cart_checkout_sessions(id,merchant_id,cart_id,checkout_generation,cart_version_reviewed,principal_id,status,expires_at,preparing_grant_id,reviewed_snapshot)
VALUES ('f8f8f8f8-8888-4888-8888-000000000003','11111111-1111-4111-8111-111111111111','f8f8f8f8-8888-4888-8888-000000000001',12,1,'dva-revoke-principal','active',now()+interval '1 day','f8f8f8f8-8888-4888-8888-000000000002',public.commerce_cart_build_checkout_snapshot('11111111-1111-4111-8111-111111111111','f8f8f8f8-8888-4888-8888-000000000001'));
INSERT INTO public.checkout_sessions(id,session_id,merchant_id,status,metadata,payment_reference,order_id)
VALUES ('f8f8f8f8-8888-4888-8888-000000000004','f8f8f8f8-8888-4888-8888-000000000003','11111111-1111-4111-8111-111111111111','processing',
  '{"agentic":{"payment_state":"order_finalizing","finalization_claim":"agentic_order_recovery_revocation"}}',
  '1231231234',NULL);
INSERT INTO private.agentic_cart_dispatch_holds(id,merchant_id,cart_id,checkout_session_id,checkout_generation,cart_version,principal_id,claim_reference,state,evidence_reference)
VALUES ('f8f8f8f8-8888-4888-8888-000000000005','11111111-1111-4111-8111-111111111111','f8f8f8f8-8888-4888-8888-000000000001','f8f8f8f8-8888-4888-8888-000000000003',12,1,'dva-revoke-principal','provider-claim-recovery-2','account_ready','f8f8f8f8-8888-4888-8888-000000000006');
INSERT INTO private.agentic_cart_dispatch_provider_evidence(hold_id,merchant_id,cart_id,checkout_session_id,checkout_generation,cart_version,principal_id,claim_reference,attestation_jti,account_number,account_name,bank_name,currency,subaccount_code)
VALUES ('f8f8f8f8-8888-4888-8888-000000000005','11111111-1111-4111-8111-111111111111','f8f8f8f8-8888-4888-8888-000000000001','f8f8f8f8-8888-4888-8888-000000000003',12,1,'dva-revoke-principal','provider-claim-recovery-2','f8f8f8f8-8888-4888-8888-000000000006','1231231234','Revocation Account','Revocation Bank','NGN','ACCT_223456789012345');
COMMIT;

DO $$
DECLARE
  v_claims jsonb := jsonb_build_object(
    'role','agentic_dva_finalizer','aud','authenticated','agentic_context','checkout',
    'iat',extract(epoch FROM clock_timestamp())::bigint,
    'exp',extract(epoch FROM clock_timestamp())::bigint+30,
    'agentic_dva_post_logout',jsonb_build_object(
      'version','1','merchant_id','11111111-1111-4111-8111-111111111111',
      'checkout_session_id','f8f8f8f8-8888-4888-8888-000000000003',
      'cart_id','f8f8f8f8-8888-4888-8888-000000000001',
      'cart_version',1,'checkout_generation',12,
      'account_number','1231231234','finalization_claim','agentic_order_recovery_revocation'
    )
  );
  v_query text;
  v_pid integer;
  v_attempt integer;
  v_result jsonb;
  v_error text;
  v_locked boolean := false;
BEGIN
  v_query := format($query$
    WITH claims AS (SELECT set_config('request.jwt.claims', %L, false)),
    timeout AS (SELECT set_config('statement_timeout','10000',false) FROM claims),
    result AS (SELECT public.create_storefront_order_with_cart_binding(
      'base','f8f8f8f8-8888-4888-8888-000000000003',12,
      jsonb_build_object('p_merchant_id','11111111-1111-4111-8111-111111111111',
        'p_customer_email','dva-revocation@example.invalid','p_customer_name','DVA revocation fixture',
        'p_items','[]'::jsonb,'p_checkout_idempotency_key','dva-revocation-create',
        'p_checkout_request_hash',repeat('b',64),'p_expected_total',15,
        'p_payment_method','bank_transfer','p_payment_status','pending',
        'p_cart_id','f8f8f8f8-8888-4888-8888-000000000001','p_cart_version',1,
        'p_cart_principal_id','untrusted')
    ) AS payload FROM timeout)
    SELECT payload FROM result
  $query$,v_claims::text);

  PERFORM dblink_connect('dva_revoker',format(
    'host=%s port=%s user=postgres dbname=postgres',
    split_part(current_setting('unix_socket_directories'),',',1),current_setting('port')));
  PERFORM dblink_connect('dva_revoked_finalizer',format(
    'host=%s port=%s user=postgres dbname=postgres',
    split_part(current_setting('unix_socket_directories'),',',1),current_setting('port')));
  PERFORM dblink_exec('dva_revoker','BEGIN');
  PERFORM dblink_exec('dva_revoker',format($lock$
    DO $inner$ BEGIN
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(%L,0));
    END $inner$
  $lock$,'cc-device-revoke|11111111-1111-4111-8111-111111111111|dva-revoke-principal'));
  SELECT pid INTO v_pid FROM dblink('dva_revoked_finalizer','SELECT pg_backend_pid()') AS t(pid integer);
  IF dblink_send_query('dva_revoked_finalizer',v_query) <> 1 THEN
    RAISE EXCEPTION 'could not start finalizer during device retirement';
  END IF;

  FOR v_attempt IN 1..200 LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_stat_activity
      WHERE pid=v_pid AND state='active' AND wait_event_type='Lock' AND wait_event='advisory'
    ) INTO v_locked;
    EXIT WHEN v_locked;
    PERFORM pg_catalog.pg_sleep(0.025);
  END LOOP;
  IF NOT v_locked THEN
    SELECT payload INTO v_error FROM dblink_get_result('dva_revoked_finalizer',false) AS t(payload text);
    RAISE EXCEPTION 'finalizer did not reach the revocation lock within 5 seconds: %',v_error;
  END IF;

  PERFORM dblink_exec('dva_revoker',
    'INSERT INTO public.commerce_cart_device_retirements(merchant_id,device_principal_id) '
    || 'VALUES (''11111111-1111-4111-8111-111111111111'',''dva-revoke-principal'') ON CONFLICT DO NOTHING; '
    || 'UPDATE public.commerce_cart_grants SET revoked_at=clock_timestamp() '
    || 'WHERE id=''f8f8f8f8-8888-4888-8888-000000000002'' AND revoked_at IS NULL; COMMIT');
  SELECT payload INTO v_result FROM dblink_get_result('dva_revoked_finalizer') AS t(payload jsonb);
  PERFORM dblink_disconnect('dva_revoker');
  PERFORM dblink_disconnect('dva_revoked_finalizer');

  IF v_result->>'ok' IS DISTINCT FROM 'true'
     OR v_result->'order'->>'id' IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.orders
       WHERE id=(v_result->'order'->>'id')::uuid AND payment_status='pending')
     OR (SELECT count(*) FROM public.orders WHERE checkout_idempotency_key='dva-revocation-create') <> 1
     OR NOT EXISTS (SELECT 1 FROM private.agentic_cart_dispatch_holds
       WHERE id='f8f8f8f8-8888-4888-8888-000000000005' AND state='order_completed')
     OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_checkout_sessions
       WHERE id='f8f8f8f8-8888-4888-8888-000000000003' AND status='submitted' AND order_id IS NOT NULL) THEN
    RAISE EXCEPTION 'evidence-backed finalization did not complete safely after concurrent device revocation: %',v_result;
  END IF;
END $$;

DO $$
BEGIN
  IF pg_catalog.pg_has_role('authenticator','agentic_dva_finalizer','MEMBER')
     OR has_function_privilege('authenticated','public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)','EXECUTE') IS NOT TRUE
     OR has_function_privilege('agentic_dva_finalizer','public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)','EXECUTE') IS NOT TRUE
     OR has_table_privilege('agentic_dva_finalizer','private.agentic_cart_dispatch_provider_evidence','SELECT') THEN
    RAISE EXCEPTION 'finalizer role membership or direct table privileges exceed scope';
  END IF;
END $$;
