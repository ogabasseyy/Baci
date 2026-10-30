-- Disposable database only; prove the new public price without expanding
-- unmatched diagnostics, direct grants, ownership or wallet replay authority.
BEGIN;
INSERT INTO private.imei_access_secrets(singleton,secret)
  VALUES(true,'test-imei-access-secret-at-least-32-bytes')
  ON CONFLICT(singleton) DO UPDATE SET secret=excluded.secret;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
CREATE FUNCTION pg_temp.imei_price_test_call(operation text,args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE payload text; issued bigint:=floor(extract(epoch FROM clock_timestamp()));
BEGIN
  payload := jsonb_build_object('version',1,'actor','00000000-0000-4000-8000-000000000001',
    'customer','30000000-0000-4000-8000-000000000001',
    'merchant','10000000-0000-4000-8000-000000000001','operation',operation,
    'issuedAt',issued,'expiresAt',issued+120,'args',args)::text;
  RETURN public.imei_lookup_access(payload,encode(extensions.hmac('baci:imei-access:v1:'||payload,
    'test-imei-access-secret-at-least-32-bytes','sha256'),'hex'));
END $$;

UPDATE public.customer_wallets SET available_balance=10000;
CREATE FUNCTION pg_temp.new_unsubmitted_lookup() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r jsonb; id uuid;
BEGIN
 r:=pg_temp.imei_price_test_call('insert_pending',jsonb_build_object(
 'customer_id','30000000-0000-4000-8000-000000000001','merchant_id','10000000-0000-4000-8000-000000000001',
 'tier','simLock','imei_hash',repeat('a',64),'device_category','smartphone','idempotency_key',gen_random_uuid(),'amount_ngn',500,'status','pending'));
 id:=(r->>'id')::uuid;
 PERFORM pg_temp.imei_price_test_call('redeem_imei_wallet_and_begin_provider_submission',jsonb_build_object(
 'p_lookup_id',id,'p_amount',500,'p_provider','petrock','p_reference_id',gen_random_uuid(),
 'p_feedback_token_hash',encode(extensions.digest(id::text,'sha256'),'hex'),'p_identifier_ciphertext','test-cipher',
 'p_cost_usd',0.06,'p_provider_attempt_started_at',now(),'p_device_category','smartphone'));
 RETURN id;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('test.cancel_lookup',pg_temp.new_unsubmitted_lookup()::text,true);
RESET ROLE;
-- Simulate a worker owning the write-ahead row when the route detects its lost debit response.
UPDATE public.imei_lookups SET reconcile_lease_token='90000000-0000-4000-8000-000000000001',
 reconcile_lease_until=now()+interval '90 seconds',next_poll_at=now()
 WHERE id=current_setting('test.cancel_lookup')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE id uuid:=current_setting('test.cancel_lookup')::uuid; balance numeric; r jsonb;
BEGIN
 IF pg_temp.imei_price_test_call('cancel_unsubmitted_petrock_imei_lookup',jsonb_build_object('p_lookup_id',id)) IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION 'active poll lease prevented pre-submit cancellation'; END IF;
 IF pg_temp.imei_price_test_call('cancel_unsubmitted_petrock_imei_lookup',jsonb_build_object('p_lookup_id',id)) IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION 'cancellation replay was not confirmed'; END IF;
 SELECT available_balance INTO balance FROM public.customer_wallets WHERE customer_id='30000000-0000-4000-8000-000000000001';
 IF balance<>10000 THEN RAISE EXCEPTION 'lost debit refund was missing or duplicated'; END IF;
 r:=pg_temp.imei_price_test_call('read_status',jsonb_build_object('lookup_id',id));
 IF r->>'status'<>'refunded_error' OR r->'cached_response'->>'code'<>'PETROCK_NOT_SUBMITTED'
 THEN RAISE EXCEPTION 'cancellation did not cache terminal refund response'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE id uuid:=current_setting('test.cancel_lookup')::uuid; row public.imei_lookups%ROWTYPE;
 lease uuid:='90000000-0000-4000-8000-000000000001';
BEGIN
 SELECT * INTO row FROM public.imei_lookups WHERE imei_lookups.id=current_setting('test.cancel_lookup')::uuid;
 IF row.identifier_ciphertext IS NOT NULL OR row.feedback_token_hash IS NOT NULL OR row.next_poll_at IS NOT NULL
 OR row.reconcile_lease_token IS NOT NULL OR row.reconcile_lease_until IS NOT NULL
 THEN RAISE EXCEPTION 'cancellation retained provider secrets or lease'; END IF;
 IF public.reschedule_petrock_imei_lookup_poll(id,lease,'late_worker',now())
 OR public.record_petrock_imei_submission(id,'late-order','new',now(),lease)
 OR public.mark_petrock_imei_submission_unknown(id,'late_unknown',lease,NULL)
 THEN RAISE EXCEPTION 'stale worker write revived refunded lookup'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('test.order_lookup',pg_temp.new_unsubmitted_lookup()::text,true);
SELECT set_config('test.complete_lookup',pg_temp.new_unsubmitted_lookup()::text,true);
RESET ROLE;
UPDATE public.imei_lookups SET provider_order_id='accepted-order',status='pending_provider'
 WHERE id=current_setting('test.order_lookup')::uuid;
UPDATE public.imei_lookups SET status='completed'
 WHERE id=current_setting('test.complete_lookup')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE id uuid; balance numeric;
BEGIN
 FOREACH id IN ARRAY ARRAY[current_setting('test.order_lookup')::uuid,current_setting('test.complete_lookup')::uuid] LOOP
 IF pg_temp.imei_price_test_call('cancel_unsubmitted_petrock_imei_lookup',jsonb_build_object('p_lookup_id',id)) IS DISTINCT FROM 'false'::jsonb
 THEN RAISE EXCEPTION 'cancellation refunded conflicting order or completed lookup'; END IF;
 END LOOP;
 SELECT available_balance INTO balance FROM public.customer_wallets WHERE customer_id='30000000-0000-4000-8000-000000000001';
 IF balance<>9000 THEN RAISE EXCEPTION 'conflicting lookup was credited'; END IF;
 BEGIN
 PERFORM pg_temp.imei_price_test_call('cancel_unsubmitted_petrock_imei_lookup',jsonb_build_object('p_lookup_id',current_setting('test.order_lookup'),
 'p_customer_id','30000000-0000-4000-8000-000000000002'));
 RAISE EXCEPTION 'cancellation accepted different customer identity';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
