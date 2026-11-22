\ir fixtures/paid-order-amendments/concurrency-lock.inc.sql
\ir fixtures/paid-order-amendments/settlement-setup.inc.sql

CREATE FUNCTION pg_temp.settlement_action_sql(f jsonb,payload jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.run_paid_order_amendment_action(%L,%L,%L)::text',f->>'order',f->>'amendment',payload);
$$;

-- The first order holds the bank evidence row while uncommitted. The second
-- order must observe that allocation before deciding whether it can fund.
SELECT pg_temp.amendment_settlement_seed(5000000) AS one \gset
SELECT pg_temp.amendment_settlement_seed(5000000,(:'one'::jsonb->>'merchant')::uuid) AS two \gset
SELECT pg_temp.amendment_bank(:'one',5000000) AS evidence \gset
SELECT pg_temp.amendment_run_race(
  :'one'::jsonb->>'actor',pg_temp.settlement_action_sql(:'one',jsonb_build_object(
    'action','record_top_up','evidenceId',:'evidence','idempotencyKey','fixture-first')),
  :'two'::jsonb->>'actor',pg_temp.settlement_action_sql(:'two',jsonb_build_object(
    'action','record_top_up','evidenceId',:'evidence','idempotencyKey','fixture-second')),
  'bank_evidence_conflict');
SELECT 1 / ((SELECT count(*) FROM private.paid_order_amendments
  WHERE id IN ((:'one'::jsonb->>'amendment')::uuid,(:'two'::jsonb->>'amendment')::uuid) AND state = 'settled') = 1)::int;

-- The ordinary writer and two amendments contend simultaneously for a new bank entry.
SELECT pg_temp.amendment_settlement_seed(5000000,(:'two'::jsonb->>'merchant')::uuid) AS three \gset
SELECT gen_random_uuid() AS ordinary,pg_temp.amendment_bank(:'two',5000000) AS second_entry \gset
SELECT set_config('request.jwt.claim.role','service_role',false) IS NOT NULL;
INSERT INTO public.orders(id,merchant_id,order_number,source,currency,payment_status,shipping_status,total,subtotal,amount_paid)
VALUES (:'ordinary',(:'two'::jsonb->>'merchant')::uuid,:'ordinary','online_store','NGN','unpaid','pending',50000,50000,0);
SELECT pg_temp.amendment_run_race(
  :'two'::jsonb->>'actor',format(
    'SELECT public.record_manual_order_payment(%L,%L,50000,''NGN'',%L,NULL,''{"payment_method":"bank_transfer"}'',''fixture-ordinary'')::text',
    :'two'::jsonb->>'merchant',:'ordinary',:'second_entry'),
  :'two'::jsonb->>'actor',pg_temp.settlement_action_sql(:'two',jsonb_build_object(
    'action','record_top_up','evidenceId',:'second_entry','idempotencyKey','fixture-ordinary-race')),
  'bank_evidence_conflict',NULL,
  pg_temp.settlement_action_sql(:'three',jsonb_build_object(
    'action','record_top_up','evidenceId',:'second_entry','idempotencyKey','fixture-ordinary-third')));
SELECT 1 / ((SELECT count(*) FROM private.paid_order_amendments
  WHERE id IN ((:'two'::jsonb->>'amendment')::uuid,(:'three'::jsonb->>'amendment')::uuid)
    AND hold_fulfillment) = 2)::int;
SELECT 1 / ((SELECT allocation FROM private.paid_order_bank_evidence WHERE id = :'second_entry') = 'ordinary')::int;

-- A pre-cutover or reference-only transfer cannot post to a pilot account.
SELECT gen_random_uuid() AS unverified \gset
INSERT INTO public.orders(id,merchant_id,order_number,source,currency,payment_status,shipping_status,total,subtotal,amount_paid)
VALUES (:'unverified',(:'two'::jsonb->>'merchant')::uuid,:'unverified','online_store','NGN','unpaid','pending',50000,50000,0);
SELECT set_config('request.jwt.claim.sub',:'two'::jsonb->>'actor',false) IS NOT NULL;
SELECT set_config('request.jwt.claim.role','authenticated',false) IS NOT NULL;
SELECT format('SELECT public.record_manual_order_payment(%L,%L,50000,''NGN'',NULL,NULL,''{"payment_method":"bank_transfer"}'',''fixture-unverified'');',
  :'two'::jsonb->>'merchant',:'unverified') AS unverified_sql \gset
SELECT set_config('baci.test_manual_sql',:'unverified_sql',false) IS NOT NULL;
DO $$
BEGIN
  EXECUTE current_setting('baci.test_manual_sql');
  RAISE EXCEPTION 'pilot bank transfer settled without evidence';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'bank_evidence_required' THEN RAISE; END IF;
END;
$$;
SELECT 1 / ((SELECT amount_paid FROM public.orders WHERE id = :'unverified') = 0)::int;

-- The worker wins the shared lock and records its claim before reversal
-- can decide whether it is safe to swap the inventory back.
SELECT pg_temp.amendment_settlement_seed(-5000000) AS down \gset
SELECT id AS refund FROM private.paid_order_amendment_refunds WHERE amendment_id = (:'down'::jsonb->>'amendment')::uuid \gset
SELECT pg_temp.amendment_run_race(NULL,format('SELECT public.authorize_paid_order_amendment_refund_dispatch(%L,true)::text',:'refund'),
  :'down'::jsonb->>'actor',pg_temp.settlement_action_sql(:'down',
    '{"action":"reverse","reason":"Synthetic worker race","idempotencyKey":"fixture-race-worker"}'),'amendment_payment_open');
SELECT 1 / ((SELECT state FROM private.paid_order_amendment_refunds WHERE id = :'refund') = 'uncertain')::int;

-- Recovery wins the reverse commit order. The waiting worker cannot submit.
SELECT pg_temp.amendment_settlement_seed(-5000000) AS down \gset
SELECT id AS refund FROM private.paid_order_amendment_refunds WHERE amendment_id = (:'down'::jsonb->>'amendment')::uuid \gset
SELECT pg_temp.amendment_run_race(:'down'::jsonb->>'actor',pg_temp.settlement_action_sql(:'down',
    '{"action":"reverse","reason":"Synthetic reversal race","idempotencyKey":"fixture-race-reverse"}'),
  NULL,format('SELECT CASE WHEN NOT public.authorize_paid_order_amendment_refund_dispatch(%L,true) THEN ''void'' ELSE 1::text END',:'refund'),NULL);
SELECT 1 / ((SELECT state FROM private.paid_order_amendment_refunds WHERE id = :'refund') = 'void')::int;

-- A payout posting locks the settlement row first. The merchant adjustment
-- waits, then uses the credited-wallet path once against the locked row.
SELECT pg_temp.amendment_settlement_seed(-5000000) AS down \gset
SELECT id AS refund,reference AS refund_ref FROM private.paid_order_amendment_refunds
WHERE amendment_id = (:'down'::jsonb->>'amendment')::uuid \gset
SELECT set_config('request.jwt.claim.role','service_role',false) IS NOT NULL;
SELECT public.claim_paid_order_amendment_refund(:'refund') IS NOT NULL;
SELECT public.authorize_paid_order_amendment_refund_dispatch(:'refund',true);
SELECT public.record_paid_order_amendment_refund(:'refund_ref',jsonb_build_object('reference',:'refund_ref',
  'transactionId','531','integration','987','domain','test','currency','NGN','amount',5000000,'id',pg_current_xact_id()::text,'status','processed'));
SELECT pg_temp.amendment_run_race(NULL,format('SELECT public.process_due_settlements()::text /* settlement %s */',:'refund'),
  NULL,format('SELECT public.apply_paid_order_amendment_adjustment(%L,4900000,%L)::text',:'refund','synthetic payout-race ' || :'refund'),NULL);
SELECT 1 / ((SELECT net_amount FROM public.merchant_settlements WHERE source_id = (:'down'::jsonb->>'order')::uuid) = 250000)::int;
SELECT 1 / ((SELECT count(*) FROM private.paid_order_amendment_adjustments WHERE refund_id = :'refund') = 1)::int;

-- Two operators retry the same verified failure. Only one creates a new attempt.
SELECT pg_temp.amendment_settlement_seed(-5000000) AS down \gset
SELECT id AS refund,reference AS refund_ref FROM private.paid_order_amendment_refunds
WHERE amendment_id = (:'down'::jsonb->>'amendment')::uuid \gset
SELECT public.authorize_paid_order_amendment_refund_dispatch(:'refund',true);
SELECT public.record_paid_order_amendment_refund(:'refund_ref',jsonb_build_object('reference',:'refund_ref',
  'transactionId','531','integration','987','domain','test','currency','NGN','amount',5000000,'id',pg_current_xact_id()::text,'status','failed'));
SELECT pg_temp.amendment_run_race(
  :'down'::jsonb->>'actor',pg_temp.settlement_action_sql(:'down',jsonb_build_object(
    'action','retry_failed_refund','operationId',:'refund','idempotencyKey','fixture-retry-one')),
  :'down'::jsonb->>'actor',pg_temp.settlement_action_sql(:'down',jsonb_build_object(
    'action','retry_failed_refund','operationId',:'refund','idempotencyKey','fixture-retry-two')),
  'refund_evidence_required');
SELECT 1 / ((SELECT count(*) FROM private.paid_order_amendment_refunds
  WHERE amendment_id = (:'down'::jsonb->>'amendment')::uuid) = 2)::int;

-- A pending offline disbursement keeps recovery cancellation from adding a
-- second repayment while the outgoing statement entry is unverified.
SELECT pg_temp.amendment_settlement_seed(5000000) AS top_up \gset
SELECT pg_temp.amendment_bank(:'top_up',4000000) AS short_evidence \gset
SELECT set_config('request.jwt.claim.sub',:'top_up'::jsonb->>'actor',false) IS NOT NULL;
SELECT set_config('request.jwt.claim.role','authenticated',false) IS NOT NULL;
SELECT pg_temp.amendment_action(:'top_up',jsonb_build_object(
  'action','record_top_up','evidenceId',:'short_evidence','idempotencyKey','fixture-concurrent-short'));
SELECT pg_temp.amendment_run_race(
  :'top_up'::jsonb->>'actor',pg_temp.settlement_action_sql(:'top_up',jsonb_build_object(
    'action','claim_offline_disbursement','sourceKind','unapplied','sourceId',:'short_evidence','idempotencyKey','fixture-offline-claim')),
  :'top_up'::jsonb->>'actor',pg_temp.settlement_action_sql(:'top_up',
    '{"action":"cancel_for_recovery","reason":"Synthetic offline race","idempotencyKey":"fixture-offline-recovery"}'),
  'amendment_payment_open');

-- Importing a known short transfer wins the order lock before the exact
-- transfer is applied. The exact evidence remains available for later use.
SELECT pg_temp.amendment_settlement_seed(5000000) AS bound \gset
SELECT pg_temp.amendment_bank(:'bound',5000000) AS exact_evidence \gset
SELECT pg_temp.amendment_run_race(
  NULL,format('SELECT public.register_paid_order_bank_evidence(%L,gen_random_uuid()::text,''incoming'',4000000,
    clock_timestamp()-interval ''1 second'',''fixture short transfer'',NULL,%L)::text',
    :'bound'::jsonb->>'bank',:'bound'::jsonb->>'order'),
  :'bound'::jsonb->>'actor',pg_temp.settlement_action_sql(:'bound',jsonb_build_object(
    'action','record_top_up','evidenceId',:'exact_evidence','idempotencyKey','fixture-exact-vs-short')),
  'amendment_payment_open');
SELECT 1 / ((SELECT allocation IS NULL FROM private.paid_order_bank_evidence WHERE id = :'exact_evidence')::int);
