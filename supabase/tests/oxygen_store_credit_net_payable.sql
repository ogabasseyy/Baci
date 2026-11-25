-- Rollback-only SQL regression coverage for Oxygen store credit + net payable invariants.
BEGIN;
SELECT pg_catalog.set_config('app.audit_actor_user_id','ec310000-0000-4000-8000-000000000001',true);
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
VALUES
 ('ec310000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000000','authenticated','authenticated','oxygen-net-customer@example.test','test',now(),now(),now(),'{}','{}'),
 ('ec310000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000000','authenticated','authenticated','oxygen-net-worker@example.test','test',now(),now(),now(),'{}','{}');
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000001','oxygen-net@example.test','Oxygen Net Merchant','oxygen-net-merchant');
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'merchant_feature_settings'
      AND column_name = 'oxygen_enabled'
  ) THEN
    EXECUTE $sql$
      INSERT INTO public.merchant_feature_settings (merchant_id, oxygen_enabled)
      VALUES ('ec310000-0000-4000-8000-000000000003', true)
      ON CONFLICT (merchant_id) DO UPDATE SET oxygen_enabled = true
    $sql$;
  END IF;
END $$;
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email,phone)
VALUES ('ec310000-0000-4000-8000-000000000004','ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000001','Net','Customer','oxygen-net-customer@example.test','08012345678');
INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id)
VALUES ('net-payable-fixture','ec310000-0000-4000-8000-000000000002');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,merchant_reference,environment,enabled)
VALUES ('ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000002','net-payable-fixture','ec310000-0000-4000-8000-000000000091','staging',true);

-- Order total 50,000 with 15,000 pre-gateway store credit -> net payable 35,000.
-- Order total 50,000 with 50,000 pre-gateway store credit -> net payable 0.
-- Ledger-only orders with amount_paid = 0, wallet_amount_used = 0 while wallet/savings ledger rows exist.
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,subtotal,total,currency,payment_status,payment_method,shipping_fee,discount_amount,amount_paid,wallet_amount_used)
VALUES
 ('ec310000-0000-4000-8000-000000000010','ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000004','OXY-PARTIAL',50000,50000,'NGN','unpaid','oxygen',0,0,15000,15000),
 ('ec310000-0000-4000-8000-000000000011','ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000004','OXY-ZERO',50000,50000,'NGN','unpaid','oxygen',0,0,50000,50000),
 ('ec310000-0000-4000-8000-000000000012','ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000004','OXY-LEDGER-PARTIAL',50000,50000,'NGN','unpaid','oxygen',0,0,0,0),
 ('ec310000-0000-4000-8000-000000000013','ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000004','OXY-LEDGER-ZERO',50000,50000,'NGN','unpaid','oxygen',0,0,0,0);

DO $ledger$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_wallet_transactions'
      AND column_name = 'wallet_id'
  ) THEN
    INSERT INTO public.customer_wallets(id,customer_id,merchant_id,available_balance)
    VALUES ('ec310000-0000-4000-8000-000000000030','ec310000-0000-4000-8000-000000000004','ec310000-0000-4000-8000-000000000003',0);

    INSERT INTO public.products(id,merchant_id,name,price,status)
    VALUES ('ec310000-0000-4000-8000-000000000031','ec310000-0000-4000-8000-000000000003','Oxygen Test Phone',50000,'active');

    INSERT INTO public.order_items(order_id,product_id,name,price,quantity)
    VALUES
      ('ec310000-0000-4000-8000-000000000012','ec310000-0000-4000-8000-000000000031','Oxygen Test Phone',50000,1),
      ('ec310000-0000-4000-8000-000000000013','ec310000-0000-4000-8000-000000000031','Oxygen Test Phone',50000,1);

    INSERT INTO public.customer_savings_goals(
      id,merchant_id,customer_id,product_id,title,target_amount,current_amount,contribution_amount,
      contribution_frequency,start_date,maturity_date,source_mode,status,completed_at,
      terms_accepted_at,non_withdrawable_accepted_at
    ) VALUES
      ('ec310000-0000-4000-8000-000000000032','ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000004','ec310000-0000-4000-8000-000000000031','Goal Partial',5000,5000,1000,'daily',current_date,current_date,'manual','completed',now(),now(),now()),
      ('ec310000-0000-4000-8000-000000000033','ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000004','ec310000-0000-4000-8000-000000000031','Goal Full',15000,15000,1000,'daily',current_date,current_date,'manual','completed',now(),now(),now());

    INSERT INTO public.customer_wallet_transactions(wallet_id,customer_id,merchant_id,type,amount,balance_after,source_type,source_id)
    VALUES
      ('ec310000-0000-4000-8000-000000000030','ec310000-0000-4000-8000-000000000004','ec310000-0000-4000-8000-000000000003','redemption',10000,0,'order_redemption','ec310000-0000-4000-8000-000000000012'),
      ('ec310000-0000-4000-8000-000000000030','ec310000-0000-4000-8000-000000000004','ec310000-0000-4000-8000-000000000003','redemption',35000,0,'order_redemption','ec310000-0000-4000-8000-000000000013');

    INSERT INTO public.customer_savings_redemptions(goal_id,merchant_id,customer_id,order_id,amount,idempotency_key)
    VALUES
      ('ec310000-0000-4000-8000-000000000032','ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000004','ec310000-0000-4000-8000-000000000012',5000,'oxy-ledger-partial'),
      ('ec310000-0000-4000-8000-000000000033','ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000004','ec310000-0000-4000-8000-000000000013',15000,'oxy-ledger-zero');
  ELSE
    INSERT INTO public.customer_wallet_transactions(source_id,source_type,type,amount)
    VALUES
      ('ec310000-0000-4000-8000-000000000012','order_redemption','redemption',10000),
      ('ec310000-0000-4000-8000-000000000013','order_redemption','redemption',35000);

    INSERT INTO public.customer_savings_redemptions(order_id,amount)
    VALUES
      ('ec310000-0000-4000-8000-000000000012',5000),
      ('ec310000-0000-4000-8000-000000000013',15000);
  END IF;
END $ledger$;

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
  IF (v_claim->'context'->>'productAmount')::numeric IS DISTINCT FROM 35000 THEN
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

  -- Ledger-only 100%-covered order (amount_paid=0, wallet_amount_used=0) cannot start Oxygen workflow.
  PERFORM pg_catalog.set_config('request.jwt.claim.sub','ec310000-0000-4000-8000-000000000001',true);
  BEGIN
    PERFORM public.oxygen_start_workflow('ec310000-0000-4000-8000-000000000013', 'web');
    RAISE EXCEPTION 'Ledger-covered zero-net-payable order started Oxygen workflow';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'Order unavailable' THEN RAISE; END IF;
  END;

  -- Ledger-only partial credit (10,000 wallet + 5,000 savings; orders columns still 0) enforces net 35,000.
  v_wf := public.oxygen_start_workflow('ec310000-0000-4000-8000-000000000012', 'web');
  v_wf_id := (v_wf->>'id')::uuid;
  v_cmd := public.oxygen_runtime('enqueue', v_wf_id, jsonb_build_object(
    'idempotencyKey', 'ec310000-0000-4000-8000-000000000021',
    'version', (v_wf->>'version')::integer,
    'command', jsonb_build_object('action', 'start_application')
  ));
  PERFORM pg_catalog.set_config('request.jwt.claim.sub','ec310000-0000-4000-8000-000000000002',true);
  v_claim := public.oxygen_runtime('claim', (v_cmd->>'commandId')::uuid, jsonb_build_object('commandId', v_cmd->>'commandId'));
  IF (v_claim->'context'->>'productAmount')::numeric IS DISTINCT FROM 35000 THEN
    RAISE EXCEPTION 'Expected ledger-reduced productAmount 35000, got %', v_claim->'context'->>'productAmount';
  END IF;

  -- Settled orders ('paid' / 'bnpl_approved') with amount_paid = total must not treat settled payment as store credit.
  RESET ROLE;
  INSERT INTO public.orders(id,merchant_id,customer_id,order_number,subtotal,total,currency,payment_status,payment_method,shipping_fee,discount_amount,amount_paid,wallet_amount_used)
  VALUES
   ('ec310000-0000-4000-8000-000000000014','ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000004','OXY-PAID',50000,50000,'NGN','paid','oxygen',0,0,50000,0),
   ('ec310000-0000-4000-8000-000000000015','ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000004','OXY-APPROVED-WALLET',50000,50000,'NGN','bnpl_approved','oxygen',0,0,50000,15000);

  IF oxygen_private.order_net_payable_for_order('ec310000-0000-4000-8000-000000000014', 50000, 50000, 0, 'paid') IS DISTINCT FROM 50000 THEN
    RAISE EXCEPTION 'Expected paid order net payable 50000, got %', oxygen_private.order_net_payable_for_order('ec310000-0000-4000-8000-000000000014', 50000, 50000, 0, 'paid');
  END IF;

  IF oxygen_private.order_net_payable_for_order('ec310000-0000-4000-8000-000000000015', 50000, 50000, 15000, 'bnpl_approved') IS DISTINCT FROM 35000 THEN
    RAISE EXCEPTION 'Expected bnpl_approved order net payable 35000, got %', oxygen_private.order_net_payable_for_order('ec310000-0000-4000-8000-000000000015', 50000, 50000, 15000, 'bnpl_approved');
  END IF;

  -- Pending pre-gateway order with partial amount_paid subtracts pre-gateway store credit consistently with TS.
  IF oxygen_private.order_net_payable_for_order('ec310000-0000-4000-8000-000000000014', 50000, 15000, 0, 'pending') IS DISTINCT FROM 35000 THEN
    RAISE EXCEPTION 'Expected pending order net payable 35000, got %', oxygen_private.order_net_payable_for_order('ec310000-0000-4000-8000-000000000014', 50000, 15000, 0, 'pending');
  END IF;

  -- Reversed wallet redemptions, non-completed wallet rows, and reversed savings rows do not reduce net payable.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_wallet_transactions'
      AND column_name = 'wallet_id'
  ) THEN
    INSERT INTO public.orders(id,merchant_id,customer_id,order_number,subtotal,total,currency,payment_status,payment_method,shipping_fee,discount_amount,amount_paid,wallet_amount_used)
    VALUES ('ec310000-0000-4000-8000-000000000016','ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000004','OXY-REVERSED',50000,50000,'NGN','unpaid','oxygen',0,0,20000,20000);

    INSERT INTO public.customer_wallet_transactions(wallet_id,customer_id,merchant_id,type,status,amount,balance_after,source_type,source_id)
    VALUES
      ('ec310000-0000-4000-8000-000000000030','ec310000-0000-4000-8000-000000000004','ec310000-0000-4000-8000-000000000003','redemption','completed',20000,0,'order_redemption','ec310000-0000-4000-8000-000000000016'),
      ('ec310000-0000-4000-8000-000000000030','ec310000-0000-4000-8000-000000000004','ec310000-0000-4000-8000-000000000003','redemption','pending',10000,0,'order_redemption','ec310000-0000-4000-8000-000000000016'),
      ('ec310000-0000-4000-8000-000000000030','ec310000-0000-4000-8000-000000000004','ec310000-0000-4000-8000-000000000003','credit','completed',20000,20000,'order_reversal','ec310000-0000-4000-8000-000000000016'),
      ('ec310000-0000-4000-8000-000000000030','ec310000-0000-4000-8000-000000000004','ec310000-0000-4000-8000-000000000003','credit','pending',10000,0,'order_reversal','ec310000-0000-4000-8000-000000000012');

    INSERT INTO public.customer_savings_goals(
      id,merchant_id,customer_id,product_id,title,target_amount,current_amount,contribution_amount,
      contribution_frequency,start_date,maturity_date,source_mode,status,completed_at,
      terms_accepted_at,non_withdrawable_accepted_at
    ) VALUES
      ('ec310000-0000-4000-8000-000000000034','ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000004','ec310000-0000-4000-8000-000000000031','Goal Reversed',15000,15000,1000,'daily',current_date,current_date,'manual','completed',now(),now(),now());

    INSERT INTO public.customer_savings_redemptions(goal_id,merchant_id,customer_id,order_id,amount,idempotency_key,metadata)
    VALUES
      ('ec310000-0000-4000-8000-000000000034','ec310000-0000-4000-8000-000000000003','ec310000-0000-4000-8000-000000000004','ec310000-0000-4000-8000-000000000016',15000,'oxy-ledger-reversed','{"reversed_at":"2026-11-25T10:00:00Z"}'::jsonb);

    IF oxygen_private.order_net_payable_for_order('ec310000-0000-4000-8000-000000000016', 50000, 20000, 20000, 'unpaid') IS DISTINCT FROM 50000 THEN
      RAISE EXCEPTION 'Expected reversed ledger order net payable 50000 despite stale columns, got %', oxygen_private.order_net_payable_for_order('ec310000-0000-4000-8000-000000000016', 50000, 20000, 20000, 'unpaid');
    END IF;
    IF oxygen_private.order_net_payable_for_order('ec310000-0000-4000-8000-000000000012', 50000, 0, 0, 'unpaid') IS DISTINCT FROM 35000 THEN
      RAISE EXCEPTION 'Expected pending reversal not to reduce credit on order 12, got %', oxygen_private.order_net_payable_for_order('ec310000-0000-4000-8000-000000000012', 50000, 0, 0, 'unpaid');
    END IF;

    -- Status-only wallet transitions and metadata-only savings reversals are blocked once an Oxygen workflow exists on order 12.
    BEGIN
      UPDATE public.customer_wallet_transactions
         SET status = 'completed'
       WHERE source_id = 'ec310000-0000-4000-8000-000000000012'
         AND source_type = 'order_reversal'
         AND status = 'pending';
      RAISE EXCEPTION 'Post-workflow wallet status update bypassed freeze guard';
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM <> 'oxygen_local_credit_in_use' THEN RAISE; END IF;
    END;

    BEGIN
      UPDATE public.customer_savings_redemptions
         SET metadata = '{"reversed_at":"2026-11-25T12:00:00Z"}'::jsonb
       WHERE order_id = 'ec310000-0000-4000-8000-000000000012';
      RAISE EXCEPTION 'Post-workflow savings metadata reversal bypassed freeze guard';
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM <> 'oxygen_local_credit_in_use' THEN RAISE; END IF;
    END;
  END IF;
END $test$;
RESET ROLE;
ROLLBACK;
