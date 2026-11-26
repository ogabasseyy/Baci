-- Customer "Arrived in your city" update when GIG reports the parcel at the
-- destination service centre. Raw status is synthesised by the tracking
-- normalizer; the existing outbox unique key keeps it to one per shipment.
ALTER TABLE private.gigl_tracking_notification_policy
  DROP CONSTRAINT IF EXISTS gigl_tracking_notification_policy_notification_kind_check;
ALTER TABLE private.gigl_tracking_notification_policy
  ADD CONSTRAINT gigl_tracking_notification_policy_notification_kind_check
  CHECK (notification_kind IN (
    'pickup_assigned', 'pickup_en_route', 'pickup_delayed', 'picked_up',
    'transit_started', 'arrived_in_city', 'out_for_delivery', 'delivered',
    'delivery_attempt_failed', 'return_in_progress', 'shipment_exception',
    'failed', 'returned', 'cancelled', 'waybill_changed'
  ));
ALTER TABLE public.shipment_tracking_notification_outbox
  DROP CONSTRAINT IF EXISTS shipment_tracking_notification_outbox_notification_kind_check;
ALTER TABLE public.shipment_tracking_notification_outbox
  ADD CONSTRAINT shipment_tracking_notification_outbox_notification_kind_check
  CHECK (notification_kind IN (
    'pickup_assigned', 'pickup_en_route', 'pickup_delayed', 'picked_up',
    'transit_started', 'arrived_in_city', 'out_for_delivery', 'delivered',
    'delivery_attempt_failed', 'return_in_progress', 'shipment_exception',
    'failed', 'returned', 'cancelled', 'waybill_changed'
  )) NOT VALID;

INSERT INTO private.gigl_tracking_notification_policy (
  raw_status, normalized_status, audience, notification_kind
) VALUES
  ('ARRIVED IN DESTINATION CITY', NULL, 'customer', 'arrived_in_city'),
  ('ARRIVED IN DESTINATION CITY', NULL, 'customer', 'transit_started')
ON CONFLICT (raw_status, audience, notification_kind) DO NOTHING;

ALTER TABLE private.gigl_tracking_notification_policy
  VALIDATE CONSTRAINT gigl_tracking_notification_policy_notification_kind_check;
-- The outbox CHECK stays NOT VALID on purpose: it is enforced for every new
-- row, and validating it here would scan the table while the DROP CONSTRAINT
-- lock above is still held for the whole migration transaction. The next
-- migration validates it (VALIDATE only needs a non-blocking lock).

-- When one poll queues an arrival and an in-transit milestone (from the arrival
-- scan or an earlier one), push only "arrived in your city". The
-- transit_started row stays as the once-per-shipment milestone. This statement
-- trigger is named to run before suppress_late_gigl_tracking_notifications,
-- which would otherwise delete an older pending transit row; the row-level email
-- trigger has already seen it as pending, so the shipped email is unaffected.
CREATE OR REPLACE FUNCTION private.skip_gigl_transit_push_covered_by_arrival()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.shipment_tracking_notification_outbox AS transit
  SET status = 'skipped', skipped_at = now(), updated_at = now(),
    skip_reason = 'covered_by_arrival_push'
  FROM inserted_outbox AS inserted,
    inserted_outbox AS arrival
  WHERE transit.id = inserted.id
    AND transit.audience = 'customer'
    AND transit.notification_kind = 'transit_started'
    AND transit.status = 'pending'
    AND arrival.shipment_id = transit.shipment_id
    AND arrival.tracking_epoch_id = transit.tracking_epoch_id
    AND arrival.audience = 'customer'
    AND arrival.notification_kind = 'arrived_in_city'
    AND arrival.status = 'pending';
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.skip_gigl_transit_push_covered_by_arrival()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS aa_skip_gigl_transit_push_covered_by_arrival
  ON public.shipment_tracking_notification_outbox;
CREATE TRIGGER aa_skip_gigl_transit_push_covered_by_arrival
  AFTER INSERT ON public.shipment_tracking_notification_outbox
  REFERENCING NEW TABLE AS inserted_outbox
  FOR EACH STATEMENT
  EXECUTE FUNCTION private.skip_gigl_transit_push_covered_by_arrival();
