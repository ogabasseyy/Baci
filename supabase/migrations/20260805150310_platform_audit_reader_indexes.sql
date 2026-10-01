-- disable-transaction

-- The canonical audit table is already live. Build the platform reader's
-- indexes without blocking concurrent audit writes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_events_global_occurred_id
  ON public.audit_events (occurred_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_events_global_action_occurred_id
  ON public.audit_events (action, occurred_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_events_global_resource_type_occurred_id
  ON public.audit_events (resource_type, occurred_at DESC, id DESC);
