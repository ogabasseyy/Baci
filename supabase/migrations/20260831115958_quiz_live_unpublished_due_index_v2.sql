-- disable-transaction
-- Pre-create the live publication backlog index without blocking writes.
DROP INDEX CONCURRENTLY IF EXISTS
  public.quiz_events_v2_live_unpublished_due_idx;

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  quiz_events_v2_live_unpublished_due_idx
  ON public.quiz_events(ends_at, updated_at)
  WHERE contract_version = 2
    AND mode = 'live'
    AND attempts_terminalized_at IS NOT NULL
    AND finalization_state IN ('pending', 'blocked')
    AND results_published_at IS NULL;
