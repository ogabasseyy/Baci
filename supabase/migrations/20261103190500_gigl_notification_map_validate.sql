-- Validate the CHECK constraints added NOT VALID earlier in this series, so
-- the scans run under SHARE UPDATE EXCLUSIVE instead of ACCESS EXCLUSIVE.
ALTER TABLE public.notification_preferences
  VALIDATE CONSTRAINT notification_preferences_shipment_event_preferences_object;
ALTER TABLE private.gigl_tracking_notification_policy
  VALIDATE CONSTRAINT gigl_tracking_notification_policy_notification_kind_check;
ALTER TABLE public.shipment_tracking_notification_outbox
  VALIDATE CONSTRAINT shipment_tracking_notification_outbox_notification_kind_check;
ALTER TABLE public.order_notification_outbox
  VALIDATE CONSTRAINT order_notification_outbox_event_type_check;
