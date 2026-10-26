-- Enable the manual-order document triggers after the matching web revision
-- is live. This migration is deferred to the postdeploy phase (see
-- .github/scripts/deferred-production-migrations.sh): the deployer drains
-- the previous revision for 305s before applying it, so no old cron binary
-- with the all-or-nothing batch parser can claim a manual row.
--
-- Ordering inside this file is load-bearing:
-- 1. The burst fence runs FIRST, so an abort leaves the triggers disabled
--    with nothing mailed, and a retry re-runs the whole file cleanly.
-- 2. The triggers enable BEFORE the backfill scan. There is then no
--    concurrent-write gap to fence: staff writes committed between the
--    fence and the scan enqueue through the now-live triggers, and the
--    backfill's NOT EXISTS anti-join skips those rows when the scan
--    reaches them. No catch-up resweep is needed — every gap write fires
--    a trigger while the scan only ever sees trigger-covered rows.
-- 3. The backfill covers eligible orders created while the triggers were
--    disabled. It re-validates the full enqueue eligibility inline (see
--    below), so the reported scan count matches callable rows and the
--    fence cannot trip on rows the enqueue would early-return for.
-- Re-runnable: orders that already have a manual row are skipped, ENABLE
-- TRIGGER is idempotent, and the enqueue function re-validates everything.
-- Backfill eligibility mirrors private.enqueue_manual_order_document's
-- early returns exactly (provenance triple + contact + shippable +
-- has-items + payable): the fence and the scan must count the callable
-- set, not the flag set. A bare manual_document_notification_eligible flag
-- also matches imports/marketplace rows, contactless rows, cancelled
-- shipments, itemless rows, and unpayable statuses the enqueue skips, so
-- counting them would trip the fence on rows that can never mail and the
-- documented manual-split recovery could never clear that backlog.
-- No batch LIMIT: this migration runs once, so a capped scan would silently
-- strand every row past the cap with no outbox row and no future trigger
-- fire. Cap the statement well under the 305s deploy drain instead, so a
-- pathological backlog fails the migration loud (re-deploy retries the full
-- scan) rather than stalling postdeploy; the window holds minutes of manual
-- volume, so the timeout is a backstop, not an expected path. The NOT EXISTS
-- anti-join keeps retries safe under non-transactional appliers by skipping
-- already-enqueued rows.
-- Burst fence: a long predeploy-to-postdeploy gap would mail the whole
-- gap's manual volume at activation. Fail loud past a scan size no
-- minutes-long deploy window can legitimately reach — single-row enqueue
-- calls run orders of magnitude faster than this budget inside the 120s
-- statement timeout below — so the operator splits the catch-up manually
-- instead of burst-mailing it. Nothing is silently dropped: exceeding the
-- budget aborts the migration for an explicit operator decision, and the
-- NOT EXISTS anti-join keeps the manual retry safe.
DO $$
DECLARE
  v_scanned integer;
BEGIN
  SELECT count(*) INTO v_scanned FROM public.orders AS o
  WHERE o.manual_document_notification_eligible
    -- Provenance triple: staff-recorded, never imported, no marketplace
    -- source. Mirrors the enqueue early returns.
    AND o.recorded_by_user_id IS NOT NULL
    AND o.import_job_id IS NULL
    AND nullif(btrim(COALESCE(o.external_source, '')), '') IS NULL
    -- Customer link: customerless rows never enqueue (the FK guarantees a
    -- linked id references a real customer record).
    AND o.customer_id IS NOT NULL
    -- Contactable recipient: blank customer_email early-returns.
    AND nullif(btrim(COALESCE(o.customer_email, '')), '') IS NOT NULL
    -- Shippable: cancelled/returned/failed shipments early-return.
    AND lower(btrim(COALESCE(o.shipping_status, '')))
      NOT IN ('cancelled', 'canceled', 'returned', 'failed')
    -- Has items: itemless orders early-return.
    AND EXISTS (SELECT 1 FROM public.order_items AS oi WHERE oi.order_id = o.id)
    -- Payable: mirrors the enqueue receipt/invoice branch exactly — a
    -- fully-covered balance queues the receipt, an unpaid/pending/partial
    -- label queues the invoice, anything else early-returns. NULL
    -- amount_paid behaves like the plpgsql IF (falls to the label check).
    AND ((o.amount_paid >= o.total
        AND regexp_replace(
          lower(btrim(COALESCE(o.payment_status, ''))), '\s+', '_', 'g')
          IN ('paid', 'unpaid', 'pending', 'partially_paid'))
      OR regexp_replace(
          lower(btrim(COALESCE(o.payment_status, ''))), '\s+', '_', 'g')
        IN ('unpaid', 'pending', 'partially_paid'))
    AND NOT EXISTS (
      SELECT 1 FROM public.order_notification_outbox AS n
      WHERE n.order_id = o.id
        AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
    );
  IF v_scanned > 500 THEN
    RAISE EXCEPTION 'manual-order activation backfill scanned % eligible orders (budget 500): keep the predeploy-to-postdeploy gap minutes-long or split the catch-up manually before enabling triggers', v_scanned;
  END IF;
END
$$;
-- Triggers enable BEFORE the backfill (see header): with triggers live,
-- gap writes enqueue themselves and the backfill anti-join skips them, so
-- the scan-to-activation handoff cannot strand new orders. An abort above
-- still leaves them disabled, so a retry never double-mails.
ALTER TABLE public.order_items ENABLE TRIGGER enqueue_manual_documents_after_items;
ALTER TABLE public.order_items ENABLE TRIGGER enqueue_manual_documents_after_item_updates;
ALTER TABLE public.order_items ENABLE TRIGGER enqueue_manual_documents_after_item_deletes;
ALTER TABLE public.orders ENABLE TRIGGER enqueue_manual_document_after_order_update;
ALTER TABLE public.merchants ENABLE TRIGGER rearm_manual_documents_after_merchant_update;
ALTER TABLE public.customers ENABLE TRIGGER rearm_manual_documents_after_customer_restore;
ALTER TABLE public.order_tax_subtotals ENABLE TRIGGER reset_manual_markers_after_tax_write;
ALTER TABLE public.transactions ENABLE TRIGGER reset_manual_markers_after_transaction_write;
ALTER TABLE public.order_payment_accounts ENABLE TRIGGER reset_manual_markers_after_payment_account_write;
ALTER TABLE public.domains ENABLE TRIGGER reset_manual_markers_after_domain_write;
ALTER TABLE public.customers ENABLE TRIGGER reset_manual_markers_after_customer_delete;
-- Session SET (not LOCAL): the applier may run statements outside an
-- explicit transaction, and RESET restores the default either way.
SET statement_timeout = '120s';
SELECT count(*) FROM (
  SELECT private.enqueue_manual_order_document(o.id)
  FROM public.orders AS o
  WHERE o.manual_document_notification_eligible
    -- Same full enqueue mirror as the fence above: scan only callable rows.
    AND o.recorded_by_user_id IS NOT NULL
    AND o.import_job_id IS NULL
    AND nullif(btrim(COALESCE(o.external_source, '')), '') IS NULL
    AND o.customer_id IS NOT NULL
    AND nullif(btrim(COALESCE(o.customer_email, '')), '') IS NOT NULL
    AND lower(btrim(COALESCE(o.shipping_status, '')))
      NOT IN ('cancelled', 'canceled', 'returned', 'failed')
    AND EXISTS (SELECT 1 FROM public.order_items AS oi WHERE oi.order_id = o.id)
    AND ((o.amount_paid >= o.total
        AND regexp_replace(
          lower(btrim(COALESCE(o.payment_status, ''))), '\s+', '_', 'g')
          IN ('paid', 'unpaid', 'pending', 'partially_paid'))
      OR regexp_replace(
          lower(btrim(COALESCE(o.payment_status, ''))), '\s+', '_', 'g')
        IN ('unpaid', 'pending', 'partially_paid'))
    AND NOT EXISTS (
      SELECT 1 FROM public.order_notification_outbox AS n
      WHERE n.order_id = o.id
        AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
    )
) AS scanned;
RESET statement_timeout;
