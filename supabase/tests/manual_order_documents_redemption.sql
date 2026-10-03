-- Redemption-linking scenarios. Runs after manual_order_documents.sql in
-- the same psql session (see run-manual-order-document-tests.sh): it reuses
-- that script's enabled triggers plus its merchants, customers, and orders.
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;

-- A stale customers row does not strand a manual claim: the document went to
-- the order email as an attachment, so verified sign-in as that recipient
-- redeems even when the customer record disagrees. Import claims stay strict.
INSERT INTO public.customers (id, merchant_id, email) VALUES ('10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', 'stale@example.com');
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000010', 'fresh@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000013', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000013' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000013' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('f', 64))->>'status' = 'created'), 'manual claim created despite stale customers row');
UPDATE public.customers SET total_orders = 7, total_spent = 700 WHERE id = '10000000-0000-4000-8000-000000000012';
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000031', 'fresh@example.com', now(), null);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000031', true);
SELECT set_config('request.jwt.claims', '{"email":"fresh@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('f',64), 'web')->>'status' = 'ok', 'verified corrected recipient redeems manual claim');
RESET ROLE;
-- Identity-safe linking: the mismatched redeem links ONLY the claimed order
-- to the recipient's own row. The stranger's row keeps its NULL user, so its
-- other orders stay invisible through the customer-scoped archive.
SELECT pg_temp.assert_true((SELECT user_id IS NULL FROM public.customers WHERE id = '10000000-0000-4000-8000-000000000012'), 'mismatched redeem never reassigns the stranger row');
SELECT pg_temp.assert_true((SELECT user_id = '10000000-0000-4000-8000-000000000031' FROM public.customers WHERE merchant_id = '10000000-0000-4000-8000-000000000001' AND email = 'fresh@example.com'), 'recipient row links to the verified user');
SELECT pg_temp.assert_true((SELECT o.customer_id = (SELECT c.id FROM public.customers AS c WHERE c.merchant_id = '10000000-0000-4000-8000-000000000001' AND c.email = 'fresh@example.com') FROM public.orders AS o WHERE o.id = '10000000-0000-4000-8000-000000000013'), 'claimed order re-points at the recipient row');
SELECT pg_temp.assert_true((SELECT rc.customer_id = (SELECT o.customer_id FROM public.orders AS o WHERE o.id = '10000000-0000-4000-8000-000000000013') FROM public.receipt_claims AS rc WHERE rc.token_hash = repeat('f', 64)), 'claim follows the re-pointed order');
SELECT pg_temp.assert_true((SELECT total_orders = 0 AND total_spent = 0 FROM public.customers WHERE id = '10000000-0000-4000-8000-000000000012'), 'relink refreshes the previous customer aggregates');

-- A second recipient on the same stale row gets their own row and their own
-- order: row takeover is impossible because mismatched redeems never write
-- the stranger's row.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000010', 'second@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000016', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000016' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000016' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('1', 64))->>'status' = 'created'), 'second manual claim created for stale customer');
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000032', 'second@example.com', now(), null);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000032', true);
SELECT set_config('request.jwt.claims', '{"email":"second@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('1',64), 'web')->>'status' = 'ok', 'second recipient redeems into their own row');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT user_id IS NULL FROM public.customers WHERE id = '10000000-0000-4000-8000-000000000012'), 'stranger row still unlinked after two mismatched redeems');
SELECT pg_temp.assert_true((SELECT (SELECT customer_id FROM public.orders WHERE id = '10000000-0000-4000-8000-000000000016') IS DISTINCT FROM (SELECT customer_id FROM public.orders WHERE id = '10000000-0000-4000-8000-000000000013')), 'each recipient sees only their own order');

-- When the recipient's own row is already owned by a different auth user,
-- the mismatched redeem fails closed instead of taking it over.
INSERT INTO public.customers (id, merchant_id, user_id, email) VALUES ('10000000-0000-4000-8000-000000000022', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000048', 'taken@example.com');
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000010', 'taken@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000021', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000021' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000021' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('6', 64))->>'status' = 'created'), 'taken-address claim created');
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000033', 'taken@example.com', now(), null);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000033', true);
SELECT set_config('request.jwt.claims', '{"email":"taken@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('6',64), 'web')->>'status' = 'customer_link_failed', 'recipient row owned by another user fails closed');
RESET ROLE;

-- A verified recipient with an existing user-linked row under a different
-- email reuses it instead of violating the (merchant, user) uniqueness.
INSERT INTO public.customers (id, merchant_id, user_id, email) VALUES ('10000000-0000-4000-8000-000000000023', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000034', 'old@example.com');
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000024', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000010', 'newaddr@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000024', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000024' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000024' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('7', 64))->>'status' = 'created'), 'email-changed claim created');
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000034', 'newaddr@example.com', now(), null);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000034', true);
SELECT set_config('request.jwt.claims', '{"email":"newaddr@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('7',64), 'web')->>'status' = 'ok', 'existing user-linked row redeems without a second row');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT customer_id = '10000000-0000-4000-8000-000000000023' FROM public.orders WHERE id = '10000000-0000-4000-8000-000000000024'), 'claimed order links the existing user row');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.customers WHERE merchant_id = '10000000-0000-4000-8000-000000000001' AND email = 'newaddr@example.com'), 'no duplicate row created for the new email');

-- Sibling claims for the same order both redeem: the invoice claim is
-- created while unpaid, the receipt claim after payment, and the second
-- redeem accepts the order already sitting on the redeemer-linked row.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000028', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000010', 'sib@example.com', 'unpaid', 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000028', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000028' AND event_type = 'manual_order_invoice';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000028' AND event_type = 'manual_order_invoice'), 'm2-worker', repeat('8', 64))->>'status' = 'created'), 'sibling invoice claim created while unpaid');
UPDATE public.orders SET payment_status = 'paid', amount_paid = 100 WHERE id = '10000000-0000-4000-8000-000000000028';
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000028' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000028' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('0', 64))->>'status' = 'created'), 'sibling receipt claim created after payment');
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000035', 'sib@example.com', now(), null);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000035', true);
SELECT set_config('request.jwt.claims', '{"email":"sib@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('8',64), 'web')->>'status' = 'ok', 'first sibling redeems and moves the order');
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('0',64), 'web')->>'status' = 'ok', 'second sibling redeems against the moved order');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.receipt_claims AS rc WHERE rc.token_hash IN (repeat('8', 64), repeat('0', 64)) AND rc.customer_id = (SELECT o.customer_id FROM public.orders AS o WHERE o.id = '10000000-0000-4000-8000-000000000028')), 'sibling claims follow the moved order');

-- A verified user linked to a different row takes the order-scoped path
-- even when the claim row's email matches: the row-linking core would
-- assign the same user_id twice and violate the merchant/user uniqueness.
INSERT INTO public.customers (id, merchant_id, user_id, email) VALUES ('10000000-0000-4000-8000-000000000038', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000039', 'older@example.com');
INSERT INTO public.customers (id, merchant_id, email) VALUES ('10000000-0000-4000-8000-000000000037', '10000000-0000-4000-8000-000000000001', 'current@example.com');
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000040', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000037', '10000000-0000-4000-8000-000000000010', 'current@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000040', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000040' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000040' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('1f', 32))->>'status' = 'created'), 'matching-email claim created');
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000039', 'current@example.com', now(), null);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000039', true);
SELECT set_config('request.jwt.claims', '{"email":"current@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('1f',32), 'web')->>'status' = 'ok', 'matching email with linked row redeems via relinking');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT customer_id = '10000000-0000-4000-8000-000000000038' FROM public.orders WHERE id = '10000000-0000-4000-8000-000000000040'), 'claimed order links the existing user row');
