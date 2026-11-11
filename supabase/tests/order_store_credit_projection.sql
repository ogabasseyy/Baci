SELECT set_config('test.actor','00000000-0000-4000-8000-000000000003',false);
SET ROLE authenticated;
DO $$ DECLARE answer jsonb; n integer;
BEGIN
 answer:=public.record_order_store_credit('00000000-0000-4000-8000-000000000010');
 IF answer <> '{"wallet":20000,"savings":0}'::jsonb THEN RAISE EXCEPTION 'wallet projection mismatch'; END IF;
 IF public.record_order_store_credit('00000000-0000-4000-8000-000000000010')<>answer THEN RAISE EXCEPTION 'replay mismatch'; END IF;
 IF public.record_order_store_credit('00000000-0000-4000-8000-000000000011')<>'{"wallet":20000,"savings":5000}'::jsonb THEN RAISE EXCEPTION 'combined projection mismatch'; END IF;
 FOR n IN 12..23 LOOP
  BEGIN
   PERFORM public.record_order_store_credit(('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid);
   RAISE EXCEPTION 'unsafe credit admitted for case %',n;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
 END LOOP;
END $$;
RESET ROLE;
BEGIN;
INSERT INTO public.transactions(order_id,transaction_type,status)
VALUES ('00000000-0000-4000-8000-000000000010','payment','pending');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.record_order_store_credit('00000000-0000-4000-8000-000000000010');
  RAISE EXCEPTION 'credit replay admitted after gateway initialization';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'Store credit reconciliation required' THEN RAISE; END IF;
 END;
END $$;
ROLLBACK;
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000009',false);
DO $$ BEGIN
 BEGIN
  PERFORM public.record_order_store_credit('00000000-0000-4000-8000-000000000010');
  RAISE EXCEPTION 'cross-customer projection allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.orders WHERE id='00000000-0000-4000-8000-000000000010' AND total=50000 AND amount_paid=20000 AND wallet_amount_used=20000) THEN RAISE EXCEPTION 'wallet funding was not preserved'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.orders WHERE id='00000000-0000-4000-8000-000000000011' AND total=50000 AND amount_paid=25000 AND wallet_amount_used=20000) THEN RAISE EXCEPTION 'combined funding mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.orders WHERE id>'00000000-0000-4000-8000-000000000011' AND id<>'00000000-0000-4000-8000-000000000015' AND amount_paid<>0) THEN RAISE EXCEPTION 'rejected order mutated'; END IF;
 IF has_function_privilege('anon','public.record_order_store_credit(uuid)','EXECUTE') OR has_function_privilege('service_role','public.record_order_store_credit(uuid)','EXECUTE') THEN RAISE EXCEPTION 'unexpected projection access'; END IF;
END $$;
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000003',false);
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.record_order_store_credit('00000000-0000-4000-8000-000000000010');
  RAISE EXCEPTION 'stale snapshot admitted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
ROLLBACK;
