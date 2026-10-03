-- Enable the manual-order document triggers after the matching web revision
-- is live. This migration is deferred to the postdeploy phase (see
-- .github/scripts/deferred-production-migrations.sh): the deployer drains
-- the previous revision for 305s before applying it, so no old cron binary
-- with the all-or-nothing batch parser can claim a manual row.
--
-- Enabling is not retroactive, so the same transaction backfills eligible
-- orders created while the triggers were disabled. Re-runnable: orders that
-- already have a manual row are skipped, and the enqueue function
-- re-validates all eligibility. The reported count is scanned orders, not
-- enqueued rows: the void function early-returns for ineligible orders but
-- SELECT still emits one row per scanned order.
ALTER TABLE public.order_items ENABLE TRIGGER enqueue_manual_documents_after_items;
ALTER TABLE public.order_items ENABLE TRIGGER enqueue_manual_documents_after_item_updates;
ALTER TABLE public.order_items ENABLE TRIGGER enqueue_manual_documents_after_item_deletes;
ALTER TABLE public.orders ENABLE TRIGGER enqueue_manual_document_after_order_update;
ALTER TABLE public.merchants ENABLE TRIGGER rearm_manual_documents_after_merchant_update;
ALTER TABLE public.order_tax_subtotals ENABLE TRIGGER reset_manual_markers_after_tax_write;
ALTER TABLE public.transactions ENABLE TRIGGER reset_manual_markers_after_transaction_write;
ALTER TABLE public.order_payment_accounts ENABLE TRIGGER reset_manual_markers_after_payment_account_write;
ALTER TABLE public.domains ENABLE TRIGGER reset_manual_markers_after_domain_write;
SELECT count(*) FROM (
  SELECT private.enqueue_manual_order_document(o.id)
  FROM public.orders AS o
  WHERE o.manual_document_notification_eligible
    AND NOT EXISTS (
      SELECT 1 FROM public.order_notification_outbox AS n
      WHERE n.order_id = o.id
        AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
    )
) AS scanned;
