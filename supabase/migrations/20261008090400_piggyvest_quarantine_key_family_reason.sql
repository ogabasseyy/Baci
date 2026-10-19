-- Allow quarantining deliveries signed by a key family that is not
-- authorized for legacy handling. The webhook union gate accepts every
-- configured family so rotation never strands a signed delivery, but only
-- the legacy secret may drive legacy ledger writes; any other family that
-- no specialized intake claims is quarantined here for manual review
-- instead of mutating unrelated financial state.
BEGIN;
ALTER TABLE public.piggyvest_event_quarantine
  DROP CONSTRAINT piggyvest_event_quarantine_reason_check;
ALTER TABLE public.piggyvest_event_quarantine
  ADD CONSTRAINT piggyvest_event_quarantine_reason_check
  CHECK (reason IN ('unparseable', 'unknown-event', 'conflict', 'key-family'));
COMMIT;
