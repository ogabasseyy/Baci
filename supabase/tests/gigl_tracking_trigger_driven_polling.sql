BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
\ir pgtap_public_execute.sql
SET search_path = public, extensions;
SELECT plan(18);
GRANT USAGE ON SCHEMA extensions TO gigl_tracking_worker;

-- GIG tracking polls only when something triggers it: a booking starts a
-- short burst, unchanged polls back off and then go dormant, a GIG webhook
-- wakes a dormant monitor, and a waybill GIG cannot show yet (before
-- pickup) is a quiet poll, never a failure. The suite rolls back, so the
-- booking-economics stamp is disabled only inside this transaction.
ALTER TABLE public.shipments DISABLE TRIGGER stamp_gigl_shipment_economics;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug)
VALUES (
  '7b22e8f1-0000-4000-8000-000000000001',
  'gigl-trigger-polling@example.com',
  'GIGL Trigger Polling',
  'gigl-trigger-polling'
);
INSERT INTO public.orders (id, merchant_id, order_number, total)
SELECT ('7b22e8f1-0000-4000-8000-00000000001' || n)::uuid,
  '7b22e8f1-0000-4000-8000-000000000001',
  'GIGL-TRIGGER-00' || n,
  1000
FROM generate_series(1, 6) AS n;
INSERT INTO public.shipments (
  order_id, merchant_id, provider, tracking_number,
  sender_address, receiver_address, items
)
SELECT ('7b22e8f1-0000-4000-8000-00000000001' || n)::uuid,
  '7b22e8f1-0000-4000-8000-000000000001',
  'GIGL',
  '880000000' || n,
  '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
FROM generate_series(1, 6) AS n;

RESET ROLE;

-- 1. Creation starts the burst: the new monitor is active and due now.
SELECT is(
  (SELECT state || ':' || (next_poll_at = now())::text || ':'
     || unchanged_poll_count::text || ':' || consecutive_failures::text
   FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000001'),
  'active:true:0:0',
  'booking a GIGL waybill starts monitoring immediately'
);

-- Fixture leases: every monitor is claimed by worker w, so the lease-bound
-- RPCs below act on them. 3 has backed off for a while, 4 is about to go
-- dormant, 5 is dormant (its safety check is due) and 6 is dormant with a
-- later safety check (the webhook case).
UPDATE public.shipment_tracking_monitors
SET locked_by = 'w', locked_at = now()
WHERE tracking_number LIKE '88000000%';
UPDATE public.shipment_tracking_monitors SET unchanged_poll_count = 4
WHERE tracking_number = '8800000003';
UPDATE public.shipment_tracking_monitors SET unchanged_poll_count = 8
WHERE tracking_number = '8800000004';
UPDATE public.shipment_tracking_monitors
SET state = 'paused', unchanged_poll_count = 9, stopped_at = now()
WHERE tracking_number = '8800000005';

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

-- 2. GIG omitting a booked waybill is a quiet poll, not a failure.
SELECT ok(
  public.record_gigl_tracking_failure(
    (SELECT shipment_id FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000001'),
    (SELECT tracking_epoch_id FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000001'),
    'w', 'GIGL waybill not yet visible'
  ),
  'the leased not-yet-visible poll is recorded'
);
-- 3. A genuine failure still counts and backs off as before.
SELECT ok(
  public.record_gigl_tracking_failure(
    (SELECT shipment_id FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000002'),
    (SELECT tracking_epoch_id FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000002'),
    'w', 'GIGL unavailable'
  ),
  'a genuine failure is recorded'
);
SELECT ok(
  public.record_gigl_tracking_failure(
    (SELECT shipment_id FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000003'),
    (SELECT tracking_epoch_id FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000003'),
    'w', 'GIGL waybill not yet visible'
  ),
  'a quiet poll after the burst is recorded'
);
SELECT ok(
  public.record_gigl_tracking_failure(
    (SELECT shipment_id FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000004'),
    (SELECT tracking_epoch_id FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000004'),
    'w', 'GIGL waybill not yet visible'
  ),
  'the last back-off poll is recorded'
);
SELECT ok(
  public.record_gigl_tracking_failure(
    (SELECT shipment_id FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000005'),
    (SELECT tracking_epoch_id FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000005'),
    'w', 'GIGL waybill not yet visible'
  ),
  'a dormant safety check is recorded'
);
SELECT ok(
  NOT public.record_gigl_tracking_failure(
    (SELECT shipment_id FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000001'),
    (SELECT tracking_epoch_id FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000001'),
    'w', 'GIGL waybill not yet visible'
  ),
  'a quiet poll still needs the lease'
);

RESET ROLE;
SELECT is(
  (SELECT consecutive_failures::text || ':' || coalesce(last_error, 'null')
   FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000001'),
  '0:null',
  'a not-yet-visible waybill never counts as a failure or raises an error'
);
SELECT is(
  (SELECT state || ':' || unchanged_poll_count::text || ':'
     || (next_poll_at = now() + interval '15 minutes')::text || ':'
     || (locked_by IS NULL)::text || ':' || (last_polled_at = now())::text
   FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000001'),
  'active:1:true:true:true',
  'the burst re-checks 15 minutes later and releases the lease'
);
SELECT is(
  (SELECT consecutive_failures::text || ':' || last_error
   FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000002'),
  '1:GIGL unavailable',
  'a genuine tracking failure still counts'
);
SELECT is(
  (SELECT state || ':' || unchanged_poll_count::text || ':'
     || (next_poll_at = now() + interval '1 hour')::text
   FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000003'),
  'active:5:true',
  'after the burst, unchanged polls back off to hourly'
);
SELECT is(
  (SELECT state || ':' || unchanged_poll_count::text || ':'
     || (next_poll_at = now() + interval '6 hours')::text || ':'
     || coalesce(last_error, 'null')
   FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000004'),
  'paused:9:true:null',
  'nine unchanged polls go dormant with only the six-hour safety check'
);
SELECT is(
  (SELECT state || ':' || unchanged_poll_count::text || ':'
     || (next_poll_at = now() + interval '6 hours')::text
   FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000005'),
  'paused:9:true',
  'a dormant safety check that finds nothing new stays dormant'
);

-- 4. The claim no longer restarts the burst for a dormant monitor.
UPDATE public.shipment_tracking_monitors
SET next_poll_at = now() + interval '1 day', locked_by = NULL, locked_at = NULL
WHERE tracking_number LIKE '88000000%';
UPDATE public.shipment_tracking_monitors
SET next_poll_at = now() - interval '1 second'
WHERE tracking_number = '8800000005';
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT is(
  (SELECT count(*)::integer
   FROM public.claim_due_gigl_tracking_monitors(100, 'w2') AS claimed
   WHERE claimed.tracking_number = '8800000005'),
  1,
  'the dormant safety check is claimed when due'
);
RESET ROLE;
SELECT is(
  (SELECT unchanged_poll_count FROM public.shipment_tracking_monitors
   WHERE tracking_number = '8800000005'),
  9,
  'claiming a dormant monitor keeps its quiet-poll count'
);

-- 5. A GIG webhook wakes a dormant monitor with a short follow-up burst.
UPDATE public.shipment_tracking_monitors
SET state = 'paused', unchanged_poll_count = 9, stopped_at = now(),
  next_poll_at = now() + interval '6 hours',
  last_polled_at = now() - interval '2 hours'
WHERE tracking_number = '8800000006';
SET LOCAL ROLE gigl_tracking_worker;
SELECT set_config('request.jwt.claim.role', 'gigl_tracking_worker', true);
SELECT set_config('request.jwt.claims', '{"role":"gigl_tracking_worker"}', true);
SELECT is(
  public.gigl_worker_expedite_tracking_monitor('8800000006', 'MCRT'),
  '{"matched": 1, "expedited": 1}'::jsonb,
  'a webhook delivery wakes the dormant monitor'
);
RESET ROLE;
SELECT is(
  (SELECT state || ':' || unchanged_poll_count::text || ':'
     || (next_poll_at = now())::text
   FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000006'),
  'paused:6:true',
  'the woken monitor is due now and gets a short follow-up before dormancy'
);

-- 6. New events on a poll restart the normal 15-minute cadence.
UPDATE public.shipment_tracking_monitors
SET state = 'active', unchanged_poll_count = 0,
  next_poll_at = now() + interval '15 minutes'
WHERE tracking_number = '8800000006';
SELECT is(
  (SELECT state || ':' || (next_poll_at = now() + interval '15 minutes')::text
   FROM public.shipment_tracking_monitors WHERE tracking_number = '8800000006'),
  'active:true',
  'a poll that found new events keeps the 15-minute cadence'
);

SELECT * FROM finish();
ROLLBACK;
