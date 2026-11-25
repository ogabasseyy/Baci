-- Rollback-only SQL regression coverage for Oxygen store credit + net payable invariants.
BEGIN;
SELECT pg_catalog.set_config('app.audit_actor_user_id','ec310000-0000-4000-8000-000000000001',true);
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
VALUES
 ('ec310000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000000','authenticated','authenticated','oxygen-net-customer@example.test','test',now(),now(),now(),'{}','{}'),
 ('ec310000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000000','authenticated','authenticated','oxygen-net-worker@example.test','test',now(),now(),now(),'{}','{}');
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000001','oxygen-net@example.test','Oxygen Net Merchant','oxygen-net-merchant');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email,phone)
VALUES ('ec310000-0000-4000-8000-000000000004','ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000001','Net','Customer','oxygen-net-customer@example.test','08012345678');
INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id)
VALUES ('net-payable-fixture','ec310000-0000-4000-8000-000000000002');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,merchant_reference,environment,enabled)
VALUES ('ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000002','net-payable-fixture','ec310000-0000-4000-8000-000000000091','staging',true);

-- Order total 50,000 with 15,000 pre-gateway store credit -> net payable 35,000.
-- Order total 50,000 with 50,000 pre-gateway store credit -> net payable 0.
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,subtotal,total,currency,payment_status,payment_method,shipping_fee,discount_amount,amount_paid,wallet_amount_used)
VALUES
 ('ec310000-0000-4000-8000-000000000010','ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000004','OXY-PARTIAL',50000,50000,'NGN','unpaid','oxygen',0,0,15000,15000),
 ('ec310000-0000-4000-8000-000000000011','ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000004','OXY-ZERO',50000,50000,'NGN','unpaid','oxygen',0,0,50000,50000);

SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  v_wf jsonb;
  v_wf_id uuid;
  v_cmd jsonb;
  v_claim jsonb;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub','ec310000-0000-4000-8000-000000000001',true);

  -- 100%-covered order cannot start an Oxygen workflow.
  BEGIN
    PERFORM public.oxygen_start_workflow('ec310000-0000-4000-8000-000000000011', 'web');
    RAISE EXCEPTION 'Zero-net-payable order started Oxygen workflow';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'Order unavailable' THEN RAISE; END IF;
  END;

  -- Partial-credit order starts an Oxygen workflow and passes 35000 (not 50000) as productAmount.
  v_wf := public.oxygen_start_workflow('ec310000-0000-4000-8000-000000000010', 'mobile');
  v_wf_id := (v_wf->>'id')::uuid;

  v_cmd := public.oxygen_runtime('enqueue', v_wf_id, jsonb_build_object(
    'idempotencyKey', 'ec310000-0000-4000-8000-000000000020',
    'version', (v_wf->>'version')::integer,
    'command', jsonb_build_object('action', 'start_application')
  ));

  PERFORM pg_catalog.set_config('request.jwt.claim.sub','ec310000-0000-4000-8000-000000000002',true);
  v_claim := public.oxygen_runtime('claim', (v_cmd->>'commandId')::uuid, jsonb_build_object('commandId', v_cmd->>'commandId'));
  IF (v_claim->'context'->>'productAmount')::numeric <> 35000 THEN
    RAISE EXCEPTION 'Expected net productAmount 35000, got %', v_claim->'context'->>'productAmount';
  END IF;

  -- Reject stale booking state claiming pre-credit 50000 instead of net 35000.
  BEGIN
    PERFORM public.oxygen_runtime('finish', (v_cmd->>'commandId')::uuid, jsonb_build_object(
      'commandId', v_cmd->>'commandId',
      'outcome', 'succeeded',
      'stage', 'eligibility_required',
      'state', jsonb_build_object(
        'booking', jsonb_build_object('product_amount', 50000)
      )
    ));
    RAISE EXCEPTION 'Pre-credit booking product_amount 50000 was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'Order amount changed' THEN RAISE; END IF;
  END;
END $test$;
RESET ROLE;
ROLLBACK;
