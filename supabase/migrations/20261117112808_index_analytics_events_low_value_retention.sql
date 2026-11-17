-- disable-transaction
-- Build the partial retention index for low-value analytics events without blocking live writes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS analytics_events_low_value_retention_idx
  ON public.analytics_events ((COALESCE(event_timestamp, created_at)))
  WHERE event_type IN ('page_view', 'search');
