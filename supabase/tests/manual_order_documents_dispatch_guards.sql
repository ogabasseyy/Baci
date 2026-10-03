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
