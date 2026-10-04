-- Redemption-relink + round-trip scenarios split from
-- manual_order_documents_dispatch.sql (300-line gate). Runs after it in
-- the same session/transaction; the relink probe brings its own order
-- (057) and the equality asserts touch no tables, so no state handoff.
-- A redemption relink racing provider acceptance must not invalidate the
-- accepted send: customer_id is not rendered, so the trusted relink keeps
-- the in-flight marker while staff-driven customer changes still reset it.
INSERT INTO public.customers (id, merchant_id, email) VALUES ('10000000-0000-4000-8000-000000000058', '10000000-0000-4000-8000-000000000001', 'stale58@example.com');
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000057', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000058', '10000000-0000-4000-8000-000000000010', 'fresh58@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000057', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000057' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000057' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('e', 64))->>'status' = 'created'), 'relink probe claim created');
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000059', 'fresh58@example.com', now(), null);
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000057' AND event_type = 'manual_order_receipt';
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000059', true);
SELECT set_config('request.jwt.claims', '{"email":"fresh58@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('e',64), 'web')->>'status' = 'ok', 'relink probe redeems through the order-scoped path');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000057' AND event_type = 'manual_order_receipt'), 'trusted relink keeps the in-flight marker');
UPDATE public.orders SET customer_id = '10000000-0000-4000-8000-000000000058' WHERE id = '10000000-0000-4000-8000-000000000057';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000057' AND event_type = 'manual_order_receipt'), 'staff customer change resets the marker');
-- Fulfillment-only item writes keep the marker; VAT-only edits keep the
-- receipt marker (VAT columns print on invoices alone); both-kind edits
-- reset it.
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000003' AND event_type = 'manual_order_receipt';
UPDATE public.order_items SET fulfillment_data = '{"courier":"DHL"}'::jsonb WHERE order_id = '10000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000003' AND event_type = 'manual_order_receipt'), 'fulfillment-only item update keeps the marker');
UPDATE public.order_items SET vat_rate = 7.5 WHERE order_id = '10000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000003' AND event_type = 'manual_order_receipt'), 'VAT-only item edit keeps the receipt marker');
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000003' AND event_type = 'manual_order_receipt';
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000003' AND event_type = 'manual_order_receipt';
UPDATE public.order_items SET price = 101 WHERE order_id = '10000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000003' AND event_type = 'manual_order_receipt'), 'both-kind item edit resets the marker');
UPDATE public.order_items SET price = 100 WHERE order_id = '10000000-0000-4000-8000-000000000003';
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000003' AND event_type = 'manual_order_receipt';
-- Webhook metadata enrichment keeps the marker (only payment_method is
-- rendered); a payment_method correction resets it.
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000003' AND event_type = 'manual_order_receipt';
UPDATE public.transactions SET metadata = '{"payment_method": "bank_transfer", "webhook_id": "wh_123"}'::jsonb WHERE id = '10000000-0000-4000-8000-000000000b01';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000003' AND event_type = 'manual_order_receipt'), 'metadata enrichment keeps the marker');
UPDATE public.transactions SET metadata = '{"payment_method": "card", "webhook_id": "wh_123"}'::jsonb WHERE id = '10000000-0000-4000-8000-000000000b01';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000003' AND event_type = 'manual_order_receipt'), 'payment_method correction resets the marker');
UPDATE public.transactions SET metadata = '{"payment_method": "bank_transfer"}'::jsonb WHERE id = '10000000-0000-4000-8000-000000000b01';
-- Guard-semantics proof for the sent-merge optimistic guard (no live
-- PostgREST in this repo to round-trip against): PostgREST casts `eq`
-- operands to the column type, so jsonb equality ignores key order and
-- timestamptz equality compares instants regardless of text formatting.
SELECT pg_temp.assert_true('{"b":2,"a":{"d":4,"c":3}}'::jsonb = '{"a":{"c":3,"d":4},"b":2}'::jsonb, 'jsonb equality ignores key order');
SELECT pg_temp.assert_true('2026-10-03T00:00:00Z'::timestamptz = '2026-10-03 00:00:00.000000+00'::timestamptz, 'timestamptz equality compares instants, not text');
