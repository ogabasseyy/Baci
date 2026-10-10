-- Isolated fixture only. Never execute this setup against an existing database.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.uid',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.role',true) $$;
CREATE FUNCTION public.check_staff_permission(uuid,uuid,text,text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='00000000-0000-4000-8000-000000000098' AND $4 IN ('view','edit') $$;
CREATE TABLE public.merchants(id uuid PRIMARY KEY,user_id uuid);
CREATE TABLE public.customer_wallet_transactions(source_id uuid,source_type text,merchant_id uuid,amount numeric);
CREATE TABLE public.customer_savings_redemptions(order_id uuid,merchant_id uuid,amount numeric,metadata jsonb);
CREATE TABLE public.orders(id uuid PRIMARY KEY,merchant_id uuid,amount_paid numeric,total numeric,currency text,shipping_status text,payment_status text,cancelled_at timestamptz,updated_at timestamptz);
CREATE TABLE public.transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid,order_id uuid,transaction_type text,amount numeric,currency text,status text,gateway text,gateway_reference text,description text,metadata jsonb,created_at timestamptz DEFAULT now());
CREATE TABLE public.order_cancellation_side_effects(order_id uuid,merchant_id uuid,step text,status text,claim_token uuid DEFAULT gen_random_uuid(),claimed_at timestamptz DEFAULT now(),completed_at timestamptz,attempts integer DEFAULT 0,result jsonb,error text,PRIMARY KEY(order_id,step));
\ir ../migrations/20261002090000_order_refund_management.sql
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
SELECT set_config('request.jwt.uid','00000000-0000-4000-8000-000000000098',false);
SELECT assert_refund((manage_order_refund('00000000-0000-4000-8000-000000000003')->>'status') IS NOT NULL,'edit-authorized staff can read refund status');
SELECT assert_refund(NOT (manage_order_refund('00000000-0000-4000-8000-000000000003')->>'canManageRefunds')::boolean,'staff without refund permission is flagged');
DO $$ BEGIN
  PERFORM manage_order_refund('00000000-0000-4000-8000-000000000003','manual',10,'2026-09-28','bank_transfer','staff-1');
  RAISE EXCEPTION 'edit-authorized staff recorded a manual refund';
EXCEPTION WHEN SQLSTATE '42501' THEN IF SQLERRM<>'refund_forbidden' THEN RAISE; END IF; END $$;
SELECT set_config('request.jwt.uid','00000000-0000-4000-8000-000000000002',false);
SELECT manage_order_refund('00000000-0000-4000-8000-000000000003','retry');
SELECT assert_refund((manage_order_refund('00000000-0000-4000-8000-000000000003')->>'status')='queued','retry requeues exhausted work');
UPDATE order_cancellation_side_effects SET status='claimed',claimed_at=now(),error=NULL;
DO $$ BEGIN
  PERFORM manage_order_refund('00000000-0000-4000-8000-000000000003','manual',80,'2026-09-28','bank_transfer','full-1');
  RAISE EXCEPTION 'manual write accepted during claimed refund';
EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'refund_processing_or_requires_review' THEN RAISE; END IF; END $$;
UPDATE order_cancellation_side_effects SET status='failed',error='Insufficient balance';
SELECT manage_order_refund('00000000-0000-4000-8000-000000000003','manual',80,'2026-09-28','bank_transfer','full-1');
SELECT assert_refund((SELECT payment_status='refunded' FROM orders),'full refund updates payment status');
SELECT assert_refund((SELECT sum(amount)=100 FROM transactions WHERE transaction_type='refund'),'ledger cannot exceed amount paid');
INSERT INTO orders VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001',100,100,'NGN','cancelled','paid',now(),now());
INSERT INTO transactions(id,merchant_id,order_id,transaction_type,amount,currency,status,gateway,gateway_reference) VALUES ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','payment',60,'NGN','completed','paystack','capture-11'),('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','payment',40,'NGN','completed','paystack','capture-12');
SELECT manage_order_refund('00000000-0000-4000-8000-000000000010','manual',100,'2026-09-28','bank_transfer','split-1');
SELECT assert_refund((SELECT count(*)=2 FROM transactions WHERE order_id='00000000-0000-4000-8000-000000000010' AND transaction_type='refund'),'one manual transfer spans both legs');
SELECT assert_refund((SELECT count(DISTINCT gateway_reference)=2 FROM transactions WHERE order_id='00000000-0000-4000-8000-000000000010' AND transaction_type='refund'),'each allocation row has a unique ledger identifier');
SELECT assert_refund((SELECT count(*)=2 FROM transactions WHERE order_id='00000000-0000-4000-8000-000000000010' AND transaction_type='refund' AND metadata->>'reference'='split-1'),'merchant reference stays queryable on every leg');
SELECT assert_refund((manage_order_refund('00000000-0000-4000-8000-000000000010')->>'remaining')::numeric=0,'split manual clears remaining');
SELECT manage_order_refund('00000000-0000-4000-8000-000000000010','manual',100,'2026-09-28','bank_transfer','split-1');
SELECT assert_refund((SELECT count(*)=2 FROM transactions WHERE order_id='00000000-0000-4000-8000-000000000010' AND transaction_type='refund'),'split manual replay is idempotent');
INSERT INTO orders VALUES ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000001',100,100,'NGN','cancelled','paid',now(),now());
INSERT INTO transactions(id,merchant_id,order_id,transaction_type,amount,currency,status,gateway,gateway_reference) VALUES ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000020','payment',100,'NGN','completed','paystack','capture-21');
INSERT INTO transactions(id,merchant_id,order_id,transaction_type,amount,currency,status,gateway,gateway_reference,metadata) VALUES ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000020','refund',30,'NGN','refunded','paystack','legacy-1',jsonb_build_object('payment_transaction_id','00000000-0000-4000-8000-000000000021'));
SELECT assert_refund((manage_order_refund('00000000-0000-4000-8000-000000000020')->>'refunded')::numeric=30,'legacy refunded rows count as returned');
SELECT assert_refund((manage_order_refund('00000000-0000-4000-8000-000000000020')->>'pending')::numeric=0,'legacy refunded rows are not pending');
SELECT assert_refund((manage_order_refund('00000000-0000-4000-8000-000000000020')->>'remaining')::numeric=70,'legacy refunded rows reduce remaining');
SELECT assert_refund((manage_order_refund('00000000-0000-4000-8000-000000000020')->>'canRecordManual')::boolean,'manual stays available beside legacy rows');
SELECT assert_refund((manage_order_refund('00000000-0000-4000-8000-000000000003')->>'canManageRefunds')::boolean,'owner can manage refunds');
INSERT INTO orders VALUES ('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000001',100,100,'NGN','cancelled','paid',now(),now());
INSERT INTO transactions(id,merchant_id,order_id,transaction_type,amount,currency,status,gateway,gateway_reference) VALUES ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000030','payment',100,'NGN','completed','paystack','capture-31');
INSERT INTO customer_wallet_transactions VALUES ('00000000-0000-4000-8000-000000000030','order_reversal','00000000-0000-4000-8000-000000000001',40);
INSERT INTO customer_savings_redemptions VALUES ('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000001',10,'{"reversed_at":"2026-10-01T00:00:00Z"}');
SELECT assert_refund((manage_order_refund('00000000-0000-4000-8000-000000000030')->>'reversedInternal')::numeric=50,'wallet and savings reversals are accounted');
SELECT assert_refund((manage_order_refund('00000000-0000-4000-8000-000000000030')->>'remaining')::numeric=50,'reversed internal money is not outstanding');
DO $$ BEGIN
  PERFORM manage_order_refund('00000000-0000-4000-8000-000000000030','manual',51,'2026-09-28','bank_transfer','over-after-reversal');
  RAISE EXCEPTION 'manual exceeded reversal-adjusted remaining';
EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'refund_exceeds_remaining' THEN RAISE; END IF; END $$;
SELECT manage_order_refund('00000000-0000-4000-8000-000000000030','manual',50,'2026-09-28','bank_transfer','reversal-adjusted');
SELECT assert_refund((SELECT payment_status='refunded' FROM orders WHERE id='00000000-0000-4000-8000-000000000030'),'reversal-adjusted manual completes the order');
INSERT INTO orders VALUES ('00000000-0000-4000-8000-000000000050','00000000-0000-4000-8000-000000000001',100,100,'NGN','cancelled','paid',now(),now());
INSERT INTO transactions(id,merchant_id,order_id,transaction_type,amount,currency,status,gateway,gateway_reference) VALUES ('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000050','payment',100,'NGN','completed','paystack','capture-51');
INSERT INTO customer_wallet_transactions VALUES ('00000000-0000-4000-8000-000000000050','order_reversal','00000000-0000-4000-8000-000000000001',40);
INSERT INTO transactions(id,merchant_id,order_id,transaction_type,amount,currency,status,gateway,gateway_reference,metadata) VALUES ('00000000-0000-4000-8000-000000000052','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000050','refund',60,'NGN','completed','paystack','777001',jsonb_build_object('payment_transaction_id','00000000-0000-4000-8000-000000000051'));
SELECT assert_refund((SELECT payment_status='refunded' FROM orders WHERE id='00000000-0000-4000-8000-000000000050'),'trigger counts reversals toward fully refunded');
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
SELECT assert_refund(NOT has_schema_privilege('authenticated','private','USAGE'),'private schema boundary preserved');
SELECT assert_refund(NOT has_function_privilege('authenticated','private.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text)','EXECUTE'),'direct private refund RPC denied');
SELECT 'authenticated refund access tests passed';
-- Authenticated refund inserts stay behind the RPC: recreate the baseline
-- insert boundary, apply the restriction, and prove the split.
CREATE FUNCTION public.has_merchant_access(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY transactions_insert_policy ON public.transactions FOR INSERT TO authenticated WITH CHECK (public.has_merchant_access(merchant_id) AND (order_id IS NULL OR EXISTS (SELECT 1 FROM public.orders AS o WHERE o.id=transactions.order_id AND o.merchant_id=transactions.merchant_id)));
CREATE POLICY transactions_select_policy ON public.transactions FOR SELECT TO authenticated USING (true);
GRANT INSERT, SELECT ON public.transactions TO authenticated;
GRANT SELECT ON public.orders TO authenticated;
INSERT INTO public.merchants VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000099');
INSERT INTO public.orders VALUES ('00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000002',10,0,'NGN','pending','unpaid',now(),now());
\ir ../migrations/20261010120000_restrict_authenticated_refund_inserts.sql
SET ROLE authenticated;
DO $$ BEGIN
  INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,status,gateway) VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','refund',10,'NGN','completed','manual');
  RAISE EXCEPTION 'authenticated refund insert allowed';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,status,gateway) VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','payment',10,'NGN','completed','paystack');
SELECT assert_refund((SELECT count(*)=1 FROM public.transactions WHERE transaction_type='payment' AND amount=10),'authenticated non-refund inserts still allowed');
DO $$ BEGIN
  INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,status,gateway) VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000040','payment',10,'NGN','completed','paystack');
  RAISE EXCEPTION 'cross-merchant order linkage allowed';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
SELECT 'refund insert policy tests passed';
