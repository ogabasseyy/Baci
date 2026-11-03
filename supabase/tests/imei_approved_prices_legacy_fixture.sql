-- Disposable database only: create a real old-price debit before repricing.
INSERT INTO private.imei_access_secrets(singleton,secret)
 VALUES(true,'test-imei-access-secret-at-least-32-bytes')
 ON CONFLICT(singleton) DO UPDATE SET secret=excluded.secret;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
-- Scratch fixture funding only; never execute against an existing database.
UPDATE public.customer_wallets SET available_balance=100000
 WHERE customer_id='30000000-0000-4000-8000-000000000001';
CREATE TABLE private.approved_price_legacy_fixture (lookup_id uuid, original_balance numeric);
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
DO $$ DECLARE r jsonb; lookup_id uuid; initial_balance numeric;
BEGIN
 SELECT available_balance INTO initial_balance FROM public.customer_wallets
 WHERE customer_id='30000000-0000-4000-8000-000000000001';
 r:=pg_temp.approved_price_call('insert_pending',jsonb_build_object(
 'customer_id','30000000-0000-4000-8000-000000000001',
 'merchant_id','10000000-0000-4000-8000-000000000001','tier','full',
 'imei_hash',repeat('a',64),'device_category','smartphone',
 'idempotency_key',gen_random_uuid(),'amount_ngn',1500,'status','pending'));
 lookup_id:=(r->>'id')::uuid;
 PERFORM pg_temp.approved_price_call('redeem_imei_wallet_payment',jsonb_build_object('p_lookup_id',lookup_id,'p_amount',1500));
 INSERT INTO private.approved_price_legacy_fixture VALUES(lookup_id,initial_balance);
END $$;
