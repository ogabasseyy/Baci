-- Disposable database only: no supplier calls or real wallet transactions.
BEGIN;
INSERT INTO private.imei_access_secrets(singleton, secret)
  VALUES (true, 'test-imei-access-secret-at-least-32-bytes')
  ON CONFLICT(singleton) DO UPDATE SET secret = excluded.secret;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
CREATE FUNCTION pg_temp.claim_attempt(args jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE payload text; issued bigint := floor(extract(epoch FROM clock_timestamp()));
BEGIN
  payload := jsonb_build_object('version', 1, 'actor', '00000000-0000-4000-8000-000000000001',
    'customer', '30000000-0000-4000-8000-000000000001',
    'merchant', '10000000-0000-4000-8000-000000000001', 'operation', 'claim_attempt',
    'issuedAt', issued, 'expiresAt', issued + 120, 'args', args)::text;
  RETURN public.imei_claim_attempt(payload, encode(extensions.hmac('baci:imei-access:v1:' || payload,
    'test-imei-access-secret-at-least-32-bytes', 'sha256'), 'hex'));
END $$;
DO $$ BEGIN
  IF has_table_privilege('authenticated', 'private.imei_attempt_claims', 'SELECT')
     OR has_function_privilege('anon', 'public.imei_claim_attempt(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'attempt claim boundary exposed';
  END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE a jsonb; b jsonb; args jsonb;
BEGIN
  BEGIN
    PERFORM public.imei_claim_attempt('{}', repeat('0', 64));
    RAISE EXCEPTION 'forged attempt claim accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  args := jsonb_build_object('tier', 'blacklist', 'imei_hash', repeat('f', 64),
    'idempotency_key', '40000000-0000-4000-8000-000000000001');
  a := pg_temp.claim_attempt(args);
  b := pg_temp.claim_attempt(args || '{"idempotency_key":"40000000-0000-4000-8000-000000000002"}');
  IF a->>'idempotency_key' IS DISTINCT FROM b->>'idempotency_key' THEN
    RAISE EXCEPTION 'different client keys did not converge';
  END IF;
  b := pg_temp.claim_attempt(args || '{"idempotency_key":"40000000-0000-4000-8000-000000000003","previous_lookup_id":"50000000-0000-4000-8000-000000000001"}');
  IF a->>'idempotency_key' IS DISTINCT FROM b->>'idempotency_key' THEN
    RAISE EXCEPTION 'unconfirmed attempt was replaced';
  END IF;
END $$;
RESET ROLE;
INSERT INTO public.imei_lookups(id, customer_id, merchant_id, tier, imei_hash, idempotency_key, amount_ngn, status, cached_response, cached_status)
VALUES ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001', 'blacklist', repeat('f',64),
  '40000000-0000-4000-8000-000000000001', 700, 'completed', '{"success":true}'::jsonb, 200);
INSERT INTO public.customer_wallet_transactions(customer_id,merchant_id,type,status,amount,source_type,source_id)
VALUES ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','redemption','completed',700,'imei_wallet_payment','50000000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $$ DECLARE args jsonb; fresh jsonb; concurrent jsonb;
BEGIN
  args := jsonb_build_object('tier', 'blacklist', 'imei_hash', repeat('f',64),
    'idempotency_key', '40000000-0000-4000-8000-000000000004',
    'previous_lookup_id', '50000000-0000-4000-8000-000000000001');
  fresh := pg_temp.claim_attempt(args);
  concurrent := pg_temp.claim_attempt(args || '{"idempotency_key":"40000000-0000-4000-8000-000000000005"}');
  IF fresh->>'idempotency_key' IS DISTINCT FROM '40000000-0000-4000-8000-000000000004'
     OR concurrent->>'idempotency_key' IS DISTINCT FROM fresh->>'idempotency_key' THEN
    RAISE EXCEPTION 'confirmed repeat did not converge';
  END IF;
END $$;
RESET ROLE;
INSERT INTO private.imei_attempt_claims(merchant_id,customer_id,tier,imei_hash,idempotency_key)
VALUES ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','blacklist',repeat('e',64),'40000000-0000-4000-8000-000000000011'),
       ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','blacklist',repeat('d',64),'40000000-0000-4000-8000-000000000021');
INSERT INTO public.imei_lookups(id,customer_id,merchant_id,tier,imei_hash,idempotency_key,amount_ngn,status,cached_response,cached_status)
VALUES ('50000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','blacklist',repeat('e',64),'40000000-0000-4000-8000-000000000011',700,'wallet_rejected','{"success":false,"code":"WALLET_INSUFFICIENT"}',402),
       ('50000000-0000-4000-8000-000000000021','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','blacklist',repeat('d',64),'40000000-0000-4000-8000-000000000021',700,'failed_error','{"success":false,"code":"INTERNAL_ERROR"}',500);
SET LOCAL ROLE authenticated;
DO $$ DECLARE next_attempt jsonb; unknown_attempt jsonb;
BEGIN
  next_attempt := pg_temp.claim_attempt(jsonb_build_object('tier','blacklist','imei_hash',repeat('e',64),'idempotency_key','40000000-0000-4000-8000-000000000012'));
  IF next_attempt->>'idempotency_key' IS DISTINCT FROM '40000000-0000-4000-8000-000000000012' THEN
    RAISE EXCEPTION 'confirmed no-debit rejection could not be retried';
  END IF;
  unknown_attempt := pg_temp.claim_attempt(jsonb_build_object('tier','blacklist','imei_hash',repeat('d',64),'idempotency_key','40000000-0000-4000-8000-000000000022','previous_lookup_id','50000000-0000-4000-8000-000000000021'));
  IF unknown_attempt->>'idempotency_key' IS DISTINCT FROM '40000000-0000-4000-8000-000000000021' THEN
    RAISE EXCEPTION 'unknown failure was replaced';
  END IF;
END $$;
DO $$ DECLARE r jsonb;
BEGIN
  r := pg_temp.claim_attempt(jsonb_build_object('tier','blacklist','imei_hash',repeat('b',64),
    'idempotency_key','80000000-0000-4000-8000-000000000004',
    'previous_lookup_id','70000000-0000-4000-8000-000000000003'));
  IF r->>'idempotency_key' IS DISTINCT FROM '80000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'older unresolved attempt was not selected';
  END IF;
END $$;
RESET ROLE;
UPDATE public.imei_lookups SET status='refunded_error', cached_response='{"success":false}', cached_status=502
  WHERE id='70000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;
BEGIN
  r := pg_temp.claim_attempt(jsonb_build_object('tier','blacklist','imei_hash',repeat('b',64),
    'idempotency_key','80000000-0000-4000-8000-000000000004',
    'previous_lookup_id','70000000-0000-4000-8000-000000000003'));
  IF r->>'idempotency_key' IS DISTINCT FROM '80000000-0000-4000-8000-000000000002' THEN
    RAISE EXCEPTION 'second unresolved attempt was not selected';
  END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.imei_lookups(customer_id,merchant_id,tier,imei_hash,idempotency_key,amount_ngn,status)
    VALUES ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','blacklist',repeat('b',64),'80000000-0000-4000-8000-000000000005',700,'pending');
    RAISE EXCEPTION 'legacy insertion bypassed the canonical claim';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO private.imei_attempt_claims(merchant_id,customer_id,tier,imei_hash,idempotency_key)
VALUES ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','blacklist',repeat('9',64),'40000000-0000-4000-8000-000000000031');
INSERT INTO public.imei_lookups(id,customer_id,merchant_id,tier,imei_hash,idempotency_key,amount_ngn,status,cached_response,cached_status)
VALUES ('50000000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','blacklist',repeat('9',64),'40000000-0000-4000-8000-000000000031',700,'completed','{"success":true}',200);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;
BEGIN
  r := pg_temp.claim_attempt(jsonb_build_object('tier','blacklist','imei_hash',repeat('9',64),'idempotency_key','40000000-0000-4000-8000-000000000032','previous_lookup_id','50000000-0000-4000-8000-000000000031'));
  IF r->>'idempotency_key' IS DISTINCT FROM '40000000-0000-4000-8000-000000000031' THEN
    RAISE EXCEPTION 'completion without debit evidence was replaced';
  END IF;
END $$;


-- A durable matching refund recovers a Sickw row when both response writes failed.
RESET ROLE;
INSERT INTO public.imei_lookups(id, customer_id, merchant_id, tier, imei_hash, idempotency_key, amount_ngn, status, provider)
VALUES ('50000000-0000-4000-8000-000000000041','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','blacklist',repeat('8',64),'40000000-0000-4000-8000-000000000041',700,'pending','sickw');
INSERT INTO public.customer_wallet_transactions(customer_id,merchant_id,type,status,amount,source_type,source_id)
VALUES ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','redemption','completed',700,'imei_wallet_payment','50000000-0000-4000-8000-000000000041'),
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','refund','completed',700,'imei_wallet_refund','50000000-0000-4000-8000-000000000041');
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
  r := pg_temp.claim_attempt(jsonb_build_object('tier','blacklist','imei_hash',repeat('8',64),'idempotency_key','40000000-0000-4000-8000-000000000042'));
  IF r->>'idempotency_key' IS DISTINCT FROM '40000000-0000-4000-8000-000000000042' THEN
    RAISE EXCEPTION 'confirmed Sickw refund remained stuck pending';
  END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.imei_lookups WHERE id='50000000-0000-4000-8000-000000000041' AND status='refunded_error' AND cached_response->>'code'='SICKW_UNAVAILABLE' AND cached_status=502) THEN
    RAISE EXCEPTION 'refund recovery did not persist a replayable terminal response';
  END IF;
END $$;

-- Wrong refund amount or a Petrock attempt never gains retry authority.
INSERT INTO public.imei_lookups(id,customer_id,merchant_id,tier,imei_hash,idempotency_key,amount_ngn,status,provider)
VALUES ('50000000-0000-4000-8000-000000000051','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','blacklist',repeat('7',64),'40000000-0000-4000-8000-000000000051',700,'pending','sickw'),
('50000000-0000-4000-8000-000000000061','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','blacklist',repeat('6',64),'40000000-0000-4000-8000-000000000061',700,'pending_provider','petrock');
INSERT INTO public.customer_wallet_transactions(customer_id,merchant_id,type,status,amount,source_type,source_id)
VALUES ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','redemption','completed',700,'imei_wallet_payment','50000000-0000-4000-8000-000000000051'),
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','refund','completed',699,'imei_wallet_refund','50000000-0000-4000-8000-000000000051'),
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','redemption','completed',700,'imei_wallet_payment','50000000-0000-4000-8000-000000000061'),
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','refund','completed',700,'imei_wallet_refund','50000000-0000-4000-8000-000000000061');
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
  r := pg_temp.claim_attempt(jsonb_build_object('tier','blacklist','imei_hash',repeat('7',64),'idempotency_key','40000000-0000-4000-8000-000000000052'));
  IF r->>'idempotency_key' IS DISTINCT FROM '40000000-0000-4000-8000-000000000051' THEN RAISE EXCEPTION 'mismatched refund incorrectly advanced'; END IF;
  r := pg_temp.claim_attempt(jsonb_build_object('tier','blacklist','imei_hash',repeat('6',64),'idempotency_key','40000000-0000-4000-8000-000000000062'));
  IF r->>'idempotency_key' IS DISTINCT FROM '40000000-0000-4000-8000-000000000061' THEN RAISE EXCEPTION 'Petrock attempt incorrectly reconciled as Sickw'; END IF;
END $$;

ROLLBACK;
