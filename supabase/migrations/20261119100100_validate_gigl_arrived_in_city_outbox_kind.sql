-- Validate the outbox kind CHECK added NOT VALID by 20261119100000, in its own
-- transaction so the table scan runs without the DROP CONSTRAINT lock.
ALTER TABLE public.shipment_tracking_notification_outbox
  VALIDATE CONSTRAINT shipment_tracking_notification_outbox_notification_kind_check;
