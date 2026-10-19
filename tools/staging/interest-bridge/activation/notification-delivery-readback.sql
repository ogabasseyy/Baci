BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL search_path = pg_catalog;

DO $$
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' OR session_user <> 'postgres'
    OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> '7685292944002592802'
    OR (SELECT count(*) FROM public.customers customer JOIN public.customer_savings_goals goal
      ON goal.customer_id = customer.id AND goal.merchant_id = customer.merchant_id
      WHERE customer.id = '10000000-0000-4000-8000-000000000002'
        AND customer.merchant_id = '10000000-0000-4000-8000-000000000001'
        AND customer.deleted_at IS NULL AND customer.user_id IS NOT NULL
        AND goal.id = '430314fd-cd8b-4579-98d4-e9f345713dd6') <> 1 THEN
    RAISE EXCEPTION 'notification readback identity refused' USING ERRCODE = '42501';
  END IF;
END $$;

WITH target AS (
  SELECT '10000000-0000-4000-8000-000000000001'::uuid AS merchant_id,
    '10000000-0000-4000-8000-000000000002'::uuid AS customer_id,
    '430314fd-cd8b-4579-98d4-e9f345713dd6'::uuid AS goal_id
), scoped_events AS (
  SELECT event.id, event.read_at, event.voided_at, event.push_expanded_at
  FROM savings_notifications.events event, target
  WHERE event.merchant_id = target.merchant_id AND event.customer_id = target.customer_id
    AND event.goal_id = target.goal_id
), scoped_deliveries AS (
  SELECT delivery.status, delivery.claimed_at, delivery.ticket_id IS NOT NULL AS has_ticket,
    CASE WHEN delivery.receipt_error IN ('DeviceNotRegistered', 'MessageTooBig',
      'MessageRateExceeded', 'MismatchSenderId', 'InvalidCredentials')
      THEN delivery.receipt_error ELSE 'OtherReceiptError' END AS receipt_category
  FROM savings_notifications.deliveries delivery
  JOIN scoped_events event ON event.id = delivery.notification_id
), scoped_tokens AS (
  SELECT token.is_active, token.token ~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' AS valid_format
  FROM public.push_tokens token JOIN public.customers customer ON customer.user_id = token.user_id, target
  WHERE customer.id = target.customer_id AND customer.merchant_id = target.merchant_id
    AND customer.deleted_at IS NULL AND token.merchant_id = target.merchant_id AND token.app_type = 'storefront'
), outcome_counts AS (
  SELECT CASE status
    WHEN 'pending' THEN 'pending_dispatch' WHEN 'dispatching' THEN 'dispatching'
    WHEN 'accepted' THEN 'accepted_pending_receipt' WHEN 'provider_confirmed' THEN 'provider_confirmed'
    WHEN 'receipt_failed' THEN 'receipt_failed' WHEN 'receipt_unknown' THEN 'receipt_unknown'
    WHEN 'rejected' THEN 'rejected_reason_not_retained' WHEN 'unknown' THEN 'dispatch_outcome_unknown'
    WHEN 'suppressed' THEN 'suppressed' ELSE 'other_status' END AS category, count(*) AS status_count
  FROM scoped_deliveries GROUP BY category
), receipt_counts AS (
  SELECT receipt_category, count(*) AS error_count FROM scoped_deliveries
  WHERE status = 'receipt_failed' GROUP BY receipt_category
), inbox AS (
  SELECT event.read_at FROM savings_notifications.events event, target
  WHERE event.merchant_id = target.merchant_id AND event.customer_id = target.customer_id AND event.voided_at IS NULL
  ORDER BY event.created_at DESC, event.id LIMIT 100
)
SELECT jsonb_build_object(
  'readOnly', current_setting('transaction_read_only') = 'on',
  'scopedEventCount', (SELECT count(*) FROM scoped_events),
  'voidedEventCount', (SELECT count(*) FROM scoped_events WHERE voided_at IS NOT NULL),
  'unexpandedEventCount', (SELECT count(*) FROM scoped_events WHERE push_expanded_at IS NULL AND voided_at IS NULL),
  'expandedWithoutDeliveryCount', (SELECT count(*) FROM scoped_events event WHERE event.push_expanded_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM savings_notifications.deliveries delivery WHERE delivery.notification_id = event.id)),
  'currentlyEligibleTokenCount', (SELECT count(*) FROM scoped_tokens WHERE is_active AND valid_format),
  'noCurrentlyEligibleToken', NOT EXISTS (SELECT 1 FROM scoped_tokens WHERE is_active AND valid_format),
  'activeInvalidFormatTokenCount', (SELECT count(*) FROM scoped_tokens WHERE is_active AND NOT valid_format),
  'inactiveTokenCount', (SELECT count(*) FROM scoped_tokens WHERE NOT is_active),
  'scopedDeliveryCount', (SELECT coalesce(sum(status_count), 0) FROM outcome_counts),
  'deliveryCategories', (SELECT coalesce(jsonb_object_agg(category, status_count), '{}'::jsonb) FROM outcome_counts),
  'receiptFailureCategories', (SELECT coalesce(jsonb_object_agg(receipt_category, error_count), '{}'::jsonb) FROM receipt_counts),
  'acceptedMissingTicketCount', (SELECT count(*) FROM scoped_deliveries WHERE status = 'accepted' AND NOT has_ticket),
  'acceptedReceiptDueCount', (SELECT count(*) FROM scoped_deliveries WHERE status = 'accepted' AND has_ticket
    AND claimed_at <= now() - interval '15 minutes' AND claimed_at >= now() - interval '24 hours'),
  'acceptedReceiptOverdueCount', (SELECT count(*) FROM scoped_deliveries WHERE status = 'accepted'
    AND claimed_at < now() - interval '24 hours'),
  'authenticatedInboxExpectedCount', (SELECT count(*) FROM inbox),
  'authenticatedInboxExpectedUnreadCount', (SELECT count(*) FROM inbox WHERE read_at IS NULL),
  'principalKobo', (SELECT coalesce(sum(posting.amount_kobo), 0) FROM piggyvest_savings_ledger.postings posting
    JOIN piggyvest_savings_ledger.operations operation ON operation.id = posting.operation_id, target
    WHERE operation.goal_id = target.goal_id AND operation.customer_id = target.customer_id
      AND operation.merchant_id = target.merchant_id AND posting.account IN ('principal', 'purchase_principal', 'refund_principal')),
  'deviceDeliveryVerified', false, 'providerCallsMade', false, 'servicesStarted', false
);

ROLLBACK;
