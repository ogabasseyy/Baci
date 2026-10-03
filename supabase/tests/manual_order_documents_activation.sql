BEGIN;
-- Activation and backfill: triggers ship disabled, the real
-- postdeploy enable migration backfills the rollout window, and
-- the window row is removed so later suites keep a clean outbox.
-- Runs first; later suites reuse its committed enablement.
CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;
-- Mirror production's delegates boundary: authenticated callers have no
-- USAGE on schema private, so redemption must work through DEFINER wrappers.
REVOKE USAGE ON SCHEMA private FROM authenticated;
-- The enqueue triggers ship disabled so rows cannot enqueue while an older
-- cron binary is live; the enable step below mirrors the documented rollout.
SELECT pg_temp.assert_true((SELECT count(*) = 9 FROM pg_trigger WHERE tgname IN ('enqueue_manual_documents_after_items', 'enqueue_manual_documents_after_item_updates', 'enqueue_manual_documents_after_item_deletes', 'enqueue_manual_document_after_order_update', 'rearm_manual_documents_after_merchant_update', 'reset_manual_markers_after_tax_write', 'reset_manual_markers_after_transaction_write', 'reset_manual_markers_after_payment_account_write', 'reset_manual_markers_after_domain_write') AND tgenabled = 'D'), 'enqueue triggers ship disabled');
-- An eligible order created while the triggers are disabled (the rollout
-- window) enqueues nothing until the enable step backfills it.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000009', 'Device', 1, 100);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000009'), 'disabled window enqueues nothing yet');
-- Apply the real postdeploy enable migration (not a copy): it enables all
-- nine triggers and backfills the window in one transaction.
\ir ../migrations/20260930160300_enable_manual_order_document_triggers.sql
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox), 'enable step backfills exactly the window order');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000009' AND event_type = 'manual_order_receipt'), 'window order gets its receipt after enable');
-- The window case is proven; remove its row so the suite below keeps its
-- empty-outbox precondition for global count assertions.
DELETE FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000009';
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.order_notification_outbox), 'window test leaves a clean outbox');
COMMIT;
