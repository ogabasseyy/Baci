BEGIN;
SET LOCAL TRANSACTION ISOLATION LEVEL READ COMMITTED;

CREATE FUNCTION pg_temp.assert_true(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;

INSERT INTO auth.users(id) VALUES ('94000000-0000-4000-8000-000000000003');
INSERT INTO public.merchants(id,email,business_name,slug) VALUES
  ('94000000-0000-4000-8000-000000000001','interest-completion@example.com','Interest completion','interest-completion');
INSERT INTO public.customers(id,merchant_id,user_id,email,first_name) VALUES
  ('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001',
   '94000000-0000-4000-8000-000000000003','interest-customer@example.com','Interest');
INSERT INTO public.products(id,merchant_id,name,price,status,stock_quantity) VALUES
  ('94000000-0000-4000-8000-000000000008','94000000-0000-4000-8000-000000000001','Interest device',200,'active',3);
INSERT INTO public.customer_savings_goals
  (id,merchant_id,customer_id,product_id,title,status,source_mode,target_amount,current_amount,
   contribution_amount,contribution_frequency,start_date,maturity_date,terms_accepted_at,non_withdrawable_accepted_at)
SELECT goal_id,'94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002',
  '94000000-0000-4000-8000-000000000008','Interest goal','active','manual',200,100,
  10,'daily',current_date,current_date+30,now(),now()
FROM unnest(ARRAY['94000000-0000-4000-8000-000000000004'::uuid,
  '94000000-0000-4000-8000-000000000005'::uuid,'94000000-0000-4000-8000-000000000009'::uuid]) goal_id;
INSERT INTO piggyvest_staging.integrations(id,expected_provider_account_id,enabled) VALUES
  ('94000000-0000-4000-8000-000000000006','interest-completion-provider',true);
INSERT INTO piggyvest_savings_ledger.bindings
  (goal_id,integration_id,merchant_id,customer_id,authorized_login,enabled)
SELECT id,'94000000-0000-4000-8000-000000000006',merchant_id,customer_id,session_user,true
FROM public.customer_savings_goals WHERE merchant_id='94000000-0000-4000-8000-000000000001';
INSERT INTO piggyvest_staging.wallet_goal_mappings
  (integration_id,provider_wallet_id,provider_customer_id,merchant_id,customer_id,goal_id) VALUES
  ('94000000-0000-4000-8000-000000000006','interest-transfer-wallet','interest-provider-customer',
   '94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002',
   '94000000-0000-4000-8000-000000000009');
INSERT INTO public.customer_wallets(merchant_id,customer_id,available_balance) VALUES
  ('94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002',1000);
SELECT set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

CREATE FUNCTION pg_temp.interest_command(p_operation uuid, p_kind text, p_amount bigint, p_reference uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('operationId',p_operation,'kind',p_kind,'principalKobo',0,
    'interestKobo',p_amount,'evidenceId','interest-completion:'||p_operation,'referenceId',p_reference);
$$;
CREATE FUNCTION pg_temp.apply_interest(p_goal uuid, p_command jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT piggyvest_savings_ledger.apply('94000000-0000-4000-8000-000000000006',
    '94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002',p_goal,p_command);
$$;

SELECT pg_temp.apply_interest('94000000-0000-4000-8000-000000000004',
  pg_temp.interest_command('94000000-0000-4000-8000-000000000010','record_pending_interest',50000));
SELECT pg_temp.assert_true((SELECT status='active' AND current_amount=100 AND completed_at IS NULL
  FROM public.customer_savings_goals WHERE id='94000000-0000-4000-8000-000000000004'),
  'Pending interest never completes or changes principal');
SELECT pg_temp.apply_interest('94000000-0000-4000-8000-000000000004',
  pg_temp.interest_command('94000000-0000-4000-8000-000000000011','credit_eligible_paid_interest',10000));
SELECT pg_temp.assert_true((SELECT status='completed' AND current_amount=100 AND completed_at IS NOT NULL
  FROM public.customer_savings_goals WHERE id='94000000-0000-4000-8000-000000000004'),
  'Paid interest reaches the target and canonically completes without becoming principal');
CREATE TEMP TABLE interest_completion_stamp AS SELECT completed_at FROM public.customer_savings_goals
  WHERE id='94000000-0000-4000-8000-000000000004';
SELECT pg_temp.apply_interest('94000000-0000-4000-8000-000000000004',
  pg_temp.interest_command('94000000-0000-4000-8000-000000000011','credit_eligible_paid_interest',10000));
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM piggyvest_savings_ledger.operations
  WHERE id='94000000-0000-4000-8000-000000000011'), 'Interest replay records one operation');
SELECT pg_temp.assert_true((SELECT sum(amount_kobo)=10000 FROM piggyvest_savings_ledger.postings
  WHERE operation_id='94000000-0000-4000-8000-000000000011' AND account='paid_interest'),
  'Interest replay cannot double credit');
SELECT pg_temp.assert_true((SELECT goal.completed_at=stamp.completed_at
  FROM public.customer_savings_goals goal CROSS JOIN interest_completion_stamp stamp
  WHERE goal.id='94000000-0000-4000-8000-000000000004'), 'Replay preserves completion timestamp');

DO $$
BEGIN
  BEGIN
    PERFORM public.allocate_customer_savings_contribution('94000000-0000-4000-8000-000000000004',
      '94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001',1,
      'wallet',NULL,'interest-completed-refusal',NULL);
    RAISE EXCEPTION 'completed goal accepted funding' USING ERRCODE='XX000';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'savings_goal_not_allocatable' THEN RAISE; END IF;
  END;
END $$;

SELECT pg_temp.apply_interest('94000000-0000-4000-8000-000000000005',
  pg_temp.interest_command('94000000-0000-4000-8000-000000000012','credit_eligible_paid_interest',7000));
SELECT pg_temp.assert_true((SELECT status='active' AND current_amount=100 FROM public.customer_savings_goals
  WHERE id='94000000-0000-4000-8000-000000000005'), 'Partial interest preserves principal and active status');
DO $$
BEGIN
  BEGIN
    PERFORM public.allocate_customer_savings_contribution('94000000-0000-4000-8000-000000000005',
      '94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001',30.01,
      'wallet',NULL,'interest-partial-excess',NULL);
    RAISE EXCEPTION 'partial interest allowed overfunding' USING ERRCODE='XX000';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'savings_contribution_exceeds_remaining_target' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.customer_savings_goals SET current_amount=130.01
      WHERE id='94000000-0000-4000-8000-000000000005';
    RAISE EXCEPTION 'direct projection bypassed remaining capacity' USING ERRCODE='XX000';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'savings_contribution_exceeds_remaining_target' THEN RAISE; END IF;
  END;
END $$;
CREATE TEMP TABLE interest_wallet_receipt AS
SELECT * FROM public.allocate_customer_savings_contribution('94000000-0000-4000-8000-000000000005',
  '94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001',30,
  'wallet',NULL,'interest-partial-exact',NULL);
SELECT pg_temp.assert_true((SELECT success AND goal_current_amount=130 AND goal_status='completed'
  FROM interest_wallet_receipt), 'Wallet RPC returns canonical completion at principal plus paid interest');
SELECT pg_temp.assert_true((SELECT current_amount=130 AND status='completed'
  FROM public.customer_savings_goals WHERE id='94000000-0000-4000-8000-000000000005'),
  'Exact remaining funding adds principal once');
SELECT pg_temp.assert_true((SELECT replay.contribution_id=receipt.contribution_id AND replay.goal_status='completed'
  FROM public.allocate_customer_savings_contribution('94000000-0000-4000-8000-000000000005',
    '94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001',30,
    'wallet',NULL,'interest-partial-exact',NULL) replay CROSS JOIN interest_wallet_receipt receipt),
  'Funding replay succeeds after completion without creating a new contribution');
SELECT pg_temp.assert_true((SELECT available_balance=970 FROM public.customer_wallets
  WHERE customer_id='94000000-0000-4000-8000-000000000002'), 'Rejected funding and replay never debit the wallet');

SELECT pg_temp.apply_interest('94000000-0000-4000-8000-000000000009',
  pg_temp.interest_command('94000000-0000-4000-8000-000000000013','credit_eligible_paid_interest',7000));
SET LOCAL ROLE service_role;
DO $$
BEGIN
  BEGIN
    PERFORM public.allocate_plan_transfer_contribution('94000000-0000-4000-8000-000000000002',
      '94000000-0000-4000-8000-000000000001',3001,'interest-excess-transfer','interest-excess-transfer',
      'interest-transfer-wallet','interest-provider-customer');
    RAISE EXCEPTION 'transfer ignored partial interest' USING ERRCODE='XX000';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'plan transfer exceeds remaining goal amount; reconciliation required' THEN RAISE; END IF;
  END;
END $$;
SELECT pg_temp.assert_true((SELECT success AND projected_amount=30 AND goal_current_amount=130 AND goal_status='completed'
  FROM public.allocate_plan_transfer_contribution('94000000-0000-4000-8000-000000000002',
    '94000000-0000-4000-8000-000000000001',3000,'interest-exact-transfer','interest-exact-transfer',
    'interest-transfer-wallet','interest-provider-customer')), 'Transfer uses net paid interest in remaining capacity');
SELECT pg_temp.assert_true((SELECT success AND outcome='replayed' AND projected_amount=30 AND goal_status='completed'
  FROM public.allocate_plan_transfer_contribution('94000000-0000-4000-8000-000000000002',
    '94000000-0000-4000-8000-000000000001',3000,'interest-exact-transfer','interest-exact-transfer',
    'interest-transfer-wallet','interest-provider-customer')), 'Transfer replay remains idempotent after completion');
SELECT pg_temp.assert_true((SELECT NOT success AND outcome='mapped_goal_unallocatable'
  FROM public.allocate_plan_transfer_contribution('94000000-0000-4000-8000-000000000002',
    '94000000-0000-4000-8000-000000000001',1,'interest-after-transfer','interest-after-transfer',
    'interest-transfer-wallet','interest-provider-customer')), 'Completed mapped goal refuses a subsequent transfer');
RESET ROLE;

SELECT pg_temp.apply_interest('94000000-0000-4000-8000-000000000004',
  pg_temp.interest_command('94000000-0000-4000-8000-000000000014','reverse_credit',0,
    '94000000-0000-4000-8000-000000000011'));
SELECT pg_temp.assert_true((SELECT status='paused' AND completed_at IS NULL AND current_amount=100
  FROM public.customer_savings_goals WHERE id='94000000-0000-4000-8000-000000000004'),
  'Interest reversal reopens capacity without automatically resuming scheduled funding');
SELECT pg_temp.assert_true((SELECT credited_interest_kobo=7000
  FROM jsonb_to_recordset(public.get_customer_savings_earnings('94000000-0000-4000-8000-000000000001',true)->'goal_interest_kobo')
    AS interest(goal_id uuid,credited_interest_kobo numeric)
  WHERE goal_id='94000000-0000-4000-8000-000000000005'),
  'Mobile earnings projection still adds paid interest exactly once to principal');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated',
  'piggyvest_savings_ledger.remaining_goal_kobo(uuid,uuid,uuid,numeric,numeric)','EXECUTE'),
  'Customer cannot query private ledger capacity directly');
SELECT pg_temp.assert_true(NOT has_function_privilege('service_role',
  'piggyvest_savings_ledger.remaining_goal_kobo(uuid,uuid,uuid,numeric,numeric)','EXECUTE'),
  'Service role does not inherit private ledger reads');
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
