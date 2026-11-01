BEGIN;
INSERT INTO public.customers VALUES('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
INSERT INTO public.imei_lookups(id,customer_id,merchant_id,tier,imei_hash,idempotency_key,amount_ngn,status,device_category,cached_response,cached_status)
VALUES ('70000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','simLock','hash-1','80000000-0000-4000-8000-000000000001',500,'completed','smartphone','{"success":true}',200),
('70000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','simLock','hash-2','80000000-0000-4000-8000-000000000002',500,'completed','smartphone','{"success":true}',200);
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE owned integer; foreign_rows integer; BEGIN
 IF NOT has_column_privilege('authenticated','public.imei_lookups','device_category','SELECT') THEN RAISE EXCEPTION 'history device category read grant missing'; END IF;
 IF has_column_privilege('anon','public.imei_lookups','device_category','SELECT') OR has_column_privilege('authenticated','public.imei_lookups','device_category','UPDATE') THEN RAISE EXCEPTION 'history access expanded beyond authenticated reads'; END IF;
 IF has_column_privilege('authenticated','public.imei_lookups','provider_order_id','SELECT') THEN RAISE EXCEPTION 'private provider column exposed'; END IF;
 SELECT count(*) INTO owned FROM (SELECT id,tier,device_category,created_at,cached_response FROM public.imei_lookups WHERE merchant_id='10000000-0000-4000-8000-000000000001' AND customer_id='30000000-0000-4000-8000-000000000001' AND status='completed' AND cached_status=200 ORDER BY created_at DESC,id DESC LIMIT 21) reports;
 IF owned<>1 THEN RAISE EXCEPTION 'owned completed report unavailable'; END IF;
 SELECT count(*) INTO foreign_rows FROM public.imei_lookups WHERE customer_id='30000000-0000-4000-8000-000000000002';
 IF foreign_rows<>0 THEN RAISE EXCEPTION 'cross-customer report exposed'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
