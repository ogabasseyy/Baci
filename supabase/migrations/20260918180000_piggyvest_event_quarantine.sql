-- Durable quarantine for authentic PiggyVest deliveries that must never
-- touch financial state: unparseable bodies, unknown event shapes, and
-- same-identity conflicting observations.
--
-- Quarantine is a receipt, not a loss: the route acknowledges (2xx) only
-- after this row exists, so the provider does not burn retries on events
-- that retries cannot fix. Rows carry digests and redacted detail only —
-- never raw bodies (inflow payloads contain bank account numbers/names).
-- Manual review replays or resolves them; see event-quarantine.ts.
--
-- NOTE (18 Sep 2026): numeric types are intentionally UNQUOTED. Quoted
-- "bigint"/"integer" aliases fail on real PostgreSQL (type "bigint" does
-- not exist); the inbox/outbox migrations received the same correction
-- under owner approval.

CREATE TABLE IF NOT EXISTS public.piggyvest_event_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NULL,
  event_type text NULL,
  body_digest text NOT NULL,
  reason text NOT NULL
    CONSTRAINT piggyvest_event_quarantine_reason_check
    CHECK (reason IN ('unparseable', 'unknown-event', 'conflict')),
  detail jsonb NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  resolution text NULL,
  CONSTRAINT piggyvest_event_quarantine_digest_key UNIQUE (body_digest)
);

-- Service-role only: intake/worker use the admin client. Enabling RLS
-- with no policy denies all anon/authenticated access by default.
ALTER TABLE public.piggyvest_event_quarantine ENABLE ROW LEVEL SECURITY;

-- Least-privilege grants for the service role (mirrors the inbox lease
-- grants): full-row reads for review, inserts for intake, and updates
-- limited to the manual-resolution columns. No DELETE/TRUNCATE.
REVOKE ALL ON TABLE public.piggyvest_event_quarantine
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.piggyvest_event_quarantine TO service_role;
GRANT INSERT (event_id, event_type, body_digest, reason, detail)
  ON TABLE public.piggyvest_event_quarantine TO service_role;
GRANT UPDATE (resolved_at, resolution)
  ON TABLE public.piggyvest_event_quarantine TO service_role;

COMMENT ON TABLE public.piggyvest_event_quarantine IS
  'Quarantined authentic PiggyVest deliveries: digests and redacted detail only, never raw bodies.';
