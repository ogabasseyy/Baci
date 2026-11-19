BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
\ir pgtap_public_execute.sql
SET search_path = public, extensions;
SELECT plan(25);
GRANT USAGE ON SCHEMA extensions TO gigl_tracking_worker;

-- Fixtures: one GIGL shipment per order (one live monitor per order).
-- Booking economics are out of scope here; the suite rolls back, so the
-- quote-attestation stamp is disabled only inside this transaction.
ALTER TABLE public.shipments DISABLE TRIGGER stamp_gigl_shipment_economics;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug)
VALUES (
  '6a11d7e0-0000-4000-8000-000000000001',
  'gigl-webhook-expedite@example.com',
  'GIGL Webhook Expedite',
  'gigl-webhook-expedite'
);
INSERT INTO public.orders (id, merchant_id, order_number, total)
SELECT ('6a11d7e0-0000-4000-8000-00000000001' || n)::uuid,
  '6a11d7e0-0000-4000-8000-000000000001',
  'GIGL-WEBHOOK-00' || n,
  1000
FROM generate_series(1, 7) AS n;
INSERT INTO public.shipments (
  order_id, merchant_id, provider, tracking_number,
  sender_address, receiver_address, items
)
SELECT ('6a11d7e0-0000-4000-8000-00000000001' || n)::uuid,
  '6a11d7e0-0000-4000-8000-000000000001',
  'GIGL',
  '770000000' || n,
  '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
FROM generate_series(1, 7) AS n;

RESET ROLE;
-- 1: due later, polled long ago. 2: polled 10 seconds ago. 3: terminal.
-- 4: paused after unchanged polls. 5: in failure backoff. 6: parked
-- (paused with no schedule). 7: polled 10 minutes ago on the normal
-- 15-minute cadence; the poller already recorded scan MSHC.
UPDATE public.shipment_tracking_monitors
SET state = 'active', next_poll_at = now() + interval '15 minutes',
  last_polled_at = now() - interval '10 minutes'
WHERE tracking_number = '7700000001';
UPDATE public.shipment_tracking_monitors
SET state = 'active', next_poll_at = now() + interval '15 minutes',
  last_polled_at = now() - interval '10 seconds'
WHERE tracking_number = '7700000002';
UPDATE public.shipment_tracking_monitors
SET state = 'terminal', next_poll_at = NULL, stopped_at = now()
WHERE tracking_number = '7700000003';
UPDATE public.shipment_tracking_monitors
SET state = 'paused', next_poll_at = now() + interval '24 hours',
  last_polled_at = now() - interval '2 hours'
WHERE tracking_number = '7700000004';
UPDATE public.shipment_tracking_monitors
SET state = 'active', next_poll_at = now() + interval '20 minutes',
  last_polled_at = now() - interval '10 minutes', consecutive_failures = 2
WHERE tracking_number = '7700000005';
UPDATE public.shipment_tracking_monitors
SET state = 'paused', next_poll_at = NULL,
  last_polled_at = now() - interval '2 hours'
WHERE tracking_number = '7700000006';
UPDATE public.shipment_tracking_monitors
SET state = 'active', next_poll_at = now() + interval '5 minutes',
  last_polled_at = now() - interval '10 minutes'
WHERE tracking_number = '7700000007';
INSERT INTO public.shipment_tracking_events (
  shipment_id, tracking_epoch_id, tracking_number, provider,
  provider_event_key, raw_status, normalized_status, description, occurred_at
)
SELECT shipment_id, tracking_epoch_id, tracking_number, 'GIGL',
  'shipment:webhook-replay', 'MSHC', 'out_for_delivery',
  'Out for delivery', now() - interval '20 minutes'
FROM public.shipment_tracking_monitors
WHERE tracking_number = '7700000007';

-- Privileges: only the confined worker role may execute the wrapper.
SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.gigl_worker_expedite_tracking_monitor(text,text)', 'EXECUTE'
  ),
  'anon cannot expedite GIGL monitors'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated', 'public.gigl_worker_expedite_tracking_monitor(text,text)', 'EXECUTE'
  ),
  'authenticated cannot expedite GIGL monitors'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role', 'public.gigl_worker_expedite_tracking_monitor(text,text)', 'EXECUTE'
  ),
  'service_role holds no direct grant on the webhook wrapper'
);
SELECT ok(
  has_function_privilege(
    'gigl_tracking_worker', 'public.gigl_worker_expedite_tracking_monitor(text,text)', 'EXECUTE'
  ),
  'the GIGL worker role may expedite monitors'
);

-- A caller without the worker claim is rejected even with EXECUTE.
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT throws_ok(
  $$SELECT public.gigl_worker_expedite_tracking_monitor('7700000001')$$,
  '42501',
  'GIGL worker capability required',
  'the wrapper requires the worker claim'
);

SET LOCAL ROLE gigl_tracking_worker;
SELECT set_config('request.jwt.claim.role', 'gigl_tracking_worker', true);
SELECT set_config('request.jwt.claims', '{"role":"gigl_tracking_worker"}', true);

SELECT throws_ok(
  $$SELECT public.gigl_worker_expedite_tracking_monitor('1349 639673')$$,
  '22023',
  'GIGL waybill is invalid',
  'malformed waybills are rejected before any lookup'
);
SELECT is(
  public.gigl_worker_expedite_tracking_monitor(' 7700000001 '),
  '{"matched": 1, "expedited": 1}'::jsonb,
  'a live monitor is made due'
);
SELECT is(
  public.gigl_worker_expedite_tracking_monitor('7700000001'),
  '{"matched": 1, "expedited": 0}'::jsonb,
  'a duplicate delivery is a no-op'
);
SELECT is(
  public.gigl_worker_expedite_tracking_monitor('7700000002'),
  '{"matched": 1, "expedited": 1}'::jsonb,
  'a recently polled monitor is pulled forward'
);
SELECT is(
  public.gigl_worker_expedite_tracking_monitor('7700000003'),
  '{"matched": 0, "expedited": 0}'::jsonb,
  'a terminal monitor is never reactivated'
);
SELECT is(
  public.gigl_worker_expedite_tracking_monitor('7700000004'),
  '{"matched": 1, "expedited": 1}'::jsonb,
  'a paused monitor is woken by a fresh scan'
);
SELECT is(
  public.gigl_worker_expedite_tracking_monitor('7700000005'),
  '{"matched": 1, "expedited": 0}'::jsonb,
  'a monitor in failure backoff keeps its schedule'
);
SELECT is(
  public.gigl_worker_expedite_tracking_monitor('7700000006'),
  '{"matched": 1, "expedited": 0}'::jsonb,
  'a parked monitor without a schedule stays parked'
);
SELECT is(
  public.gigl_worker_expedite_tracking_monitor('7700000007', ' mshc '),
  '{"matched": 1, "expedited": 0}'::jsonb,
  'a recorded status (replay or repeat scan) never beats the poll cadence'
);
SELECT is(
  public.gigl_worker_expedite_tracking_monitor('7700000007', 'MDLV'),
  '{"matched": 1, "expedited": 1}'::jsonb,
  'a new status for the same waybill still expedites'
);
SELECT is(
  public.gigl_worker_expedite_tracking_monitor('7799999999'),
  '{"matched": 0, "expedited": 0}'::jsonb,
  'an unknown waybill is a no-op'
);
SELECT throws_ok(
  $$SELECT count(*) FROM public.shipment_tracking_monitors$$,
  '42501',
  NULL,
  'the worker role still has no direct table access'
);

RESET ROLE;
SELECT is(
  (SELECT next_poll_at FROM public.shipment_tracking_monitors
   WHERE tracking_number = '7700000001'),
  now(),
  'the expedited monitor is due immediately'
);
SELECT is(
  (SELECT next_poll_at FROM public.shipment_tracking_monitors
   WHERE tracking_number = '7700000002'),
  now() - interval '10 seconds' + interval '1 minute',
  'a burst waits one minute after the previous poll'
);
SELECT is(
  (SELECT state || ':' || coalesce(next_poll_at::text, 'null')
   FROM public.shipment_tracking_monitors
   WHERE tracking_number = '7700000003'),
  'terminal:null',
  'the terminal monitor is unchanged'
);
SELECT is(
  (SELECT state || ':' || (next_poll_at = now())::text
   FROM public.shipment_tracking_monitors
   WHERE tracking_number = '7700000004'),
  'paused:true',
  'the paused monitor keeps its state for the claim and becomes due'
);

-- The PostgREST guard admits the new wrapper and keeps the rest confined.
SELECT set_config('request.jwt.claims', '{"role":"gigl_tracking_worker"}', true);
SELECT set_config('request.jwt.claim.role', 'gigl_tracking_worker', true);
SELECT set_config('request.method', 'POST', true);
SELECT set_config('request.path', '/rpc/gigl_worker_expedite_tracking_monitor', true);
SELECT lives_ok(
  'SELECT public.enforce_gigl_tracking_worker_request_scope()',
  'the worker may POST the expedite wrapper'
);
SELECT set_config('request.path', '/rpc/gigl_worker_claim_due_tracking_monitors', true);
SELECT lives_ok(
  'SELECT public.enforce_gigl_tracking_worker_request_scope()',
  'existing worker wrappers remain allowed'
);
SELECT set_config('request.method', 'GET', true);
SELECT set_config('request.path', '/rpc/gigl_worker_expedite_tracking_monitor', true);
SELECT throws_ok(
  'SELECT public.enforce_gigl_tracking_worker_request_scope()',
  '42501',
  'GIGL worker request is outside its capability scope',
  'the expedite wrapper is POST-only'
);
SELECT set_config('request.method', 'POST', true);
SELECT set_config('request.path', '/rpc/claim_due_gigl_tracking_monitors', true);
SELECT throws_ok(
  'SELECT public.enforce_gigl_tracking_worker_request_scope()',
  '42501',
  'GIGL worker request is outside its capability scope',
  'unwrapped RPCs stay outside the worker scope'
);

SELECT * FROM finish();
ROLLBACK;
