-- disable-transaction
-- Pre-create the live terminalization retry index without blocking writes.
DROP INDEX CONCURRENTLY IF EXISTS
  public.quiz_events_v2_live_terminal_retry_idx;

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  quiz_events_v2_live_terminal_retry_idx
  ON public.quiz_events(updated_at, ends_at)
  WHERE contract_version = 2
    AND mode = 'live'
    AND status IN ('active', 'scheduled')
    AND attempts_terminalized_at IS NULL
    AND finalization_error_code = 'live_attempt_terminalization_failed';
