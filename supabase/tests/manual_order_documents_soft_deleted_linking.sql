-- Soft-deleted customer-linking scenarios. Runs after
-- manual_order_documents_redemption_dispatch.sql in the same psql
-- session and transaction (see run-manual-order-document-tests.sh):
-- it reuses that script's customers (notably ...012) and closes the
-- transaction with ROLLBACK.
-- A soft-deleted row still holds its user_id under the unique index: linking
-- a different row must fail closed instead of 500ing on conflict.
INSERT INTO public.customers (id, merchant_id, email) VALUES ('10000000-0000-4000-8000-000000000047', '10000000-0000-4000-8000-000000000001', 'fresh2@example.com');
INSERT INTO public.customers (id, merchant_id, email, user_id, deleted_at) VALUES ('10000000-0000-4000-8000-000000000044', '10000000-0000-4000-8000-000000000001', 'gone@example.com', '10000000-0000-4000-8000-000000000045', now());
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000046', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000047', '10000000-0000-4000-8000-000000000010', 'fresh2@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000046', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000046' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000046' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('3f', 32))->>'status' = 'created'), 'soft-deleted-link order creates its claim');
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000045', 'fresh2@example.com', now(), null);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000045', true);
SELECT set_config('request.jwt.claims', '{"email":"fresh2@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('3f',32), 'web')->>'status' = 'customer_link_failed', 'soft-deleted link fails closed');
RESET ROLE;
-- The order-scoped mismatch path fails the same way: the redeemer is
-- verified under a corrected address while only a deleted row holds them.
INSERT INTO public.customers (id, merchant_id, email, user_id, deleted_at) VALUES ('10000000-0000-4000-8000-000000000051', '10000000-0000-4000-8000-000000000001', 'dead@example.com', '10000000-0000-4000-8000-000000000050', now());
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000049', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000010', 'mismatch@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000049', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000049' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000049' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('4f', 32))->>'status' = 'created'), 'mismatched soft-deleted-link order creates its claim');
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000050', 'mismatch@example.com', now(), null);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000050', true);
SELECT set_config('request.jwt.claims', '{"email":"mismatch@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('4f',32), 'web')->>'status' = 'customer_link_failed', 'mismatched soft-deleted link fails closed');
RESET ROLE;
-- A soft-delete landing after dispatch started aborts the in-flight send:
-- the customer-delete trigger clears the stuck processing marker instead
-- of leaving a claim whose redemption immediately fails closed.
INSERT INTO public.customers (id, merchant_id, email) VALUES ('10000000-0000-4000-8000-000000000063', '10000000-0000-4000-8000-000000000001', 'midflight@example.com');
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000064', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000063', '10000000-0000-4000-8000-000000000010', 'midflight@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000064', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', dispatch_started_at = now(), locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000064' AND event_type = 'manual_order_receipt';
UPDATE public.customers SET deleted_at = now() WHERE id = '10000000-0000-4000-8000-000000000063';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000064' AND event_type = 'manual_order_receipt'), 'mid-dispatch soft-delete clears the marker');
SELECT pg_temp.assert_true((SELECT status = 'processing' FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000064' AND event_type = 'manual_order_receipt'), 'mid-dispatch soft-delete never re-arms');
-- A merchant reassignment landing after dispatch started aborts the same
-- way: redemption requires the customer and claim merchant IDs to match,
-- so the customer trigger clears the marker instead of emailing an
-- immediately-unredeemable link. Never re-arms (reassignment suppresses).
INSERT INTO public.merchants (id, user_id, slug, business_name, email) VALUES ('10000000-0000-4000-8000-000000000079', '10000000-0000-4000-8000-000000000010', 'second', 'Second', 'second@example.com');
INSERT INTO public.customers (id, merchant_id, email) VALUES ('10000000-0000-4000-8000-000000000080', '10000000-0000-4000-8000-000000000001', 'reassigned@example.com');
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000081', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000080', '10000000-0000-4000-8000-000000000010', 'reassigned@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000081', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000081' AND event_type = 'manual_order_receipt';
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000081' AND event_type = 'manual_order_receipt';
UPDATE public.customers SET merchant_id = '10000000-0000-4000-8000-000000000079' WHERE id = '10000000-0000-4000-8000-000000000080';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000081' AND event_type = 'manual_order_receipt'), 'mid-dispatch reassignment clears the marker');
SELECT pg_temp.assert_true((SELECT status = 'processing' FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000081' AND event_type = 'manual_order_receipt'), 'mid-dispatch reassignment never re-arms');
ROLLBACK;
