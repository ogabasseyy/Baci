BEGIN;
CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, customer_name, order_number, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'Buyer', 'PAID', 'paid', 100);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.order_notification_outbox), 'no email before items are saved');
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES
('10000000-0000-4000-8000-000000000003', 'Device A', 1, 50),
('10000000-0000-4000-8000-000000000003', 'Device B', 1, 50);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE event_type = 'manual_order_receipt'), 'bulk items enqueue one receipt');
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000003', 'Extra', 1, 0);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE event_type = 'manual_order_receipt'), 'later items do not duplicate email');
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000099', 'Historical', 1, 100);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000099'), 'no historical backfill');

-- Unpaid/partial orders get invoices; storefront and imported orders stay out.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid, import_job_id) VALUES
('10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'unpaid', 0, null),
('10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', null, 'buyer@example.com', 'paid', 100, null),
('10000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'paid', 100, '10000000-0000-4000-8000-000000000020');
INSERT INTO public.order_items (order_id, name, quantity, price) SELECT id, 'Device', 1, 100 FROM public.orders WHERE id IN ('10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000006');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE event_type = 'manual_order_invoice'), 'unpaid invoice');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.order_notification_outbox WHERE order_id IN ('10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000006')), 'no storefront or imported duplicates');
UPDATE public.orders SET payment_status = 'paid', amount_paid = 100 WHERE id = '10000000-0000-4000-8000-000000000004';
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000004' AND event_type = 'manual_order_receipt'), 'later payment queues receipt');

-- Orders created without customer contact still send once staff correct it.
INSERT INTO public.orders (id, merchant_id, recorded_by_user_id, customer_name, order_number, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000010', 'Buyer', 'NOEMAIL', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000008', 'Device', 1, 100);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000008'), 'no email before customer contact exists');
UPDATE public.orders SET customer_id = '10000000-0000-4000-8000-000000000002', customer_email = 'buyer@example.com' WHERE id = '10000000-0000-4000-8000-000000000008';
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000008' AND event_type = 'manual_order_receipt'), 'corrected contact queues receipt');

-- A stale customers row must not strand a corrected order email: the claim
-- binds by customer identity and keeps the order's contact channel.
UPDATE public.orders SET customer_email = 'newbuyer@example.com' WHERE id = '10000000-0000-4000-8000-000000000008';
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000008'), 'correction does not duplicate the pending row');
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'worker-2', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000008' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000008' AND event_type = 'manual_order_receipt'), 'worker-2', repeat('e', 64))->>'status' = 'created'), 'stale customer email still creates the claim');
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000008' AND event_type = 'manual_order_receipt'), 'worker-2', repeat('e', 64))->>'customer_email' = 'newbuyer@example.com'), 'claim keeps the corrected order email');
SELECT pg_temp.assert_true((SELECT t.claim->>'order_total' = '100' AND t.claim->>'order_amount_paid' = '100' AND t.claim->>'order_item_count' = '1' AND t.claim->>'order_payment_status' = 'paid' FROM (SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000008' AND event_type = 'manual_order_receipt'), 'worker-2', repeat('e', 64)) AS claim) AS t), 'claim returns the validated order snapshot');

SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.claim_order_notification_outbox(integer,text)', 'EXECUTE'), 'customers cannot drain queue');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.create_manual_order_document_claim(uuid,text,text)', 'EXECUTE'), 'public cannot generate claims');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated', 'public.receipt_claims', 'SELECT'), 'claim hashes remain private');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'private.redeem_receipt_claim_v2(text,text)', 'EXECUTE'), 'old private core cannot bypass verification');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.create_manual_order_document_claim(uuid,text,text)', 'EXECUTE'), 'customers cannot create manual claims');

SELECT * FROM public.claim_order_notification_outbox(10, 'fixture-worker');
DO $$
DECLARE v_id uuid; v_result jsonb;
BEGIN
  SELECT id INTO v_id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000003';
  v_result := public.create_manual_order_document_claim(v_id, 'wrong-worker', repeat('a', 64));
  PERFORM pg_temp.assert_true(v_result->>'status' = 'skipped', 'lease owner enforced');
  v_result := public.create_manual_order_document_claim(v_id, 'fixture-worker', repeat('a', 64));
  PERFORM pg_temp.assert_true(v_result->>'status' = 'created', 'manual claim created without import job');
  PERFORM pg_temp.assert_true((SELECT count(*) = 1 FROM public.receipt_claim_orders WHERE receipt_claim_id = (v_result->>'claim_id')::uuid), 'claim links exact order');
  PERFORM pg_temp.assert_true(v_result->>'customer_email' = 'buyer@example.com', 'worker can check the current recipient');
  UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE id = v_id;
  PERFORM pg_temp.assert_true(public.create_manual_order_document_claim(v_id, 'fixture-worker', repeat('b',64))->>'status' = 'skipped', 'claim token cannot rotate after dispatch begins');
END $$;

INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000030', 'buyer@example.com', null, null);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000030', true);
SELECT set_config('request.jwt.claims', '{"email":"buyer@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('a',64), 'web')->>'status' = 'email_unverified', 'unverified email denied');
SELECT pg_temp.assert_true(public.redeem_receipt_claim(repeat('a',64))->>'status' = 'email_unverified', 'legacy public route also requires verified email');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT user_id IS NULL FROM public.customers WHERE id = '10000000-0000-4000-8000-000000000002'), 'unverified account cannot link customer');
UPDATE auth.users SET email_confirmed_at = now() WHERE id = '10000000-0000-4000-8000-000000000030';
UPDATE auth.users SET email = 'attacker@example.com' WHERE id = '10000000-0000-4000-8000-000000000030';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('a',64), 'web')->>'status' = 'email_mismatch', 'stale or spoofed JWT email denied');
RESET ROLE;
UPDATE auth.users SET email = 'buyer@example.com' WHERE id = '10000000-0000-4000-8000-000000000030';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('a',64), 'web')->>'status' = 'ok', 'verified owner can claim on website');
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('a',64), 'app')->>'status' = 'ok', 'same customer replay is harmless in app');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT user_id = '10000000-0000-4000-8000-000000000030' FROM public.customers WHERE id = '10000000-0000-4000-8000-000000000002'), 'linked receipt visible through customer identity');
UPDATE public.receipt_claims SET expires_at = now() - interval '1 second' WHERE token_hash = repeat('a',64);
SELECT pg_temp.assert_true(public.redeem_receipt_claim(repeat('a',64))->>'status' = 'expired', 'legacy route cannot bypass expiry');

-- An obsolete invoice and the later receipt each get an independent claim.
DO $$
DECLARE v_invoice uuid; v_receipt uuid;
BEGIN
  SELECT id INTO v_invoice FROM public.order_notification_outbox
  WHERE order_id = '10000000-0000-4000-8000-000000000004' AND event_type = 'manual_order_invoice';
  PERFORM pg_temp.assert_true(public.create_manual_order_document_claim(v_invoice, 'fixture-worker', repeat('c',64))->>'status' = 'skipped', 'obsolete unpaid invoice cannot be sent as a receipt');
  UPDATE public.order_notification_outbox SET status = 'skipped', locked_by = null, locked_at = null WHERE id = v_invoice;
  PERFORM public.claim_order_notification_outbox(10, 'fixture-worker');
  SELECT id INTO v_receipt FROM public.order_notification_outbox
  WHERE order_id = '10000000-0000-4000-8000-000000000004' AND event_type = 'manual_order_receipt';
  PERFORM pg_temp.assert_true(public.create_manual_order_document_claim(v_receipt, 'fixture-worker', repeat('d',64))->>'status' = 'created', 'receipt remains available after obsolete invoice');
END $$;

-- A failed item write rolls back the queue, too.
SAVEPOINT incomplete_manual_order;
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000007', 'Device', 1, 100);
ROLLBACK TO incomplete_manual_order;
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000007'), 'rolled-back order never sends an email');

-- Cross-tenant customer links are never usable, even under the background role.
INSERT INTO public.merchants (id, slug) VALUES ('20000000-0000-4000-8000-000000000001', 'other-shop');
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('20000000-0000-4000-8000-000000000003', 'Other Tenant Device', 1, 100);
SELECT * FROM public.claim_order_notification_outbox(10, 'fixture-worker');
SELECT pg_temp.assert_true(public.create_manual_order_document_claim(
  (SELECT id FROM public.order_notification_outbox WHERE order_id = '20000000-0000-4000-8000-000000000003'),
  'fixture-worker', repeat('e',64))->>'status' = 'skipped', 'cross-tenant customer rejected');

-- Retain the existing at-most-once behavior when a stale send might be accepted.
UPDATE public.order_notification_outbox SET locked_at = now() - interval '16 minutes'
WHERE order_id = '10000000-0000-4000-8000-000000000003';
SELECT * FROM public.claim_order_notification_outbox(10, 'next-worker');
SELECT pg_temp.assert_true((SELECT status = 'skipped' AND skip_reason = 'delivery_outcome_unknown'
  FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000003'), 'stale dispatched document never resends');

-- A total correction alone re-evaluates eligibility and re-queues a missing row.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'unpaid', 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000011', 'Device', 1, 100);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000011' AND event_type = 'manual_order_invoice'), 'unpaid order queues invoice');
DELETE FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000011';
UPDATE public.orders SET total = 250 WHERE id = '10000000-0000-4000-8000-000000000011';
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000011' AND event_type = 'manual_order_invoice'), 'total correction re-queues the missing invoice');

-- Late manual-marking transitions re-evaluate instead of silently never sending.
INSERT INTO public.orders (id, merchant_id, customer_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'buyer@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000014', 'Device', 1, 100);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000014'), 'unmarked order does not enqueue');
UPDATE public.orders SET recorded_by_user_id = '10000000-0000-4000-8000-000000000010' WHERE id = '10000000-0000-4000-8000-000000000014';
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000014' AND event_type = 'manual_order_receipt'), 'late manual marking queues receipt');

-- Terminal skipped/failed rows re-arm when a later correction re-triggers the
-- queue; sent and possibly-dispatched rows never do.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'unpaid', 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000015', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'skipped', skip_reason = 'paid_balance_outstanding', skipped_at = now(), attempt_count = 3 WHERE order_id = '10000000-0000-4000-8000-000000000015';
UPDATE public.orders SET total = 250 WHERE id = '10000000-0000-4000-8000-000000000015';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND attempt_count = 0 AND skip_reason IS NULL AND skipped_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000015'), 'skipped row re-arms on correction');
UPDATE public.order_notification_outbox SET status = 'failed', attempt_count = 5, last_error = 'boom' WHERE order_id = '10000000-0000-4000-8000-000000000015';
UPDATE public.orders SET total = 260 WHERE id = '10000000-0000-4000-8000-000000000015';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND attempt_count = 0 AND last_error IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000015'), 'failed row re-arms on correction');
UPDATE public.order_notification_outbox SET status = 'skipped', skip_reason = 'delivery_outcome_unknown', dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000015';
UPDATE public.orders SET total = 270 WHERE id = '10000000-0000-4000-8000-000000000015';
SELECT pg_temp.assert_true((SELECT status = 'skipped' FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000015'), 'unknown-outcome row never re-arms');
UPDATE public.order_notification_outbox SET status = 'sent', sent_at = now(), dispatch_started_at = NULL, skip_reason = NULL WHERE order_id = '10000000-0000-4000-8000-000000000015';
UPDATE public.orders SET total = 280 WHERE id = '10000000-0000-4000-8000-000000000015';
SELECT pg_temp.assert_true((SELECT status = 'sent' FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000015'), 'sent row never re-arms');

-- A stale customers row does not strand a manual claim: the document went to
-- the order email as an attachment, so verified sign-in as that recipient
-- redeems even when the customer record disagrees. Import claims stay strict.
INSERT INTO public.customers (id, merchant_id, email) VALUES ('10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', 'stale@example.com');
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000010', 'fresh@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000013', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000013' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000013' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('f', 64))->>'status' = 'created'), 'manual claim created despite stale customers row');
INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000031', 'fresh@example.com', now(), null);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000031', true);
SELECT set_config('request.jwt.claims', '{"email":"fresh@example.com"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(public.redeem_receipt_claim_v2(repeat('f',64), 'web')->>'status' = 'ok', 'verified corrected recipient redeems manual claim');
RESET ROLE;
ROLLBACK;
