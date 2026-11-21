-- Run wallet-orders.fixture.sql and the gift-card migration first, in a disposable database.
BEGIN;

INSERT INTO vault.decrypted_secrets VALUES
  ('gift_card_wallet_quote_hmac', repeat('t', 48));
INSERT INTO public.merchants VALUES ('20000000-0000-4000-8000-000000000001', 'ogabassey');
INSERT INTO public.customers VALUES
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
INSERT INTO public.customer_wallets (id, customer_id, merchant_id, available_balance, total_redeemed)
VALUES ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',20000,0);

DO $$
DECLARE
  payload jsonb;
  proof text;
  confirmation record;
  now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000);
BEGIN
  IF has_function_privilege('anon','public.confirm_gift_card_wallet_quote(text,text)','EXECUTE')
     OR has_table_privilege('authenticated','public.gift_card_wallet_orders','SELECT') THEN
    RAISE EXCEPTION 'Unexpected access grants';
  END IF;
  payload := jsonb_build_object(
    'id','50000000-0000-4000-8000-000000000001',
    'userId','10000000-0000-4000-8000-000000000001',
    'merchantId','20000000-0000-4000-8000-000000000001',
    'cardId','3007','totalKobo',1025634,'expiresAt',now_ms + 59000
  );
  proof := encode(extensions.hmac('baci:gift-card-wallet:v1' || chr(10) || payload::text, repeat('t',48),'sha256'),'hex');
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
  BEGIN
    PERFORM public.confirm_gift_card_wallet_quote(payload::text,proof);
    RAISE EXCEPTION 'Wrong user was permitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
  BEGIN
    PERFORM public.confirm_gift_card_wallet_quote(jsonb_set(payload,'{totalKobo}','1')::text,proof);
    RAISE EXCEPTION 'Tampered quote was permitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  SET LOCAL ROLE authenticated;
  SELECT * INTO confirmation FROM public.confirm_gift_card_wallet_quote(payload::text,proof);
  IF confirmation.order_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'First confirmation did not create a paid order';
  END IF;
  SELECT * INTO confirmation FROM public.confirm_gift_card_wallet_quote(payload::text,proof);
  IF confirmation.order_id IS DISTINCT FROM (payload->>'id')::uuid THEN
    RAISE EXCEPTION 'Replay did not return the same order';
  END IF;
  RESET ROLE;

  payload := payload || jsonb_build_object('id','50000000-0000-4000-8000-000000000002','expiresAt',now_ms - 1);
  proof := encode(extensions.hmac('baci:gift-card-wallet:v1' || chr(10) || payload::text, repeat('t',48),'sha256'),'hex');
  BEGIN
    PERFORM public.confirm_gift_card_wallet_quote(payload::text,proof);
    RAISE EXCEPTION 'Expired quote was permitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  payload := payload || jsonb_build_object('expiresAt',now_ms + 59000);
  proof := encode(extensions.hmac('baci:gift-card-wallet:v1' || chr(10) || payload::text, repeat('t',48),'sha256'),'hex');
  BEGIN
    PERFORM public.confirm_gift_card_wallet_quote(payload::text,proof);
    RAISE EXCEPTION 'Insufficient funds were accepted' USING ERRCODE = 'XX000';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'insufficient_wallet_balance' THEN RAISE; END IF;
  END;

  IF (SELECT available_balance FROM public.customer_wallets) <> 9743.66
     OR (SELECT count(*) FROM public.customer_wallet_transactions) <> 1
     OR (SELECT count(*) FROM public.gift_card_wallet_orders) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one durable debit and order';
  END IF;
END;
$$;

ROLLBACK;
