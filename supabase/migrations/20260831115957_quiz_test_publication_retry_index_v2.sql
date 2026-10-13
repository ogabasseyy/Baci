-- disable-transaction
-- Pre-create the test retry index without blocking quiz event writes.
DROP INDEX CONCURRENTLY IF EXISTS
  public.quiz_events_v2_test_publication_retry_idx;

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  quiz_events_v2_test_publication_retry_idx
  ON public.quiz_events(updated_at, ends_at)
  WHERE contract_version = 2
    AND mode = 'test'
    AND status IN ('active', 'scheduled')
    AND finalization_error_code = 'test_result_publication_failed';
