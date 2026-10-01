-- Settlement notification retry scheduling. Definitive provider
-- rejections used to leave rows settled-and-unnotified, so a bounded
-- oldest-first queue of permanently failing rows pinned the daily
-- run and newer merchants' notifications never sent. Rejections now
-- bump notification_attempts and defer notification_next_retry_at
-- with backoff; the queue query skips rows past the attempt cap so
-- operations can dead-letter them out of band. ADD COLUMN with a
-- default is metadata-only; the partial index covers the queue
-- filter.
ALTER TABLE public.merchant_settlements
  ADD COLUMN IF NOT EXISTS notification_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.merchant_settlements
  ADD COLUMN IF NOT EXISTS notification_next_retry_at timestamptz;
CREATE INDEX IF NOT EXISTS merchant_settlements_notification_queue_idx
  ON public.merchant_settlements (notification_next_retry_at)
  WHERE status = 'settled' AND settlement_notified = false;
