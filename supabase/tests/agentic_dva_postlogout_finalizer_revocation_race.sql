-- Concurrent device-retirement race and least-privilege role assertions for
-- the dormant DVA post-logout finalizer. Loaded directly after
-- agentic_dva_postlogout_finalizer.sql inside run_agentic_dva_provider_success_evidence.py.
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
VALUES ('f8f8f8f8-8888-4888-8888-000000000004','agentic_recovery_session_2','11111111-1111-4111-8111-111111111111','processing',
  jsonb_build_object('agentic',jsonb_build_object(
    'payment_state','order_finalizing',
    'finalization_claim','agentic_order_recovery_revocation',
    'shared_cart',jsonb_build_object(
      'cart_id','f8f8f8f8-8888-4888-8888-000000000001',
      'checkout_session_id','f8f8f8f8-8888-4888-8888-000000000003',
      'cart_version',1,
      'checkout_generation',12
    )
  )),
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
    'agentic_merchant_id','11111111-1111-4111-8111-111111111111',
    'iat',extract(epoch FROM clock_timestamp())::bigint,
    'exp',extract(epoch FROM clock_timestamp())::bigint+30,
    'agentic_dva_post_logout',jsonb_build_object(
      'version','1','merchant_id','11111111-1111-4111-8111-111111111111',
      'agentic_session_id','agentic_recovery_session_2',
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
