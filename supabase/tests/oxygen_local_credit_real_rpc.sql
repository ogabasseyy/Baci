DO $$
DECLARE o uuid:='00000000-0000-4000-8000-000000000010'; m uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); g uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
BEGIN
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 INSERT INTO public.customers VALUES(c,m,u);
 INSERT INTO public.orders(id,payment_method,wallet_amount_used,merchant_id,customer_id) VALUES(o,'oxygen',0,m,c);
 INSERT INTO public.customer_wallets VALUES(gen_random_uuid(),c,m,100,0,now());
 INSERT INTO public.customer_savings_goals VALUES(g,c,m,p,NULL,'active',100,100,NULL,NULL,now());
 INSERT INTO public.order_items VALUES(o,p,NULL);
 BEGIN
  PERFORM public.redeem_savings_for_order(c,m,o,g,20,'credit-actual-test');
  RAISE EXCEPTION 'savings RPC escaped fence';
 EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_local_credit_in_use' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.redeem_wallet_for_order(c,m,o,20,'credit-actual-test');
  RAISE EXCEPTION 'wallet RPC escaped fence';
 EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_local_credit_in_use' THEN RAISE; END IF; END;
 IF (SELECT available_balance FROM public.customer_wallets WHERE customer_id=c)<>100 OR (SELECT current_amount FROM public.customer_savings_goals WHERE id=g)<>100 THEN RAISE EXCEPTION 'credit amount changed'; END IF;
END $$;
