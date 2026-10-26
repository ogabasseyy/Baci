-- Enable the manual-order document triggers after the matching web revision
-- is live. This migration is deferred to the postdeploy phase (see
-- .github/scripts/deferred-production-migrations.sh): the deployer drains
-- the previous revision for 305s before applying it, so no old cron binary
-- with the all-or-nothing batch parser can claim a manual row.
--
-- The triggers enable LAST in this file, after the activation backfill:
-- an abort (burst fence or statement timeout) therefore leaves the
-- triggers disabled with nothing mailed, and a retry re-runs the whole
-- file cleanly (ENABLE TRIGGER is idempotent; the backfill anti-join
-- skips already-enqueued rows). Enabling is not retroactive, so the
-- backfill covers eligible orders created while the triggers were
-- disabled. Re-runnable: orders that already have a manual row are
-- skipped, and the enqueue function re-validates all eligibility. The
-- reported count is scanned orders, not enqueued rows: the void function
-- early-returns for ineligible orders but SELECT still emits one row per
-- scanned order.
-- Backfill: the eligible set is staff-recorded orders created while the
-- triggers were disabled (manual volume only — imports and marketplace
-- rows never set the flag), each a single enqueue call that early-returns
-- for ineligible rows. No batch LIMIT: this migration runs once, so a
-- capped scan would silently strand every row past the cap with no outbox
-- row and no future trigger fire. Cap the statement well under the 305s
-- deploy drain instead, so a pathological backlog fails the migration loud
-- (re-deploy retries the full scan) rather than stalling postdeploy; the
-- window holds minutes of manual volume, so the timeout is a backstop,
-- not an expected path. The NOT EXISTS anti-join keeps retries safe
-- under non-transactional appliers by skipping already-enqueued rows.
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
    -- Mirror the enqueue provenance triple below: a bare flag also matches
    -- imports/marketplace rows the enqueue early-returns for, so counting
    -- them would trip the fence on rows that can never mail.
    AND o.recorded_by_user_id IS NOT NULL
    AND o.import_job_id IS NULL
    AND nullif(btrim(COALESCE(o.external_source, '')), '') IS NULL
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
-- Session SET (not LOCAL): the applier may run statements outside an
-- explicit transaction, and RESET restores the default either way.
SET statement_timeout = '120s';
SELECT count(*) FROM (
  SELECT private.enqueue_manual_order_document(o.id)
  FROM public.orders AS o
  WHERE o.manual_document_notification_eligible
    -- Same provenance triple as the fence above: skip rows the enqueue
    -- early-returns for so the reported scan count matches callable rows.
    AND o.recorded_by_user_id IS NOT NULL
    AND o.import_job_id IS NULL
    AND nullif(btrim(COALESCE(o.external_source, '')), '') IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.order_notification_outbox AS n
      WHERE n.order_id = o.id
        AND n.event_type IN ('manual_order_invoice', 'manual_order_receipt')
    )
) AS scanned;
RESET statement_timeout;
-- Triggers enable only after the backfill succeeds (see header): an abort
-- above leaves them disabled, so a retry never double-mails and new rows
-- cannot enqueue until the catch-up is complete.
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
