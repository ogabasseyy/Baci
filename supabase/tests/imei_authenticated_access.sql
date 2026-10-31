-- Disposable database only. Requires customer 300...001, merchant 100...001,
-- user 000...001 and a wallet with >=300 NGN; fixture rows are runner-owned.
BEGIN;
INSERT INTO private.imei_access_secrets(singleton,secret)
  VALUES(true,'test-imei-access-secret-at-least-32-bytes')
  ON CONFLICT(singleton) DO UPDATE SET secret=excluded.secret;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
CREATE FUNCTION pg_temp.imei_test_call(operation text,args jsonb,overrides jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE payload text; issued bigint:=floor(extract(epoch FROM clock_timestamp()));
BEGIN
  payload := (jsonb_build_object('version',1,'actor','00000000-0000-4000-8000-000000000001',
    'customer','30000000-0000-4000-8000-000000000001',
    'merchant','10000000-0000-4000-8000-000000000001','operation',operation,
    'issuedAt',issued,'expiresAt',issued+120,'args',args)||overrides)::text;
  RETURN public.imei_lookup_access(payload,encode(extensions.hmac('baci:imei-access:v1:'||payload,
    'test-imei-access-secret-at-least-32-bytes','sha256'),'hex'));
END $$;
-- New functions are no longer executable by other roles by default; the helper is
-- called after SET LOCAL ROLE authenticated.
GRANT EXECUTE ON FUNCTION pg_temp.imei_test_call(text, jsonb, jsonb) TO PUBLIC;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; lookup_id uuid; args jsonb; balance numeric; after_balance numeric; lease uuid:=gen_random_uuid();
BEGIN
  IF has_table_privilege('authenticated','public.imei_lookups','INSERT')
    OR has_table_privilege('authenticated','public.imei_lookups','UPDATE')
    OR has_function_privilege('anon','public.imei_lookup_access(text,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.refund_imei_wallet_payment(uuid,uuid,numeric,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'direct money/result grants expanded';
  END IF;
  BEGIN
    PERFORM public.imei_lookup_access('{}',repeat('0',64));
    RAISE EXCEPTION 'forged provider evidence accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM pg_temp.imei_test_call('read_replay','{}','{"actor":"00000000-0000-4000-8000-000000000002"}');
    RAISE EXCEPTION 'different subject accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM pg_temp.imei_test_call('read_replay','{}','{"merchant":"10000000-0000-4000-8000-000000000002"}');
    RAISE EXCEPTION 'cross-merchant customer accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM pg_temp.imei_test_call('read_replay','{}','{"issuedAt":1,"expiresAt":121}');
    RAISE EXCEPTION 'expired proof accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM pg_temp.imei_test_call('read_replay','{}','{"issuedAt":null,"expiresAt":null}');
    RAISE EXCEPTION 'missing proof timestamps accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  args:=jsonb_build_object('customer_id','30000000-0000-4000-8000-000000000001',
    'merchant_id','10000000-0000-4000-8000-000000000001','tier','basic','imei_hash',repeat('a',64),
    'idempotency_key','40000000-0000-4000-8000-000000000001','amount_ngn',300,'status','pending');
  BEGIN
    PERFORM pg_temp.imei_test_call('insert_pending',args||'{"amount_ngn":1}');
    RAISE EXCEPTION 'discounted retail amount accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r:=pg_temp.imei_test_call('insert_pending',args);
  lookup_id:=(r->>'id')::uuid;
  BEGIN
    PERFORM pg_temp.imei_test_call('insert_pending',args);
    RAISE EXCEPTION 'duplicate idempotency accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  r:=pg_temp.imei_test_call('read_replay',jsonb_build_object('idempotency_key',args->>'idempotency_key'));
  IF r->>'id' IS DISTINCT FROM lookup_id::text THEN RAISE EXCEPTION 'owned replay missing'; END IF;
  BEGIN
    PERFORM pg_temp.imei_test_call('cache',jsonb_build_object('lookup_id',lookup_id,'patch',
      jsonb_build_object('status','completed','cached_status',200,'cached_response','{"success":true}'::jsonb)));
    RAISE EXCEPTION 'completion without debit accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM pg_temp.imei_test_call('cache',jsonb_build_object('lookup_id',lookup_id,'patch',
      jsonb_build_object('cached_status',200,'cached_response','{}'::jsonb)));
    RAISE EXCEPTION 'null terminal status accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM pg_temp.imei_test_call('refund_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',300));
    RAISE EXCEPTION 'refund without debit minted wallet money';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='refund without debit minted wallet money' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM pg_temp.imei_test_call('redeem_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',1));
    RAISE EXCEPTION 'mismatched redemption amount accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT available_balance INTO balance FROM public.customer_wallets
    WHERE customer_id='30000000-0000-4000-8000-000000000001';
  PERFORM pg_temp.imei_test_call('redeem_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',300));
  PERFORM pg_temp.imei_test_call('redeem_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',300));
  SELECT available_balance INTO after_balance FROM public.customer_wallets
    WHERE customer_id='30000000-0000-4000-8000-000000000001';
  IF after_balance IS DISTINCT FROM balance-300 THEN RAISE EXCEPTION 'redemption replay charged twice'; END IF;
  r:=pg_temp.imei_test_call('read_payment_state',jsonb_build_object('lookup_id',lookup_id));
  IF r IS DISTINCT FROM '{"debited":true,"refunded":false}'::jsonb THEN RAISE EXCEPTION 'durable debit state missing'; END IF;
  BEGIN
    PERFORM pg_temp.imei_test_call('cache',jsonb_build_object('lookup_id',lookup_id,'patch',
      jsonb_build_object('status','failed_error','cached_status',500,'cached_response','{"success":false}'::jsonb)));
    RAISE EXCEPTION 'ambiguous charged lookup finalized as uncharged failure';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM pg_temp.imei_test_call('cache',jsonb_build_object('lookup_id',lookup_id,'patch',
      jsonb_build_object('status','wallet_rejected','cached_status',402,'cached_response','{"success":false}'::jsonb)));
    RAISE EXCEPTION 'ambiguous charged lookup rejected as unpaid';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM pg_temp.imei_test_call('delete_pending',jsonb_build_object('lookup_id',lookup_id));
    RAISE EXCEPTION 'charged row deletion accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM pg_temp.imei_test_call('refund_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',300));
  PERFORM pg_temp.imei_test_call('refund_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',300));
  SELECT available_balance INTO after_balance FROM public.customer_wallets
    WHERE customer_id='30000000-0000-4000-8000-000000000001';
  IF after_balance IS DISTINCT FROM balance THEN RAISE EXCEPTION 'refund replay minted money'; END IF;
  r:=pg_temp.imei_test_call('read_payment_state',jsonb_build_object('lookup_id',lookup_id));
  IF r IS DISTINCT FROM '{"debited":true,"refunded":true}'::jsonb THEN RAISE EXCEPTION 'durable refund state missing'; END IF;
  r:=pg_temp.imei_test_call('cache',jsonb_build_object('lookup_id',lookup_id,'patch',
    jsonb_build_object('status','refunded_error','cached_status',502,'cached_response','{"success":false}'::jsonb)));
  r:=pg_temp.imei_test_call('cache',jsonb_build_object('lookup_id',lookup_id,'patch',
    jsonb_build_object('status','refunded_error','cached_status',502,'cached_response','{"success":false}'::jsonb)));
  BEGIN
    PERFORM pg_temp.imei_test_call('redeem_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',300));
    RAISE EXCEPTION 'terminal lookup charged again';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Exercise all Petrock gateway delegates against their real SQL functions.
  args:=args||'{"idempotency_key":"40000000-0000-4000-8000-000000000002"}'::jsonb;
  r:=pg_temp.imei_test_call('insert_pending',args); lookup_id:=(r->>'id')::uuid;
  PERFORM pg_temp.imei_test_call('redeem_imei_wallet_and_begin_provider_submission',jsonb_build_object(
    'p_lookup_id',lookup_id,'p_amount',300,'p_provider','petrock','p_reference_id',lookup_id::text,
    'p_feedback_token_hash',repeat('b',64),'p_identifier_ciphertext','test-ciphertext','p_cost_usd',0.05,
    'p_provider_attempt_started_at',clock_timestamp()));
  r:=pg_temp.imei_test_call('mark_petrock_imei_submission_unknown',jsonb_build_object(
    'p_lookup_id',lookup_id,'p_provider_status','test-unknown'));
  IF r IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'mark unknown delegate failed'; END IF;
  r:=pg_temp.imei_test_call('record_petrock_imei_submission',jsonb_build_object(
    'p_lookup_id',lookup_id,'p_order_id','test-order','p_provider_status','pending',
    'p_next_poll_at',clock_timestamp()-interval '1 minute'));
  IF r IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'record submission delegate failed'; END IF;
  r:=pg_temp.imei_test_call('claim_petrock_imei_lookup_poll',jsonb_build_object(
    'p_lookup_id',lookup_id,'p_lease_token',lease));
  IF r#>>'{0,id}' IS DISTINCT FROM lookup_id::text THEN RAISE EXCEPTION 'poll claim delegate failed'; END IF;
  r:=pg_temp.imei_test_call('reschedule_petrock_imei_lookup_poll',jsonb_build_object(
    'p_lookup_id',lookup_id,'p_lease_token',lease,'p_provider_status','pending',
    'p_next_poll_at',clock_timestamp()-interval '1 minute'));
  IF r IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'reschedule delegate failed'; END IF;
  lease:=gen_random_uuid();
  PERFORM pg_temp.imei_test_call('claim_petrock_imei_lookup_poll',jsonb_build_object(
    'p_lookup_id',lookup_id,'p_lease_token',lease));
  r:=pg_temp.imei_test_call('finalize_petrock_imei_lookup',jsonb_build_object(
    'p_lookup_id',lookup_id,'p_lease_token',lease,'p_provider_status','success',
    'p_terminal_status','completed','p_cached_status',200,'p_cached_response','{"success":true}'::jsonb));
  IF r IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'finalize delegate failed'; END IF;
END $$;
ROLLBACK;
