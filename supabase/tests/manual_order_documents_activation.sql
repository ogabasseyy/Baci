BEGIN;
-- Activation and backfill: triggers ship disabled, the real
-- postdeploy enable migration fences the rollout window, enables the
-- triggers, then backfills it, and the window row is removed so later
-- suites keep a clean outbox.
-- Runs first; later suites reuse its committed enablement.
CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;
-- Mirror production's delegates boundary: authenticated callers have no
-- USAGE on schema private, so redemption must work through DEFINER wrappers.
REVOKE USAGE ON SCHEMA private FROM authenticated;
-- The enqueue triggers ship disabled so rows cannot enqueue while an older
-- cron binary is live; the enable step below mirrors the documented rollout.
SELECT pg_temp.assert_true((SELECT count(*) = 10 FROM pg_trigger WHERE tgname IN ('enqueue_manual_documents_after_items', 'enqueue_manual_documents_after_item_updates', 'enqueue_manual_documents_after_item_deletes', 'enqueue_manual_document_after_order_update', 'rearm_manual_documents_after_merchant_update', 'reset_manual_markers_after_tax_write', 'reset_manual_markers_after_transaction_write', 'reset_manual_markers_after_payment_account_write', 'reset_manual_markers_after_domain_write', 'reset_manual_markers_after_customer_delete') AND tgenabled = 'D'), 'enqueue triggers ship disabled');
-- An eligible order created while the triggers are disabled (the rollout
-- window) enqueues nothing until the enable step backfills it.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000009', 'Device', 1, 100);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000009'), 'disabled window enqueues nothing yet');
-- Apply the real postdeploy enable migration (not a copy): it fences the
-- window, enables all ten triggers BEFORE the backfill so gap writes
-- enqueue through the live triggers, then backfills the disabled window.
\ir ../migrations/20260930160300_enable_manual_order_document_triggers.sql
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox), 'enable step backfills exactly the window order');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000009' AND event_type = 'manual_order_receipt'), 'window order gets its receipt after enable');
-- The window case is proven; remove its rows so the suite below keeps its
-- empty-outbox precondition (and exact fence count) for global assertions.
DELETE FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000009';
DELETE FROM public.order_items WHERE order_id = '10000000-0000-4000-8000-000000000009';
DELETE FROM public.orders WHERE id = '10000000-0000-4000-8000-000000000009';
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.order_notification_outbox), 'window test leaves a clean outbox');
COMMIT;
-- Abort path: a gap past the 500-row burst fence fails loud with the
-- triggers still disabled and nothing mailed. The fence body mirrors
-- 20260930160300 (which orders fence, then enables, then backfill); the
-- rolled-back staging keeps later suites hermetic.
BEGIN;
ALTER TABLE public.order_items DISABLE TRIGGER enqueue_manual_documents_after_items;
ALTER TABLE public.order_items DISABLE TRIGGER enqueue_manual_documents_after_item_updates;
ALTER TABLE public.order_items DISABLE TRIGGER enqueue_manual_documents_after_item_deletes;
ALTER TABLE public.orders DISABLE TRIGGER enqueue_manual_document_after_order_update;
ALTER TABLE public.merchants DISABLE TRIGGER rearm_manual_documents_after_merchant_update;
ALTER TABLE public.customers DISABLE TRIGGER rearm_manual_documents_after_customer_restore;
ALTER TABLE public.order_tax_subtotals DISABLE TRIGGER reset_manual_markers_after_tax_write;
ALTER TABLE public.transactions DISABLE TRIGGER reset_manual_markers_after_transaction_write;
ALTER TABLE public.order_payment_accounts DISABLE TRIGGER reset_manual_markers_after_payment_account_write;
ALTER TABLE public.domains DISABLE TRIGGER reset_manual_markers_after_domain_write;
ALTER TABLE public.customers DISABLE TRIGGER reset_manual_markers_after_customer_delete;
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
SELECT gen_random_uuid(), '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'bulk@example.com', 'paid', 100
FROM generate_series(1, 501);
INSERT INTO public.order_items (order_id, name, quantity, price)
SELECT id, 'Device', 1, 100 FROM public.orders WHERE customer_email = 'bulk@example.com';
-- Import/marketplace rows carry the flag default but can never mail: the
-- fence must not count them toward the burst budget.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, import_job_id, customer_email, payment_status, amount_paid)
SELECT gen_random_uuid(), '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', gen_random_uuid(), 'imported@example.com', 'paid', 100
FROM generate_series(1, 3);
INSERT INTO public.order_items (order_id, name, quantity, price)
SELECT id, 'Device', 1, 100 FROM public.orders WHERE customer_email = 'imported@example.com';
-- Flagged rows the enqueue early-returns for must not consume the budget
-- either: blank recipient, cancelled shipment, itemless order, and a
-- payment label outside the receipt/invoice branches.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES
  (gen_random_uuid(), '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', '', 'paid', 100),
  (gen_random_uuid(), '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', '', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price)
SELECT id, 'Device', 1, 100 FROM public.orders WHERE customer_email = '';
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, shipping_status, payment_status, amount_paid)
VALUES
  (gen_random_uuid(), '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'cancelled@example.com', 'cancelled', 'paid', 100),
  (gen_random_uuid(), '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'cancelled@example.com', 'cancelled', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price)
SELECT id, 'Device', 1, 100 FROM public.orders WHERE customer_email = 'cancelled@example.com';
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES
  (gen_random_uuid(), '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'itemless@example.com', 'paid', 100),
  (gen_random_uuid(), '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'itemless@example.com', 'paid', 100);
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES
  (gen_random_uuid(), '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'voided@example.com', 'void', 0),
  (gen_random_uuid(), '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'voided@example.com', 'void', 0);
INSERT INTO public.order_items (order_id, name, quantity, price)
SELECT id, 'Device', 1, 100 FROM public.orders WHERE customer_email = 'voided@example.com';
DO $$
DECLARE
  v_scanned integer;
BEGIN
  SELECT count(*) INTO v_scanned FROM public.orders AS o
  WHERE o.manual_document_notification_eligible
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
    );
  IF v_scanned <> 501 THEN
    RAISE EXCEPTION 'FAIL: fence counted % rows, want 501 (3 import + 2 blank-email + 2 cancelled + 2 itemless + 2 void rows must be excluded)', v_scanned;
  END IF;
  IF v_scanned > 500 THEN
    RAISE EXCEPTION 'manual-order activation backfill scanned % eligible orders (budget 500)', v_scanned;
  END IF;
  RAISE EXCEPTION 'FAIL: burst fence did not trip on a 501-order gap';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'FAIL:%' THEN
    RAISE;
  END IF;
END
$$;
SELECT pg_temp.assert_true((SELECT count(*) = 11 FROM pg_trigger WHERE tgname IN ('enqueue_manual_documents_after_items', 'enqueue_manual_documents_after_item_updates', 'enqueue_manual_documents_after_item_deletes', 'enqueue_manual_document_after_order_update', 'rearm_manual_documents_after_merchant_update', 'rearm_manual_documents_after_customer_restore', 'reset_manual_markers_after_tax_write', 'reset_manual_markers_after_transaction_write', 'reset_manual_markers_after_payment_account_write', 'reset_manual_markers_after_domain_write', 'reset_manual_markers_after_customer_delete') AND tgenabled = 'D'), 'abort leaves all triggers disabled');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.order_notification_outbox WHERE order_id IN (SELECT id FROM public.orders WHERE customer_email = 'bulk@example.com')), 'abort mails nothing from the gap');
ROLLBACK;
