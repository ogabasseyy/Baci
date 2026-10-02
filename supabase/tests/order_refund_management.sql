-- Isolated fixture only. Never execute this setup against an existing database.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.uid',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.role',true) $$;
CREATE FUNCTION public.check_staff_permission(uuid,uuid,text,text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE TABLE public.merchants(id uuid PRIMARY KEY,user_id uuid);
CREATE TABLE public.orders(id uuid PRIMARY KEY,merchant_id uuid,amount_paid numeric,total numeric,currency text,shipping_status text,payment_status text,cancelled_at timestamptz,updated_at timestamptz);
CREATE TABLE public.transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid,order_id uuid,transaction_type text,amount numeric,currency text,status text,gateway text,gateway_reference text,description text,metadata jsonb,created_at timestamptz DEFAULT now());
CREATE TABLE public.order_cancellation_side_effects(order_id uuid,merchant_id uuid,step text,status text,claim_token uuid DEFAULT gen_random_uuid(),claimed_at timestamptz DEFAULT now(),completed_at timestamptz,attempts integer DEFAULT 0,result jsonb,error text,PRIMARY KEY(order_id,step));
\ir ../migrations/20261002090000_order_refund_management.sql
\ir ../migrations/20261002090100_partial_cancellation_refund_claims.sql
CREATE FUNCTION public.assert_refund(p_ok boolean,p_message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %',p_message; END IF; END $$;
INSERT INTO merchants VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
INSERT INTO orders VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001',100,100,'NGN','cancelled','paid',now(),now());
INSERT INTO transactions(id,merchant_id,order_id,transaction_type,amount,currency,status,gateway,gateway_reference) VALUES ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','payment',100,'NGN','completed','paystack','capture-1');
INSERT INTO order_cancellation_side_effects(order_id,merchant_id,step,status,attempts,error) VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','refund','failed',5,'Insufficient balance');
SELECT set_config('request.jwt.uid','00000000-0000-4000-8000-000000000002',false);
SELECT assert_refund((manage_order_refund('00000000-0000-4000-8000-000000000003')->>'canRetry')::boolean,'failed refund is retryable');
DO $$ BEGIN
  PERFORM manage_order_refund('00000000-0000-4000-8000-000000000003','manual',101,'2026-09-28','bank_transfer','excess');
  RAISE EXCEPTION 'excess refund accepted';
EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'refund_exceeds_remaining' THEN RAISE; END IF; END $$;
SELECT manage_order_refund('00000000-0000-4000-8000-000000000003','manual',20,'2026-09-28','bank_transfer','partial-1');
SELECT assert_refund((manage_order_refund('00000000-0000-4000-8000-000000000003')->>'remaining')::numeric=80,'partial refunds reduce remaining');
SELECT manage_order_refund('00000000-0000-4000-8000-000000000003','manual',20,'2026-09-28','bank_transfer','partial-1');
SELECT assert_refund((SELECT count(*)=1 FROM transactions WHERE transaction_type='refund'),'manual replay is idempotent');
SELECT set_config('request.jwt.uid','00000000-0000-4000-8000-000000000099',false);
DO $$ BEGIN
  PERFORM manage_order_refund('00000000-0000-4000-8000-000000000003','retry');
  RAISE EXCEPTION 'cross merchant retry accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SELECT set_config('request.jwt.uid','00000000-0000-4000-8000-000000000002',false);
SELECT manage_order_refund('00000000-0000-4000-8000-000000000003','retry');
SELECT assert_refund((manage_order_refund('00000000-0000-4000-8000-000000000003')->>'status')='queued','retry requeues exhausted work');
SELECT set_config('request.jwt.role','service_role',false);
SELECT assert_refund((SELECT we_won FROM claim_order_cancellation_side_effect('00000000-0000-4000-8000-000000000003','refund','00000000-0000-4000-8000-000000000005')),'partial refund does not suppress remaining refund');
DO $$ BEGIN
  PERFORM manage_order_refund('00000000-0000-4000-8000-000000000003','manual',80,'2026-09-28','bank_transfer','full-1');
  RAISE EXCEPTION 'manual write accepted during claimed refund';
EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'refund_processing_or_requires_review' THEN RAISE; END IF; END $$;
UPDATE order_cancellation_side_effects SET status='failed',error='Insufficient balance';
SELECT manage_order_refund('00000000-0000-4000-8000-000000000003','manual',80,'2026-09-28','bank_transfer','full-1');
SELECT assert_refund((SELECT payment_status='refunded' FROM orders),'full refund updates payment status');
SELECT assert_refund(NOT (SELECT we_won FROM claim_order_cancellation_side_effect('00000000-0000-4000-8000-000000000003','refund','00000000-0000-4000-8000-000000000006')),'full manual refund prevents worker replay');
SELECT assert_refund((SELECT sum(amount)=100 FROM transactions WHERE transaction_type='refund'),'ledger cannot exceed amount paid');
SELECT assert_refund(NOT has_function_privilege('anon','public.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text)','EXECUTE'),'anonymous callers denied');
SELECT 'refund integration tests passed';
-- RPC authority is available to authenticated owners without granting ledger writes.
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON public.merchants TO authenticated;
SET ROLE authenticated;
SELECT assert_refund((manage_order_refund('00000000-0000-4000-8000-000000000003')->>'status')='refunded','authenticated RPC works without table write privileges');
DO $$ BEGIN
  INSERT INTO public.order_refund_events(order_id,merchant_id,action)
    VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','forged');
  RAISE EXCEPTION 'direct audit write allowed';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SELECT assert_refund((SELECT count(*)>0 FROM public.order_refund_events),'owner sees refund audit events');
SELECT set_config('request.jwt.uid','00000000-0000-4000-8000-000000000099',false);
SELECT assert_refund((SELECT count(*)=0 FROM public.order_refund_events),'refund audit RLS blocks other merchants');
RESET ROLE;
SELECT 'authenticated refund access tests passed';
