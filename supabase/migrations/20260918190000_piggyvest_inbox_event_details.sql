-- Additive replay support for the webhook inbox (18 Sep 2026).
--
-- The original inbox stores envelope fields only, so a crash between the
-- inbox record and the ledger write loses the event details needed for a
-- worker replay. This migration adds an optional REDACTED detail column;
-- it does not change any existing column. Raw bodies (bank account
-- numbers/names) must never be stored here — the route persists only the
-- allowlisted projection built by event-redaction.ts. Unknown shapes store
-- NULL details and go to quarantine digest-only instead.

ALTER TABLE public.piggyvest_webhook_inbox
  ADD COLUMN IF NOT EXISTS event_details jsonb NULL;

COMMENT ON COLUMN public.piggyvest_webhook_inbox.event_details IS
  'Redacted event detail projection for worker replay. Never raw bodies.';
