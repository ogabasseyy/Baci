-- Rollback-only financial fence test. Provider activation is not settlement.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
VALUES
 ('efb10000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fence-owner@example.test','test',now(),now(),now(),'{}','{}'),
 ('efb10000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fence-other@example.test','test',now(),now(),now(),'{}','{}'),
 ('efb10000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fence-staff@example.test','test',now(),now(),now(),'{}','{}'),
 ('efb10000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fence-worker@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','efb10000-0000-4000-8000-000000000001',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug,vat_registration_status)
VALUES ('efb10000-0000-4000-8000-000000000011','efb10000-0000-4000-8000-000000000001','fence-owner@example.test','Fence merchant','oxygen-financial-fence-test','registered');
INSERT INTO public.staff_members(merchant_id,user_id,email,name,role,permissions,status)
VALUES ('efb10000-0000-4000-8000-000000000011','efb10000-0000-4000-8000-000000000003','fence-staff@example.test','Fence staff','sales_rep','{"orders":{"edit":true,"view":true}}','active');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('efb10000-0000-4000-8000-000000000021','efb10000-0000-4000-8000-000000000011','efb10000-0000-4000-8000-000000000002','Test','Customer','fence-other@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,subtotal,total,currency,payment_status,payment_method,shipping_fee,discount_amount)
VALUES
 ('efb10000-0000-4000-8000-000000000031','efb10000-0000-4000-8000-000000000011','efb10000-0000-4000-8000-000000000021','OXYGEN-FENCE-1',100,100,'NGN','unpaid','oxygen',0,0),
 ('efb10000-0000-4000-8000-000000000032','efb10000-0000-4000-8000-000000000011','efb10000-0000-4000-8000-000000000021','OXYGEN-FENCE-2',100,100,'NGN','unpaid','paystack',0,0);
INSERT INTO public.order_items(id,order_id,name,price,quantity)
VALUES ('efb10000-0000-4000-8000-000000000061','efb10000-0000-4000-8000-000000000031','Fixture',100,1);
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id,stage)
VALUES ('efb10000-0000-4000-8000-000000000041','efb10000-0000-4000-8000-000000000031','efb10000-0000-4000-8000-000000000011','efb10000-0000-4000-8000-000000000021','application_required');
SELECT set_config('request.jwt.claim.sub','efb10000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
-- No obligation yet: edits remain available, as do unrelated orders.
UPDATE public.orders SET shipping_fee=1 WHERE id='efb10000-0000-4000-8000-000000000031';
UPDATE public.orders SET shipping_fee=1 WHERE id='efb10000-0000-4000-8000-000000000032';
RESET ROLE;
-- Service-role checkout work remains possible before a liability exists.
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
INSERT INTO public.order_items(id,order_id,name,price,quantity) VALUES('efb10000-0000-4000-8000-000000000062','efb10000-0000-4000-8000-000000000031','System temporary',1,1);
DELETE FROM public.order_items WHERE id='efb10000-0000-4000-8000-000000000062';
INSERT INTO public.order_tax_subtotals(id,order_id,vat_category_code,vat_rate,taxable_amount,tax_amount) VALUES('efb10000-0000-4000-8000-000000000072','efb10000-0000-4000-8000-000000000031','Z',0,1,0);
DELETE FROM public.order_tax_subtotals WHERE id='efb10000-0000-4000-8000-000000000072';
UPDATE public.orders SET subtotal=101,total=101 WHERE id='efb10000-0000-4000-8000-000000000031';
UPDATE public.order_items SET price=101 WHERE id='efb10000-0000-4000-8000-000000000061';
UPDATE public.order_items SET price=100 WHERE id='efb10000-0000-4000-8000-000000000061';
UPDATE public.orders SET subtotal=100,total=100 WHERE id='efb10000-0000-4000-8000-000000000031';
RESET ROLE;
-- Item writes rebuild tax rows; retain their computed VAT amounts so a later
-- operational item update does not attempt a spurious financial tax rewrite.
UPDATE public.order_tax_subtotals SET id='efb10000-0000-4000-8000-000000000071'
 WHERE order_id='efb10000-0000-4000-8000-000000000031' AND vat_category_code='S' AND vat_rate=7.5;
SELECT set_config('request.jwt.claim.sub','efb10000-0000-4000-8000-000000000001',true);
-- Eligibility is already bound to the original order and customer.
UPDATE public.oxygen_workflows SET stage='eligibility_required' WHERE id='efb10000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES ('efb10000-0000-4000-8000-000000000041','{"applicationReference":"fixture"}');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN UPDATE public.orders SET total=101 WHERE id='efb10000-0000-4000-8000-000000000031'; RAISE EXCEPTION 'Eligibility total changed'; EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_financial_edit_locked' THEN RAISE; END IF; END;
 BEGIN UPDATE public.orders SET customer_id='efb10000-0000-4000-8000-000000000022' WHERE id='efb10000-0000-4000-8000-000000000031'; RAISE EXCEPTION 'Eligibility customer changed'; EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_financial_edit_locked' THEN RAISE; END IF; END;
 BEGIN UPDATE public.order_items SET quantity=2 WHERE id='efb10000-0000-4000-8000-000000000061'; RAISE EXCEPTION 'Eligibility item changed'; EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_financial_edit_locked' THEN RAISE; END IF; END;
 BEGIN UPDATE public.orders SET payment_method='paystack',total=101 WHERE id='efb10000-0000-4000-8000-000000000031'; RAISE EXCEPTION 'Combined exit and total change succeeded'; EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_financial_edit_locked' THEN RAISE; END IF; END;
END $$;
-- Exercise the safe exit in a subtransaction so later tests keep the same
-- Oxygen-origin order without bypassing the no-re-entry fence.
DO $$ BEGIN
 BEGIN
  UPDATE public.orders SET payment_method='paystack' WHERE id='efb10000-0000-4000-8000-000000000031';
  RAISE EXCEPTION 'Rollback trial exit' USING ERRCODE='P1011';
 EXCEPTION WHEN SQLSTATE 'P1011' THEN NULL;
 END;
END $$;
RESET ROLE;
DELETE FROM oxygen_private.provider_states WHERE workflow_id='efb10000-0000-4000-8000-000000000041';
UPDATE public.oxygen_workflows SET stage='application_required' WHERE id='efb10000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.commands(workflow_id,idempotency_key,expected_version,channel,command,status)
VALUES ('efb10000-0000-4000-8000-000000000041','efb10000-0000-4000-8000-000000000081',0,'web','{"action":"book"}','queued');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN UPDATE public.orders SET shipping_fee=2 WHERE id='efb10000-0000-4000-8000-000000000031'; RAISE EXCEPTION 'Queued booking was bypassed'; EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_financial_edit_locked' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.commands SET status='indeterminate' WHERE workflow_id='efb10000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN UPDATE public.orders SET shipping_fee=2 WHERE id='efb10000-0000-4000-8000-000000000031'; RAISE EXCEPTION 'Uncertain booking was bypassed'; EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_financial_edit_locked' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
DELETE FROM oxygen_private.commands WHERE workflow_id='efb10000-0000-4000-8000-000000000041';
UPDATE public.oxygen_workflows SET stage='payment_required' WHERE id='efb10000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES ('efb10000-0000-4000-8000-000000000041','{"bookingReference":"efb10000-0000-4000-8000-000000000051","booking":{"status":"APPROVED"}}');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.order_tax_subtotals WHERE id='efb10000-0000-4000-8000-000000000071' AND order_id='efb10000-0000-4000-8000-000000000031') THEN
  RAISE EXCEPTION 'Owner cannot see fixture tax row' USING ERRCODE='P1010';
 END IF;
END $$;
-- Stable sentinel SQLSTATEs P1001-P1009 identify this block's assertions in
-- sanitized replay logs. Any missing expected rejection still fails the suite.
DO $$ BEGIN
 BEGIN UPDATE public.orders SET shipping_fee=2 WHERE id='efb10000-0000-4000-8000-000000000031'; RAISE EXCEPTION 'Shipping fee changed' USING ERRCODE='P1001'; EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_financial_edit_locked' THEN RAISE; END IF; END;
 BEGIN UPDATE public.orders SET discount_amount=1 WHERE id='efb10000-0000-4000-8000-000000000031'; RAISE EXCEPTION 'Discount changed' USING ERRCODE='P1002'; EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_financial_edit_locked' THEN RAISE; END IF; END;
 BEGIN UPDATE public.orders SET total=101 WHERE id='efb10000-0000-4000-8000-000000000031'; RAISE EXCEPTION 'Total changed' USING ERRCODE='P1003'; EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_financial_edit_locked' THEN RAISE; END IF; END;
 BEGIN UPDATE public.order_items SET quantity=2 WHERE id='efb10000-0000-4000-8000-000000000061'; RAISE EXCEPTION 'Item changed' USING ERRCODE='P1004'; EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_financial_edit_locked' THEN RAISE; END IF; END;
 -- Authenticated has no item DELETE policy: RLS hides the row before the trigger.
 DELETE FROM public.order_items WHERE id='efb10000-0000-4000-8000-000000000061';
 IF FOUND THEN RAISE EXCEPTION 'Item deleted through RLS' USING ERRCODE='P1005'; END IF;
 BEGIN INSERT INTO public.order_items(order_id,name,price,quantity) VALUES('efb10000-0000-4000-8000-000000000031','Extra',1,1); RAISE EXCEPTION 'Item inserted' USING ERRCODE='P1006'; EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_financial_edit_locked' THEN RAISE; END IF; END;
 BEGIN UPDATE public.order_tax_subtotals SET tax_amount=1 WHERE id='efb10000-0000-4000-8000-000000000071'; RAISE EXCEPTION 'Tax updated' USING ERRCODE='P1007'; EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_financial_edit_locked' THEN RAISE; END IF; END;
 BEGIN DELETE FROM public.order_tax_subtotals WHERE id='efb10000-0000-4000-8000-000000000071'; RAISE EXCEPTION 'Tax deleted' USING ERRCODE='P1008'; EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_financial_edit_locked' THEN RAISE; END IF; END;
 BEGIN INSERT INTO public.order_tax_subtotals(order_id,vat_category_code,vat_rate,taxable_amount,tax_amount) VALUES('efb10000-0000-4000-8000-000000000031','S',7.5,100,7.5); RAISE EXCEPTION 'Tax changed' USING ERRCODE='P1009'; EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_financial_edit_locked' THEN RAISE; END IF; END;
END $$;
-- Exercise the DELETE trigger separately under the backend role, retaining the
-- bound merchant owner so the guard must return its exact financing error.
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN DELETE FROM public.order_items WHERE id='efb10000-0000-4000-8000-000000000061'; RAISE EXCEPTION 'Backend item deleted'; EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_financial_edit_locked' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
UPDATE public.order_tax_subtotals SET tax_amount=tax_amount WHERE id='efb10000-0000-4000-8000-000000000071';
UPDATE public.orders SET notes='Nonfinancial note' WHERE id='efb10000-0000-4000-8000-000000000031';
UPDATE public.order_items SET fulfillment_data='{"serial":"fixture"}' WHERE id='efb10000-0000-4000-8000-000000000061';
RESET ROLE;
-- Backoffice/fulfillment processes may still update operational fields with
-- no user JWT; financial changes remain blocked, even for a backend caller.
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
UPDATE public.orders SET notes='System fulfillment note' WHERE id='efb10000-0000-4000-8000-000000000031';
UPDATE public.order_items SET fulfillment_data='{"serial":"system"}',cost_price=40,supplier_name='Fixture supplier' WHERE id='efb10000-0000-4000-8000-000000000061';
UPDATE public.order_tax_subtotals SET tax_amount=tax_amount WHERE id='efb10000-0000-4000-8000-000000000071';
DO $$ BEGIN
 BEGIN UPDATE public.orders SET total=101 WHERE id='efb10000-0000-4000-8000-000000000031'; RAISE EXCEPTION 'System changed financed total'; EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'order_edit_forbidden' THEN RAISE; END IF; END;
 BEGIN UPDATE public.order_items SET price=101 WHERE id='efb10000-0000-4000-8000-000000000061'; RAISE EXCEPTION 'System changed financed item'; EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'order_edit_forbidden' THEN RAISE; END IF; END;
 BEGIN DELETE FROM public.order_items WHERE id='efb10000-0000-4000-8000-000000000061'; RAISE EXCEPTION 'System deleted financed item'; EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'order_edit_forbidden' THEN RAISE; END IF; END;
 BEGIN INSERT INTO public.order_items(order_id,name,price,quantity) VALUES('efb10000-0000-4000-8000-000000000031','System extra',1,1); RAISE EXCEPTION 'System inserted financed item'; EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'order_edit_forbidden' THEN RAISE; END IF; END;
 BEGIN INSERT INTO public.order_tax_subtotals(order_id,vat_category_code,vat_rate,taxable_amount,tax_amount) VALUES('efb10000-0000-4000-8000-000000000031','Z',0,1,0); RAISE EXCEPTION 'System inserted financed tax'; EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'order_edit_forbidden' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','efb10000-0000-4000-8000-000000000004',true);
UPDATE oxygen_private.provider_states SET state=jsonb_set(state,'{booking,status}','"ACTIVATED"') WHERE workflow_id='efb10000-0000-4000-8000-000000000041';
UPDATE public.oxygen_workflows SET stage='activated' WHERE id='efb10000-0000-4000-8000-000000000041';
UPDATE public.order_items SET fulfillment_data='{"serial":"activated"}' WHERE id='efb10000-0000-4000-8000-000000000061';
SELECT set_config('request.jwt.claim.sub','efb10000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN UPDATE public.orders SET discount_amount=2 WHERE id='efb10000-0000-4000-8000-000000000031'; RAISE EXCEPTION 'Activated amount changed'; EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_financial_edit_locked' THEN RAISE; END IF; END;
 IF (SELECT payment_status FROM public.orders WHERE id='efb10000-0000-4000-8000-000000000031') <> 'unpaid' THEN RAISE EXCEPTION 'Activation treated as settlement'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','efb10000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 BEGIN UPDATE public.orders SET discount_amount=3 WHERE id='efb10000-0000-4000-8000-000000000031'; RAISE EXCEPTION 'Staff changed financed amount'; EXCEPTION WHEN check_violation THEN IF SQLERRM <> 'oxygen_financial_edit_locked' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efb10000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN INSERT INTO public.order_items(order_id,name,price,quantity) VALUES('efb10000-0000-4000-8000-000000000031','Unauthorized',1,1); RAISE EXCEPTION 'Unauthorized insert succeeded'; EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM <> 'order_edit_forbidden' THEN RAISE; END IF; END;
END $$;
ROLLBACK;
