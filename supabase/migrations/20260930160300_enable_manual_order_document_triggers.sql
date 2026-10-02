-- Enable the manual-order document triggers after the matching web revision
-- is live. This migration is deferred to the postdeploy phase (see
-- .github/scripts/deferred-production-migrations.sh): the deployer drains
-- the previous revision for 305s before applying it, so no old cron binary
-- with the all-or-nothing batch parser can claim a manual row.
--
-- Enabling is not retroactive, so the same transaction backfills eligible
-- orders created while the triggers were disabled. Re-runnable: orders that
-- already have a manual row are skipped, and the enqueue function
-- re-validates all eligibility.
ALTER TABLE public.order_items ENABLE TRIGGER enqueue_manual_documents_after_items;
ALTER TABLE public.order_items ENABLE TRIGGER enqueue_manual_documents_after_item_updates;
ALTER TABLE public.order_items ENABLE TRIGGER enqueue_manual_documents_after_item_deletes;
ALTER TABLE public.orders ENABLE TRIGGER enqueue_manual_document_after_order_update;
ALTER TABLE public.merchants ENABLE TRIGGER rearm_manual_documents_after_merchant_update;
SELECT count(*) FROM (
  SELECT private.enqueue_manual_order_document(o.id)
  FROM public.orders AS o
  WHERE o.manual_document_notification_eligible
    AND NOT EXISTS (
      SELECT 1 FROM public.order_notification_outbox AS n
      WHERE n.order_id = o.id
        AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
    )
) AS backfilled;
