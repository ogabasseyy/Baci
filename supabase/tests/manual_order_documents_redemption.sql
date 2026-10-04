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
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000062', 'taken@example.com', now(), null);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000062', true);
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
-- A redeemed stale link must not kill the corrected retry: rotation adopts
-- the fresh token even after redemption (redemption serves live data and
-- links stay re-openable), preserving claimed_at for history.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000062', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000062', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000062' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000062' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('ca', 32))->>'status' = 'created'), 'redeem-probe claim created');
UPDATE public.receipt_claims SET claimed_at = now() WHERE token_hash = repeat('ca', 32);
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000062' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('cb', 32))->>'status' = 'created'), 'corrected retry rotates a redeemed claim');
SELECT pg_temp.assert_true((SELECT token_hash = repeat('cb', 32) AND claimed_at IS NOT NULL FROM public.receipt_claims WHERE manual_notification_id = (SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000062' AND event_type = 'manual_order_receipt')), 'rotation preserves redemption while adopting the fresh token');
-- Rotation to a corrected recipient clears the stale redemption: the fresh
-- link must not preview as already claimed for the new customer, and the
-- former recipient must not remain the claimant.
INSERT INTO public.customers (id, merchant_id, email) VALUES ('10000000-0000-4000-8000-000000000066', '10000000-0000-4000-8000-000000000001', 'corrected@example.com');
UPDATE public.orders SET customer_id = '10000000-0000-4000-8000-000000000066', customer_email = 'corrected@example.com' WHERE id = '10000000-0000-4000-8000-000000000062';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND locked_by IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000062' AND event_type = 'manual_order_receipt'), 'recipient correction re-arms the processing row');
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000062' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000062' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('cd', 32))->>'status' = 'created'), 'recipient correction rotates the redeemed claim');
SELECT pg_temp.assert_true((SELECT token_hash = repeat('cd', 32) AND claimed_at IS NULL AND claimed_by_user_id IS NULL AND customer_email = 'corrected@example.com' FROM public.receipt_claims WHERE manual_notification_id = (SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000062' AND event_type = 'manual_order_receipt')), 'rotation clears the stale redemption for the new recipient');
SELECT pg_temp.assert_true((SELECT previous_token_hash IS NULL AND delivered_token_hash IS NULL FROM public.receipt_claims WHERE manual_notification_id = (SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000062' AND event_type = 'manual_order_receipt')), 'recipient correction revokes historical hashes');
SELECT pg_temp.assert_true((SELECT public.preview_receipt_claim(repeat('cb', 32)) IS NULL), 'revoked hash no longer previews the new recipient');
SELECT public.record_receipt_claim_click_v2(repeat('cb', 32), 'web');
SELECT pg_temp.assert_true((SELECT click_count = 0 FROM public.receipt_claims WHERE token_hash = repeat('cd', 32)), 'revoked hash records no activity');
-- A retry rotation must not orphan the mailed link from the attempt before
-- it: the earlier send may have been accepted with an unknown outcome. The
-- replaced hash survives one rotation; redemption and preview honor it.
INSERT INTO public.customers (id, merchant_id, email) VALUES ('10000000-0000-4000-8000-000000000093', '10000000-0000-4000-8000-000000000001', 'grace@example.com');
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000092', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000093', '10000000-0000-4000-8000-000000000010', 'grace@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000092', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000092' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000092' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('d1', 32))->>'status' = 'created'), 'grace-probe claim created');
SELECT pg_temp.assert_true((SELECT previous_token_hash IS NULL FROM public.receipt_claims WHERE token_hash = repeat('d1', 32)), 'fresh claim carries no previous hash');
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000092' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('d2', 32))->>'status' = 'created'), 'retry rotates the grace-probe claim');
SELECT pg_temp.assert_true((SELECT token_hash = repeat('d2', 32) AND previous_token_hash = repeat('d1', 32) FROM public.receipt_claims WHERE manual_notification_id = (SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000092' AND event_type = 'manual_order_receipt')), 'rotation stashes the replaced hash');
SELECT pg_temp.assert_true((SELECT public.preview_receipt_claim(repeat('d1', 32)) IS NOT NULL), 'mailed link from before the rotation still previews');
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000094', 'grace@example.com', now(), null);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000094', true);
SELECT set_config('request.jwt.claims', '{"email":"grace@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('d1', 32), 'web')->>'status' = 'ok', 'graced previous hash redeems end to end');
RESET ROLE;
-- A second rotation shifts the grace window: the twice-superseded hash
-- falls off while the newest predecessor still works.
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000092' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('d3', 32))->>'status' = 'created'), 'second retry rotates the grace-probe claim again');
SELECT pg_temp.assert_true((SELECT token_hash = repeat('d3', 32) AND previous_token_hash = repeat('d2', 32) FROM public.receipt_claims WHERE manual_notification_id = (SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000092' AND event_type = 'manual_order_receipt')), 'second rotation shifts the grace window');
SELECT pg_temp.assert_true((SELECT public.preview_receipt_claim(repeat('d1', 32)) IS NULL), 'twice-superseded hash no longer previews');
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000094', true);
SELECT set_config('request.jwt.claims', '{"email":"grace@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('d1', 32), 'web')->>'status' = 'not_found', 'twice-superseded hash no longer redeems');
RESET ROLE;
-- Grace never bypasses expiry: the row expiry bounds both hashes.
UPDATE public.receipt_claims SET expires_at = now() - interval '1 day' WHERE token_hash = repeat('d3', 32);
SELECT pg_temp.assert_true((SELECT public.preview_receipt_claim(repeat('d2', 32))->>'expired' = 'true'), 'graced hash previews the expired sentinel once lapsed');
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000094', true);
SELECT set_config('request.jwt.claims', '{"email":"grace@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('d2', 32), 'web')->>'status' = 'expired', 'graced hash redeems expired once lapsed');
RESET ROLE;
UPDATE public.receipt_claims SET expires_at = now() + interval '90 days' WHERE token_hash = repeat('d3', 32);
-- Revocation beats grace on recipient change: the correction revoked
-- the historical hashes outright, so the old link resolves nothing
-- instead of failing closed on an email check against the new row.
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000095', 'buyer@example.com', now(), null);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000095', true);
SELECT set_config('request.jwt.claims', '{"email":"buyer@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('cb', 32), 'web')->>'status' = 'not_found', 'revoked hash redeems not_found after recipient correction');
RESET ROLE;
-- Delivered-token retention: an accepted mail's link survives rejected
-- corrective rotations that shift the grace window past it. Record d2 as
-- the mailed (accepted) hash, then rotate twice without delivery: d2 is
-- in neither current nor previous, yet still redeems via delivered.
SELECT public.mark_manual_document_claim_sent((SELECT id FROM public.receipt_claims WHERE manual_notification_id = (SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000092' AND event_type = 'manual_order_receipt')), '10000000-0000-4000-8000-000000000001', repeat('d2', 32));
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000092' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('d4', 32))->>'status' = 'created'), 'rejected corrective attempt rotates past the delivered hash');
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000092' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('d5', 32))->>'status' = 'created'), 'second rejected rotation shifts the grace window again');
SELECT pg_temp.assert_true((SELECT token_hash = repeat('d5', 32) AND previous_token_hash = repeat('d4', 32) AND delivered_token_hash = repeat('d2', 32) FROM public.receipt_claims WHERE manual_notification_id = (SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000092' AND event_type = 'manual_order_receipt')), 'rotation preserves the delivered hash while shifting grace');
SELECT pg_temp.assert_true((SELECT public.preview_receipt_claim(repeat('d2', 32)) IS NOT NULL), 'delivered hash previews past the grace window');
-- Activity recording resolves fallback hashes like preview and
-- redemption: the mailed link's funnel rows survive rotation.
SELECT public.record_receipt_claim_click_v2(repeat('d2', 32), 'app');
SELECT pg_temp.assert_true((SELECT last_click_source = 'app' FROM public.receipt_claims WHERE token_hash = repeat('d5', 32)), 'delivered hash records click activity');
SELECT public.record_receipt_claim_login_started_v2(repeat('d4', 32), 'app');
SELECT pg_temp.assert_true((SELECT last_login_started_source = 'app' FROM public.receipt_claims WHERE token_hash = repeat('d5', 32)), 'previous hash records login activity');
SELECT public.record_receipt_claim_app_download_clicked_v2(repeat('d2', 32), 'play_store');
SELECT pg_temp.assert_true((SELECT last_app_download_source = 'play_store' AND app_download_click_count = 1 FROM public.receipt_claims WHERE token_hash = repeat('d5', 32)), 'delivered hash records app-download activity');
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000094', true);
SELECT set_config('request.jwt.claims', '{"email":"grace@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('d2', 32), 'web')->>'status' = 'ok', 'delivered hash redeems past the grace window');
RESET ROLE;
-- A newer acceptance advances delivered: the superseded mail falls off
-- once its replacement is known-delivered.
SELECT public.mark_manual_document_claim_sent((SELECT id FROM public.receipt_claims WHERE manual_notification_id = (SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000092' AND event_type = 'manual_order_receipt')), '10000000-0000-4000-8000-000000000001', repeat('d5', 32));
SELECT pg_temp.assert_true((SELECT delivered_token_hash = repeat('d5', 32) FROM public.receipt_claims WHERE token_hash = repeat('d5', 32)), 'newer acceptance advances the delivered hash');
SELECT pg_temp.assert_true((SELECT public.preview_receipt_claim(repeat('d2', 32)) IS NULL), 'superseded delivered hash no longer previews');
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000094', true);
SELECT set_config('request.jwt.claims', '{"email":"grace@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('d2', 32), 'web')->>'status' = 'not_found', 'superseded delivered hash no longer redeems');
RESET ROLE;
-- Delivered retention respects the recipient check: ca survives only in
-- delivered after the 062 correction, so the old bearer still fails
-- closed instead of linking the new recipient's order.
SELECT public.mark_manual_document_claim_sent((SELECT id FROM public.receipt_claims WHERE manual_notification_id = (SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000062' AND event_type = 'manual_order_receipt')), '10000000-0000-4000-8000-000000000001', repeat('ca', 32));
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000095', true);
SELECT set_config('request.jwt.claims', '{"email":"buyer@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('ca', 32), 'web')->>'status' = 'email_mismatch', 'old bearer fails closed on the delivered hash after recipient correction');
RESET ROLE;
-- A case-variant claim email creates exactly one normalized customer row:
-- the miss path inserts the normalized redeemer email (never the raw
-- claim spelling), so the case-sensitive merchant/email unique index
-- dedupes instead of doubling the row.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000033', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000010', 'CaseUser@Example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000033', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000033' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000033' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('c4', 32))->>'status' = 'created'), 'case-variant claim created');
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000033', 'caseuser@example.com', now(), null);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000033', true);
SELECT set_config('request.jwt.claims', '{"email":"caseuser@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('c4', 32), 'web')->>'status' = 'ok', 'case-variant recipient redeems');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.customers WHERE merchant_id = '10000000-0000-4000-8000-000000000001' AND lower(btrim(email)) = 'caseuser@example.com'), 'case-variant redeem creates exactly one row');
SELECT pg_temp.assert_true((SELECT email = 'caseuser@example.com' FROM public.customers WHERE merchant_id = '10000000-0000-4000-8000-000000000001' AND lower(btrim(email)) = 'caseuser@example.com'), 'redeemed row stores the normalized email');
