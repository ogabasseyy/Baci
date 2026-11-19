-- Eligibility is established before category ranking, not only by the client.
BEGIN;
INSERT INTO public.orders (
  id, merchant_id, customer_id, payment_method, payment_status, total, currency, created_at
)
SELECT ('64000000-0000-4000-8000-' || lpad((g*100+n)::text,12,'0'))::uuid,
  '20000000-0000-4000-8000-000000000001',
  CASE WHEN n = 6 THEN NULL ELSE '30000000-0000-4000-8000-000000000001'::uuid END,
  'oxygen', CASE n WHEN 7 THEN 'pending' WHEN 8 THEN 'bnpl_pending'
    WHEN 9 THEN 'bnpl_approved' ELSE 'unpaid' END,
  CASE n WHEN 2 THEN 0 WHEN 3 THEN -1 WHEN 4 THEN NULL
    WHEN 10 THEN 'NaN'::numeric WHEN 11 THEN 'Infinity'::numeric
    WHEN 12 THEN '-Infinity'::numeric ELSE 10000 END,
  CASE n WHEN 1 THEN 'USD' WHEN 5 THEN NULL ELSE 'NGN' END,
  now()-interval '2 hours'
FROM generate_series(0,2) g CROSS JOIN generate_series(1,13) n;
INSERT INTO public.oxygen_workflows (id, order_id, merchant_id, customer_id, environment, stage, updated_at)
SELECT ('65000000-0000-4000-8000-' || lpad((g*100+n)::text,12,'0'))::uuid,
  ('64000000-0000-4000-8000-' || lpad((g*100+n)::text,12,'0'))::uuid,
  '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  'production', CASE WHEN g = 1 THEN 'eligibility_required' ELSE 'payment_required' END,
  now()-interval '1 hour'
FROM generate_series(1,2) g CROSS JOIN generate_series(1,13) n;
INSERT INTO oxygen_private.provider_states (workflow_id, state)
SELECT id, CASE WHEN stage = 'eligibility_required' THEN '{"eligibilityStatus":"pending"}'::jsonb
  ELSE '{"booking":{"status":"APPROVED"}}'::jsonb END
FROM public.oxygen_workflows WHERE id::text LIKE '65000000-%';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001')
      WHERE order_id::text LIKE '64000000-%' AND right(order_id::text,2) <> '13'
        AND follow_up_status = 'needs_review' AND order_customer_id IS NULL) <> 36 THEN
    RAISE EXCEPTION 'Invalid amount, currency, customer or payment state used active capacity';
  END IF;
  IF (SELECT array_agg(follow_up_status ORDER BY order_id)
      FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001')
      WHERE order_id::text LIKE '64000000-%' AND right(order_id::text,2) = '13')
      IS DISTINCT FROM ARRAY['customer_action','oxygen_processing','approved_pending']::text[] THEN
    RAISE EXCEPTION 'Eligible rows lost their expected active classification';
  END IF;
  IF (SELECT array_agg(order_id ORDER BY order_id)
      FROM public.oxygen_follow_up_candidates('20000000-0000-4000-8000-000000000001')
      WHERE order_id::text LIKE '64000000-%' AND order_customer_id IS NOT NULL)
      IS DISTINCT FROM ARRAY['64000000-0000-4000-8000-000000000013']::uuid[] THEN
    RAISE EXCEPTION 'Only the eligible customer-action row may expose its customer binding';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
