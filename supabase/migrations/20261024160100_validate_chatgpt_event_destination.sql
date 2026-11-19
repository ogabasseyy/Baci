-- Validate after the widening transaction has committed. This scan uses a
-- SHARE UPDATE EXCLUSIVE lock rather than retaining the earlier ACCESS
-- EXCLUSIVE lock, allowing normal queue writes/claims/finishes to continue.
ALTER TABLE public.event_deliveries VALIDATE CONSTRAINT event_deliveries_destination_check;
