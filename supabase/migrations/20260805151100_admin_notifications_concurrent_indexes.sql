-- disable-transaction
-- These indexes target active notification tables. Build them concurrently so
-- the repair migration does not take an avoidable write-blocking table lock.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_admin_dashboard
  ON public.notifications (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_scheduled_delivery
  ON public.notifications (scheduled_for)
  WHERE sent_at IS NULL AND scheduled_for IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchant_notifications_notification_delivery
  ON public.merchant_notifications (notification_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_due_delivery_state
  ON public.notifications (scheduled_for)
  WHERE sent_at IS NULL
    AND delivery_state = 'pending'
    AND scheduled_for IS NOT NULL;
