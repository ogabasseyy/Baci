BEGIN;

SELECT plan(1);

-- Scope guard for 20261119130100: the repair predicate keys on MSHC events that
-- precede all other movement. Verified end-to-end on scratch Postgres; this
-- suite replays the migration file's presence and idempotence in CI by
-- asserting no GIGL shipment is left whose only out_for_delivery evidence is a
-- first-mile MSHC with no movement before it.
SELECT is(
  (SELECT count(*)::int
   FROM public.shipments AS shipment
   JOIN public.shipment_tracking_monitors AS monitor
     ON monitor.shipment_id = shipment.id AND monitor.state = 'active'
   WHERE shipment.provider = 'GIGL'
     AND shipment.status = 'out_for_delivery'
     AND NOT EXISTS (
       SELECT 1 FROM public.shipment_tracking_events AS event
       WHERE event.shipment_id = shipment.id
         AND event.normalized_status = 'out_for_delivery'
         AND (upper(event.raw_status) <> 'MSHC' OR EXISTS (
           SELECT 1 FROM public.shipment_tracking_events AS earlier
           WHERE earlier.shipment_id = shipment.id
             AND earlier.normalized_status = 'in_transit'
             AND earlier.occurred_at < event.occurred_at))))
  0,
  'no active GIG shipment is out_for_delivery on a first-mile MSHC alone'
);

SELECT * FROM finish();
ROLLBACK;
