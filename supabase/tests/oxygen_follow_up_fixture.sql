CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
CREATE SCHEMA auth;
CREATE SCHEMA oxygen_private;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE FUNCTION public.has_merchant_access(p_merchant uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT auth.uid() = '10000000-0000-4000-8000-000000000001'::uuid
    AND p_merchant = '20000000-0000-4000-8000-000000000001'::uuid
$$;

CREATE TABLE public.orders (
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL, customer_id uuid,
  payment_method text, payment_status text, created_at timestamptz NOT NULL,
  updated_at timestamptz,
  cancelled_at timestamptz, source text, recorded_by_user_id uuid,
  external_source text, import_job_id uuid
);
CREATE TABLE public.oxygen_workflows (
  id uuid PRIMARY KEY, order_id uuid NOT NULL UNIQUE, merchant_id uuid NOT NULL,
  customer_id uuid NOT NULL, environment text NOT NULL, stage text NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE oxygen_private.provider_states (workflow_id uuid PRIMARY KEY, state jsonb);
CREATE TABLE oxygen_private.commands (
  id uuid PRIMARY KEY, workflow_id uuid NOT NULL, status text NOT NULL,
  command jsonb NOT NULL, created_at timestamptz NOT NULL, started_at timestamptz
);
CREATE TABLE oxygen_private.provider_reference_history (
  command_id uuid PRIMARY KEY, workflow_id uuid NOT NULL, booking_reference uuid
);
CREATE TABLE oxygen_private.general_activations (
  workflow_id uuid PRIMARY KEY, status text NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE oxygen_private.general_activation_reconcile_conflicts (
  workflow_id uuid PRIMARY KEY, resolved_at timestamptz
);
CREATE TABLE oxygen_private.payment_recovery (
  workflow_id uuid NOT NULL, booking_reference uuid NOT NULL, action text NOT NULL,
  status text NOT NULL, created_at timestamptz NOT NULL, started_at timestamptz
);

INSERT INTO public.orders (id, merchant_id, customer_id, payment_method, payment_status, created_at)
SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  CASE WHEN n = 9 THEN '20000000-0000-4000-8000-000000000002'::uuid
       ELSE '20000000-0000-4000-8000-000000000001'::uuid END,
  '30000000-0000-4000-8000-000000000001'::uuid, 'oxygen', 'unpaid',
  now() - CASE WHEN n = 14 THEN interval '91 days' ELSE interval '2 hours' END
FROM generate_series(1,18) n;
UPDATE public.orders SET source = 'whatsapp' WHERE id = '00000000-0000-4000-8000-000000000016';
UPDATE public.orders SET cancelled_at = now(), payment_status = 'cancelled' WHERE id = '00000000-0000-4000-8000-000000000012';
UPDATE public.orders SET payment_status = 'paid' WHERE id = '00000000-0000-4000-8000-000000000018';

INSERT INTO public.oxygen_workflows (id, order_id, merchant_id, customer_id, environment, stage, updated_at)
SELECT ('40000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, o.id, o.merchant_id, o.customer_id,
  CASE WHEN n = 10 THEN 'staging' ELSE 'production' END,
  CASE WHEN n IN (2,6,9,10,13) THEN 'eligibility_required'
       WHEN n IN (3,12,17) THEN 'booked'
       WHEN n IN (4,18) THEN 'payment_required'
       WHEN n IN (5,14) THEN 'reconciliation_required'
       WHEN n = 8 THEN 'activated' ELSE 'plan_required' END,
  now() - CASE WHEN n IN (5,6,7,15) THEN interval '5 minutes' ELSE interval '1 hour' END
FROM generate_series(1,18) n
JOIN public.orders o ON o.id = ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
WHERE n NOT IN (11,16);

INSERT INTO oxygen_private.provider_states (workflow_id, state)
SELECT id, CASE
  WHEN order_id IN ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000006')
    THEN '{"eligibilityStatus":"pending","newUserToken":"private"}'::jsonb
  WHEN order_id = '00000000-0000-4000-8000-000000000003' THEN '{"kyc":{"address_status":"PROCESSING"}}'::jsonb
  WHEN order_id IN ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000018')
    THEN '{"booking":{"status":"APPROVED"},"bookingReference":"50000000-0000-4000-8000-000000000001"}'::jsonb
  WHEN order_id = '00000000-0000-4000-8000-000000000012'
    THEN '{"bookingReference":"50000000-0000-4000-8000-000000000001"}'::jsonb
  WHEN order_id = '00000000-0000-4000-8000-000000000013' THEN '{"eligibilityStatus":"failed"}'::jsonb
  WHEN order_id = '00000000-0000-4000-8000-000000000017'
    THEN '{"bookingReference":"50000000-0000-4000-8000-000000000001","kyc":{"address_status":"NOT_DONE"}}'::jsonb
  ELSE '{}'::jsonb END
FROM public.oxygen_workflows;
INSERT INTO oxygen_private.commands VALUES
  ('60000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000006', 'indeterminate', '{"action":"book"}', now()-interval '5 minutes'),
  ('60000000-0000-4000-8000-000000000017', '40000000-0000-4000-8000-000000000017', 'succeeded', '{"action":"submit_address"}', now()-interval '1 hour');
INSERT INTO oxygen_private.provider_reference_history VALUES
  ('60000000-0000-4000-8000-000000000017', '40000000-0000-4000-8000-000000000017', '50000000-0000-4000-8000-000000000001');

-- A changed payment method or a terminal order must not hide a booked loan.
INSERT INTO public.orders (id,merchant_id,customer_id,payment_method,payment_status,created_at,updated_at)
SELECT ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  CASE WHEN n = 19 THEN 'paystack' ELSE 'oxygen' END,
  CASE WHEN n = 21 THEN 'canceled' ELSE 'unpaid' END,
  now()-CASE WHEN n IN (29,30,32) THEN interval '91 days' ELSE interval '2 hours' END,
  CASE WHEN n IN (20,31) THEN now()-interval '2 minutes' ELSE now()-interval '1 hour' END
FROM generate_series(19,46) n;
UPDATE public.orders SET payment_status='bnpl_approved' WHERE id='00000000-0000-4000-8000-000000000022';
UPDATE public.orders SET payment_status='paid' WHERE id='00000000-0000-4000-8000-000000000024';
UPDATE public.orders SET payment_status='cancelled', cancelled_at=now() WHERE id='00000000-0000-4000-8000-000000000025';
UPDATE public.orders SET payment_status='cancelled', cancelled_at=now() WHERE id='00000000-0000-4000-8000-000000000026';
UPDATE public.orders SET payment_status='cancelled', cancelled_at=now() WHERE id='00000000-0000-4000-8000-000000000027';
UPDATE public.orders SET payment_status='partially_paid' WHERE id='00000000-0000-4000-8000-000000000028';
UPDATE public.orders SET payment_status='failed' WHERE id='00000000-0000-4000-8000-000000000029';
UPDATE public.orders SET payment_status='expired' WHERE id='00000000-0000-4000-8000-000000000030';
UPDATE public.orders SET payment_status='pending' WHERE id='00000000-0000-4000-8000-000000000031';
UPDATE public.orders SET payment_status='paid' WHERE id IN ('00000000-0000-4000-8000-000000000036','00000000-0000-4000-8000-000000000037');
UPDATE public.orders SET payment_method='paystack' WHERE id IN ('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000045');
INSERT INTO public.oxygen_workflows (id,order_id,merchant_id,customer_id,environment,stage,updated_at)
SELECT ('40000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, o.id, o.merchant_id, o.customer_id,
  'production', CASE WHEN n = 20 THEN 'plan_required' WHEN n = 22 THEN 'eligibility_required'
    WHEN n IN (24,25,26,36,37) THEN 'activated' WHEN n IN (32,33,34,35,39,40,41,42) THEN 'ready_for_activation'
    WHEN n IN (43,45) THEN 'plan_required' WHEN n = 44 THEN 'application_required'
    ELSE 'booked' END, now()-interval '1 hour'
FROM generate_series(19,46) n JOIN public.orders o ON o.id=('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
UPDATE public.oxygen_workflows SET customer_id='30000000-0000-4000-8000-000000000002'
WHERE id IN ('40000000-0000-4000-8000-000000000044','40000000-0000-4000-8000-000000000045','40000000-0000-4000-8000-000000000046');
INSERT INTO oxygen_private.provider_states (workflow_id,state)
SELECT id, '{"bookingReference":"50000000-0000-4000-8000-000000000001"}'::jsonb
FROM public.oxygen_workflows WHERE id IN ('40000000-0000-4000-8000-000000000019','40000000-0000-4000-8000-000000000021');
INSERT INTO oxygen_private.provider_states VALUES
  ('40000000-0000-4000-8000-000000000022', '{"eligibilityStatus":"pending"}'::jsonb);
INSERT INTO oxygen_private.provider_states VALUES
  ('40000000-0000-4000-8000-000000000023', '{"bookingReference":"50000000-0000-4000-8000-000000000001","kyc":{"address_status":"NOT_DONE"}}'::jsonb);
INSERT INTO oxygen_private.provider_states
SELECT id, '{"bookingReference":"50000000-0000-4000-8000-000000000001","booking":{"status":"ACTIVATED"}}'::jsonb
FROM public.oxygen_workflows WHERE id IN ('40000000-0000-4000-8000-000000000024','40000000-0000-4000-8000-000000000025');
INSERT INTO oxygen_private.commands VALUES
  ('60000000-0000-4000-8000-000000000023','40000000-0000-4000-8000-000000000023','succeeded','{"action":"submit_address"}',now()-interval '1 hour');
INSERT INTO oxygen_private.provider_reference_history VALUES
  ('60000000-0000-4000-8000-000000000023','40000000-0000-4000-8000-000000000023','50000000-0000-4000-8000-000000000002');
INSERT INTO oxygen_private.commands VALUES
  ('60000000-0000-4000-8000-000000000027','40000000-0000-4000-8000-000000000027','succeeded','{"action":"book"}',now()-interval '1 hour');
INSERT INTO oxygen_private.provider_reference_history VALUES
  ('60000000-0000-4000-8000-000000000027','40000000-0000-4000-8000-000000000027','50000000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.provider_states (workflow_id,state)
SELECT id, '{"bookingReference":"50000000-0000-4000-8000-000000000001","booking":{"status":"APPROVED"}}'::jsonb
FROM public.oxygen_workflows WHERE id IN (
  '40000000-0000-4000-8000-000000000032','40000000-0000-4000-8000-000000000033',
  '40000000-0000-4000-8000-000000000034','40000000-0000-4000-8000-000000000035',
  '40000000-0000-4000-8000-000000000039','40000000-0000-4000-8000-000000000040',
  '40000000-0000-4000-8000-000000000041','40000000-0000-4000-8000-000000000042');
INSERT INTO oxygen_private.general_activations VALUES
  ('40000000-0000-4000-8000-000000000032','indeterminate',now()-interval '2 hours'),
  ('40000000-0000-4000-8000-000000000033','executing',now()-interval '1 minute'),
  ('40000000-0000-4000-8000-000000000034','executing',now()-interval '2 hours'),
  ('40000000-0000-4000-8000-000000000035','activated',now()-interval '2 hours'),
  ('40000000-0000-4000-8000-000000000036','activated',now()-interval '2 hours'),
  ('40000000-0000-4000-8000-000000000037','activated',now()-interval '2 hours');
INSERT INTO oxygen_private.general_activation_reconcile_conflicts VALUES
  ('40000000-0000-4000-8000-000000000036',NULL),
  ('40000000-0000-4000-8000-000000000037',now()-interval '1 hour');
INSERT INTO oxygen_private.provider_states VALUES
  ('40000000-0000-4000-8000-000000000038', '{"bookingReference":"50000000-0000-4000-8000-000000000004","kyc":{"address_status":"DONE"}}'::jsonb);
INSERT INTO oxygen_private.commands VALUES
  ('60000000-0000-4000-8000-000000000038','40000000-0000-4000-8000-000000000038','succeeded','{"action":"submit_address"}',now()-interval '1 hour');
INSERT INTO oxygen_private.provider_reference_history VALUES
  ('60000000-0000-4000-8000-000000000038','40000000-0000-4000-8000-000000000038','50000000-0000-4000-8000-000000000004');
INSERT INTO oxygen_private.payment_recovery VALUES
  ('40000000-0000-4000-8000-000000000039','50000000-0000-4000-8000-000000000001','resend_upfront','indeterminate',now()-interval '2 hours',now()-interval '2 hours'),
  ('40000000-0000-4000-8000-000000000040','50000000-0000-4000-8000-000000000001','check_status','executing',now()-interval '2 hours',now()-interval '1 minute'),
  ('40000000-0000-4000-8000-000000000041','50000000-0000-4000-8000-000000000001','check_status','executing',now()-interval '2 hours',now()-interval '1 hour'),
  ('40000000-0000-4000-8000-000000000042','50000000-0000-4000-8000-000000000002','resend_upfront','indeterminate',now()-interval '2 hours',now()-interval '2 hours');
