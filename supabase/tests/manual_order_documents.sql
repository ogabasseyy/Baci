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
ROLLBACK;
