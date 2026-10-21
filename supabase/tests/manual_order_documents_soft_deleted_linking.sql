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
-- A soft-deleted duplicate of the normalized email must not shadow the
-- live row through the order-scoped email fallback: the claim's own row is
-- stale here (staff corrected the recipient without re-linking), so the
-- fallback is the only path to the live row and picking the deleted
-- duplicate would fail the verified redeemer permanently.
INSERT INTO public.customers (id, merchant_id, email) VALUES ('10000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000001', 'shadowed@example.com');
INSERT INTO public.customers (id, merchant_id, email, deleted_at) VALUES ('10000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000001', 'Shadowed@Example.COM', now());
INSERT INTO public.customers (id, merchant_id, email) VALUES ('10000000-0000-4000-8000-000000000103', '10000000-0000-4000-8000-000000000001', 'stale-shadowed@example.com');
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000104', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000103', '10000000-0000-4000-8000-000000000010', 'shadowed@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000104', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000104' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000104' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('5f', 32))->>'status' = 'created'), 'shadowed-live-row order creates its claim');
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000105', 'shadowed@example.com', now(), null);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000105', true);
SELECT set_config('request.jwt.claims', '{"email":"shadowed@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('5f',32), 'web')->>'status' = 'ok', 'live row wins over soft-deleted duplicate');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT user_id = '10000000-0000-4000-8000-000000000105' FROM public.customers WHERE id = '10000000-0000-4000-8000-000000000101'), 'redeemer links the live row');
-- Soft-deleted customer rows stay invisible to the ownership-checked
-- document RPCs: a deleted-but-still-user-linked row must not leak tax
-- subtotals or payment-account rows after deletion.
INSERT INTO public.customers (id, merchant_id, email, user_id, deleted_at) VALUES ('10000000-0000-4000-8000-000000000114', '10000000-0000-4000-8000-000000000001', 'purged@example.com', '10000000-0000-4000-8000-000000000115', now());
INSERT INTO public.customers (id, merchant_id, email, user_id) VALUES ('10000000-0000-4000-8000-000000000117', '10000000-0000-4000-8000-000000000001', 'kept@example.com', '10000000-0000-4000-8000-000000000118');
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000116', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000114', '10000000-0000-4000-8000-000000000010', 'purged@example.com', 'paid', 100);
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000119', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000117', '10000000-0000-4000-8000-000000000010', 'kept@example.com', 'paid', 100);
INSERT INTO public.order_tax_subtotals (order_id, vat_category_code, vat_rate, taxable_amount, tax_amount) VALUES ('10000000-0000-4000-8000-000000000116', 'STD', 7.5, 100, 7.5);
INSERT INTO public.order_tax_subtotals (order_id, vat_category_code, vat_rate, taxable_amount, tax_amount) VALUES ('10000000-0000-4000-8000-000000000119', 'STD', 7.5, 100, 7.5);
INSERT INTO public.order_payment_accounts (order_id, account_number, bank_name, account_name, provider) VALUES ('10000000-0000-4000-8000-000000000116', '0123456789', 'GTBank', 'Shop', 'bank_transfer');
INSERT INTO public.order_payment_accounts (order_id, account_number, bank_name, account_name, provider) VALUES ('10000000-0000-4000-8000-000000000119', '0123456789', 'GTBank', 'Shop', 'bank_transfer');
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000115', 'purged@example.com', now(), null);
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000118', 'kept@example.com', now(), null);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000115', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.get_customer_order_tax_subtotals(ARRAY['10000000-0000-4000-8000-000000000116']::uuid[])), 'soft-deleted customer sees no tax subtotals');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.get_customer_order_payment_accounts(ARRAY['10000000-0000-4000-8000-000000000116']::uuid[])), 'soft-deleted customer sees no payment accounts');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000118', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.get_customer_order_tax_subtotals(ARRAY['10000000-0000-4000-8000-000000000119']::uuid[])), 'live customer still sees tax subtotals');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.get_customer_order_payment_accounts(ARRAY['10000000-0000-4000-8000-000000000119']::uuid[])), 'live customer still sees payment accounts');
RESET ROLE;
ROLLBACK;
