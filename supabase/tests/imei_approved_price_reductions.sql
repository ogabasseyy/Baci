-- Disposable database only. Exercise approved retail amounts with real wallet functions.
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
CREATE FUNCTION pg_temp.approved_price_call(operation text,args jsonb)
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
-- New functions are no longer executable by other roles by default; the helper is
-- called after SET LOCAL ROLE authenticated.
GRANT EXECUTE ON FUNCTION pg_temp.approved_price_call(text, jsonb) TO PUBLIC;
-- An old charged lookup keeps its original amount after the price reduction.
DO $$ DECLARE legacy record; balance numeric;
BEGIN
 SELECT * INTO legacy FROM private.approved_price_legacy_fixture;
 PERFORM pg_temp.approved_price_call('refund_imei_wallet_payment',
 jsonb_build_object('p_lookup_id',legacy.lookup_id,'p_amount',1500));
 PERFORM pg_temp.approved_price_call('refund_imei_wallet_payment',
 jsonb_build_object('p_lookup_id',legacy.lookup_id,'p_amount',1500));
 SELECT available_balance INTO balance FROM public.customer_wallets
 WHERE customer_id='30000000-0000-4000-8000-000000000001';
 IF balance IS DISTINCT FROM legacy.original_balance THEN RAISE EXCEPTION 'old-price refund lost or duplicated money'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE tier_row record; args jsonb; result jsonb; lookup_id uuid;
 amount numeric; balance numeric; after_balance numeric;
BEGIN
 FOR tier_row IN SELECT * FROM (VALUES
    ('applePartNumber',700,700),
    ('simLock',500,500),
    ('serialInfo',200,200),
    ('appleBasic',500,800),
    ('demoUnit',1900,3300),
    ('icloud',300,300),
    ('full',1000,1500),
    ('gsxPremium',6300,32700),
    ('knoxGuard',2900,5000),
    ('mdm',2900,5000),
    ('macIcloud',1900,3300),
    ('miLock',1000,1500),
    ('miLostPro',4800,8000),
    ('carrierFmi',800,1300),
    ('carrier',600,1000),
    ('activation',400,700),
    ('oppoRealme',1900,3300),
    ('pixel',1200,2000),
    ('basic',300,300),
    ('repairEligibility',1400,2300),
    ('gsxRepairs',3800,19600),
    ('replacementHistory',6700,11500),
    ('samsung',600,1000),
    ('samsungPro',1000,1500),
    ('soldByCountry',5700,29400),
    ('blacklist',700,700),
    ('blacklistPro',1200,2000),
    ('transsion',300,500),
    ('esimCompatibility',400,700),
    ('icloudCleanLost',300,500),
    ('icloudPro',2100,3500)
 ) AS approved(tier,new_price,old_price) LOOP
  args:=jsonb_build_object('customer_id','30000000-0000-4000-8000-000000000001',
   'merchant_id','10000000-0000-4000-8000-000000000001','tier',tier_row.tier,
   'imei_hash',repeat('b',64),'device_category','smartphone',
   'idempotency_key',gen_random_uuid(),'amount_ngn',tier_row.new_price,'status','pending');
  FOREACH amount IN ARRAY ARRAY[0,tier_row.new_price-1,tier_row.new_price+1] LOOP
   BEGIN
    PERFORM pg_temp.approved_price_call('insert_pending',args||jsonb_build_object('amount_ngn',amount));
    RAISE EXCEPTION 'incorrect price accepted for %',tier_row.tier;
   EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  IF tier_row.old_price<>tier_row.new_price THEN
   BEGIN
    PERFORM pg_temp.approved_price_call('insert_pending',args||jsonb_build_object('amount_ngn',tier_row.old_price));
    RAISE EXCEPTION 'old higher price accepted for new % order',tier_row.tier;
   EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END IF;
  result:=pg_temp.approved_price_call('insert_pending',args); lookup_id:=(result->>'id')::uuid;
  SELECT available_balance INTO balance FROM public.customer_wallets
   WHERE customer_id='30000000-0000-4000-8000-000000000001';
  PERFORM pg_temp.approved_price_call('redeem_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',tier_row.new_price));
  PERFORM pg_temp.approved_price_call('redeem_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',tier_row.new_price));
  SELECT available_balance INTO after_balance FROM public.customer_wallets
   WHERE customer_id='30000000-0000-4000-8000-000000000001';
  IF after_balance IS DISTINCT FROM balance-tier_row.new_price THEN RAISE EXCEPTION 'incorrect debit/replay for %',tier_row.tier; END IF;
  PERFORM pg_temp.approved_price_call('refund_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',tier_row.new_price));
  PERFORM pg_temp.approved_price_call('refund_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',tier_row.new_price));
  SELECT available_balance INTO after_balance FROM public.customer_wallets
   WHERE customer_id='30000000-0000-4000-8000-000000000001';
  IF after_balance IS DISTINCT FROM balance THEN RAISE EXCEPTION 'incorrect refund/replay for %',tier_row.tier; END IF;
 END LOOP;
END $$;
ROLLBACK;
