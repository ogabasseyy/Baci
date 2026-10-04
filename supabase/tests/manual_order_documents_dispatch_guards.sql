-- Dispatch-guard scenarios split from manual_order_documents_dispatch.sql
-- (300-line gate). Runs after it: the account-touch case reuses order
-- 017 and its selected 9990002222 virtual account, left in place by
-- the dispatch suite; the id-tie case brings its own order.

-- A no-op touch or non-rendered-column edit of the selected virtual
-- account keeps the marker: the rendered card is unchanged, so
-- resetting would duplicate an accepted send. Rendered-field edits
-- still reset.
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice';
UPDATE public.order_payment_accounts SET bank_name = bank_name WHERE order_id = '10000000-0000-4000-8000-000000000017' AND account_number = '9990002222';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice'), 'no-op account touch preserves the marker');
UPDATE public.order_payment_accounts SET expires_at = now() + interval '2 hours' WHERE order_id = '10000000-0000-4000-8000-000000000017' AND account_number = '9990002222';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice'), 'non-rendered account edit preserves the marker');
UPDATE public.order_payment_accounts SET bank_name = 'Renamed VA' WHERE order_id = '10000000-0000-4000-8000-000000000017' AND account_number = '9990002222';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice'), 'rendered account edit resets the marker');
UPDATE public.order_payment_accounts SET bank_name = 'Paystack-Titan', expires_at = NULL WHERE order_id = '10000000-0000-4000-8000-000000000017' AND account_number = '9990002222';

-- Fully tied virtual accounts (same provider rank, created_at, and
-- number, divergent metadata) resolve by row id descending like the
-- shared selector, so independently ordered result sets never pick
-- different rows and stale every dispatch mark.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000072', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'unpaid', 0);
INSERT INTO public.order_payment_accounts (id, order_id, account_number, bank_name, account_name, provider, expires_at, created_at) VALUES ('10000000-0000-4000-8000-000000000073', '10000000-0000-4000-8000-000000000072', '9990002222', 'Lower Bank', 'Shop Ltd/ORD72', 'paystack', NULL, '2026-09-30T10:00:00Z');
INSERT INTO public.order_payment_accounts (id, order_id, account_number, bank_name, account_name, provider, expires_at, created_at) VALUES ('10000000-0000-4000-8000-000000000074', '10000000-0000-4000-8000-000000000072', '9990002222', 'Higher Bank', 'Shop Ltd/ORD72', 'paystack', NULL, '2026-09-30T10:00:00Z');
SELECT pg_temp.assert_true((SELECT s.bank_name = 'Higher Bank' FROM private.manual_document_payment_account_snapshot('10000000-0000-4000-8000-000000000072') AS s), 'full account tie resolves by row id');
SELECT pg_temp.assert_true((SELECT private.manual_document_renders_payment_account('10000000-0000-4000-8000-000000000072', (SELECT o FROM public.order_payment_accounts AS o WHERE o.id = '10000000-0000-4000-8000-000000000074'))), 'tie winner renders payment instructions');
SELECT pg_temp.assert_true((SELECT NOT private.manual_document_renders_payment_account('10000000-0000-4000-8000-000000000072', (SELECT o FROM public.order_payment_accounts AS o WHERE o.id = '10000000-0000-4000-8000-000000000073'))), 'tie loser renders nothing');
-- A NULL-provider legacy account never outranks an eligible Paystack row:
-- the IS TRUE rank ties NULL with other non-Paystack providers (date
-- decides) like the shared selector, instead of sorting NULL first.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000078', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'unpaid', 0);
INSERT INTO public.order_payment_accounts (order_id, account_number, bank_name, account_name, provider, expires_at, created_at) VALUES ('10000000-0000-4000-8000-000000000078', '9990001111', 'Legacy Bank', 'Shop Ltd/ORD78', NULL, NULL, '2026-09-30T10:00:00Z');
INSERT INTO public.order_payment_accounts (order_id, account_number, bank_name, account_name, provider, expires_at, created_at) VALUES ('10000000-0000-4000-8000-000000000078', '9990002222', 'Paystack-Titan', 'Shop Ltd/ORD78', 'paystack', NULL, '2026-09-30T09:00:00Z');
SELECT pg_temp.assert_true((SELECT s.account_number = '9990002222' FROM private.manual_document_payment_account_snapshot('10000000-0000-4000-8000-000000000078') AS s), 'null provider loses to the older Paystack row');
-- A tax rewrite that moves no rendered field preserves the marker: the
-- no-op update and the unrendered exemption-code touch reset nothing,
-- so a post-acceptance admin save cannot schedule an identical duplicate.
INSERT INTO public.order_tax_subtotals (order_id, vat_category_code, vat_rate, taxable_amount, tax_amount, exemption_reason) VALUES ('10000000-0000-4000-8000-000000000017', 'S', 7.5, 100, 7.5, NULL);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice';
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice';
UPDATE public.order_tax_subtotals SET vat_rate = 7.5 WHERE order_id = '10000000-0000-4000-8000-000000000017';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice'), 'no-op tax rewrite preserves the marker');
UPDATE public.order_tax_subtotals SET exemption_reason_code = 'EDU' WHERE order_id = '10000000-0000-4000-8000-000000000017';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice'), 'unrendered tax column preserves the marker');
DELETE FROM public.order_tax_subtotals WHERE order_id = '10000000-0000-4000-8000-000000000017';
-- Only the primary brand color renders: an accent-only edit preserves the
-- marker, while a primary change still resets it.
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice';
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice';
UPDATE public.merchants SET brand_colors = '{"accent": "#ffffff"}'::jsonb WHERE id = '10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice'), 'accent-only brand edit preserves the marker');
UPDATE public.merchants SET brand_colors = '{"primary": "#000000"}'::jsonb WHERE id = '10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice'), 'primary brand edit resets the marker');
UPDATE public.merchants SET brand_colors = NULL WHERE id = '10000000-0000-4000-8000-000000000001';
-- bank_code never prints and the fallback card needs an account number:
-- a code-only edit preserves the invoice marker (no VA on this order,
-- so the fallback renders), while a bank-name edit still resets it.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000082', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'unpaid', 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000082', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000082' AND event_type = 'manual_order_invoice';
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000082' AND event_type = 'manual_order_invoice';
UPDATE public.merchants SET bank_code = '057' WHERE id = '10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000082' AND event_type = 'manual_order_invoice'), 'code-only bank edit preserves the marker');
UPDATE public.merchants SET bank_name = 'Renamed Fallback Bank' WHERE id = '10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000082' AND event_type = 'manual_order_invoice'), 'fallback bank-name edit resets the marker');
UPDATE public.merchants SET bank_code = '058', bank_name = 'GTBank' WHERE id = '10000000-0000-4000-8000-000000000001';
