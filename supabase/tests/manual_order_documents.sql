BEGIN;
-- Runs after manual_order_documents_activation.sql: triggers are enabled
-- and the rollout window is backfilled and cleaned up there.
CREATE OR REPLACE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, customer_name, order_number, payment_status, amount_paid, created_at)
VALUES ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'Buyer', 'PAID', 'paid', 100, '2026-09-30T09:00:00Z');
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

-- A fully-covered balance is settled even under a non-paid label: the trigger
-- queues a receipt, never a zero-balance invoice.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000018', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'partially_paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000018', 'Device', 1, 100);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000018' AND event_type = 'manual_order_receipt'), 'covered partial queues receipt');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000018' AND event_type = 'manual_order_invoice'), 'covered partial queues no invoice');
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000018' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000018' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('4', 64))->>'status' = 'created'), 'covered partial receipt claim created');

-- A zero-total order owes nothing: even under an unpaid label it queues a
-- receipt, matching the sender and archive, never a $0 invoice.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, total, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000052', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'unpaid', 0, 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000052', 'Freebie', 1, 0);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000052' AND event_type = 'manual_order_receipt'), 'zero-total unpaid queues receipt');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000052' AND event_type = 'manual_order_invoice'), 'zero-total unpaid queues no invoice');

-- A payment that covers the balance without flipping the label re-arms the
-- receipt row and strands the earlier invoice row as a skip.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000019', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'unpaid', 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000019', 'Device', 1, 100);
UPDATE public.orders SET amount_paid = 100 WHERE id = '10000000-0000-4000-8000-000000000019';
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000019' AND event_type = 'manual_order_receipt'), 'covered balance without label flip queues receipt');
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000019';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000019' AND event_type = 'manual_order_invoice'), 'm2-worker', repeat('3', 64))->>'status' = 'skipped'), 'covered balance skips the stale invoice row');
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000019' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('2', 64))->>'status' = 'created'), 'covered balance creates the receipt row claim');

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
-- A correction after an unsent claim must adopt the new recipient, not
-- terminally skip: nothing went out and nobody linked yet.
UPDATE public.orders SET customer_email = 'final@example.com' WHERE id = '10000000-0000-4000-8000-000000000008';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000008' AND event_type = 'manual_order_receipt'), 'worker-2', repeat('5', 64))->>'status' = 'created'), 'unsent claim adopts the corrected recipient');
SELECT pg_temp.assert_true((SELECT customer_email = 'final@example.com' AND token_hash = repeat('5', 64) FROM public.receipt_claims WHERE manual_notification_id = (SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000008' AND event_type = 'manual_order_receipt')), 'adopted claim rotates token and email');
-- A stale-rejected send marks its claim notified before the worker
-- rejects it; the corrective retry must rotate the claim (storing the
-- new token its email embeds), not terminally skip. Claimed links
-- still never rotate.
UPDATE public.receipt_claims SET notification_sent_at = now() WHERE id = (SELECT id FROM public.receipt_claims WHERE manual_notification_id = (SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000008' AND event_type = 'manual_order_receipt'));
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000008' AND event_type = 'manual_order_receipt'), 'worker-2', repeat('ab', 32))->>'status' = 'created'), 'notified retry rotates the stale claim');
SELECT pg_temp.assert_true((SELECT token_hash = repeat('ab', 32) FROM public.receipt_claims WHERE id = (SELECT id FROM public.receipt_claims WHERE manual_notification_id = (SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000008' AND event_type = 'manual_order_receipt'))), 'rotation stores the retry token');
UPDATE public.receipt_claims SET claimed_at = now() WHERE id = (SELECT id FROM public.receipt_claims WHERE manual_notification_id = (SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000008' AND event_type = 'manual_order_receipt'));
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000008' AND event_type = 'manual_order_receipt'), 'worker-2', repeat('ba', 32))->>'status' = 'skipped'), 'claimed link never rotates');
-- An unpaid invoice-method order previews as the proforma the customer
-- received, not a commercial invoice.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid, payment_method, created_at)
VALUES ('10000000-0000-4000-8000-000000000017', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'unpaid', 0, 'invoice', '2026-09-30T10:00:00Z');
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000017', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice'), 'm2-worker', repeat('9', 64))->>'status' = 'created'), 'proforma order creates its claim');
SELECT pg_temp.assert_true((SELECT public.preview_receipt_claim(repeat('9', 64))->>'document_kind' = 'proforma_invoice'), 'unpaid invoice-method claim previews as proforma');
SELECT pg_temp.assert_true((SELECT public.mark_manual_document_dispatch_started((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice'), 'm2-worker', '10000000-0000-4000-8000-000000000002', 'buyer@example.com', NULL, NULL, 100, 0, 0, 0, 0, 0, 'NGN', NULL, 'unpaid', 'invoice', 'pending', NULL, NULL, NULL, NULL, NULL, NULL, '10000000-0000-4000-8000-000000000010', NULL, NULL, 'proforma_invoice', 1, (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', oi.id, 'name', oi.name, 'quantity', oi.quantity, 'price', oi.price, 'variant_name', oi.variant_name, 'condition', oi.condition, 'item_description', oi.item_description) ORDER BY oi.id), '[]'::jsonb) FROM public.order_items AS oi WHERE oi.order_id = '10000000-0000-4000-8000-000000000017'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, '[]'::jsonb, 0, '[]'::jsonb, 'Fixture', 'Fixture Ltd', '1 Market St', '{"city": "Lagos"}'::jsonb, 'RC123', 'TIN123', 'registered', 7.5, NULL, NULL, NULL, NULL, 'fixture', '2026-09-30T10:00:00Z')->>'status' = 'marked'), 'proforma dispatch marks with kind');
UPDATE public.orders SET payment_status = 'partially_paid', amount_paid = 50 WHERE id = '10000000-0000-4000-8000-000000000017';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice'), 'mid-flight payment resets the dispatch marker');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT public.preview_receipt_claim(repeat('9', 64))->>'document_kind' = 'invoice'), 'reset preview follows the live rule the retry will send');
RESET ROLE;
-- Legacy 'Partially Paid' (internal space) normalizes like the sender: a
-- zero-amount invoice-method order previews as invoice, not proforma.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid, payment_method, created_at)
VALUES ('10000000-0000-4000-8000-000000000054', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'Partially Paid', 0, 'invoice', '2026-09-30T10:00:00Z');
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000054', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000054' AND event_type = 'manual_order_invoice';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000054' AND event_type = 'manual_order_invoice'), 'm2-worker', repeat('c', 64))->>'status' = 'created'), 'spaced-status order creates its claim');
SELECT pg_temp.assert_true((SELECT public.preview_receipt_claim(repeat('c', 64))->>'document_kind' = 'invoice'), 'spaced Partially Paid previews as invoice');
SELECT pg_temp.assert_true((SELECT public.mark_manual_document_dispatch_started((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice'), 'm2-worker', '10000000-0000-4000-8000-000000000002', 'buyer@example.com', NULL, NULL, 100, 0, 0, 0, 0, 50, 'NGN', NULL, 'partially_paid', 'invoice', 'pending', NULL, NULL, NULL, NULL, NULL, NULL, '10000000-0000-4000-8000-000000000010', NULL, NULL, 'invoice', 1, (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', oi.id, 'name', oi.name, 'quantity', oi.quantity, 'price', oi.price, 'variant_name', oi.variant_name, 'condition', oi.condition, 'item_description', oi.item_description) ORDER BY oi.id), '[]'::jsonb) FROM public.order_items AS oi WHERE oi.order_id = '10000000-0000-4000-8000-000000000017'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, '[]'::jsonb, 0, '[]'::jsonb, 'Fixture', 'Fixture Ltd', '1 Market St', '{"city": "Lagos"}'::jsonb, 'RC123', 'TIN123', 'registered', 7.5, NULL, NULL, NULL, NULL, 'fixture', '2026-09-30T10:00:00Z')->>'status' = 'marked'), 'retry marks the fresh invoice snapshot');
-- A virtual account expiring inside the 15-minute delivery buffer is
-- excluded from the snapshot exactly like an expired one: the sender
-- never prints it, so the recheck must not expect it either.
UPDATE public.order_notification_outbox SET dispatch_started_at = NULL WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice';
INSERT INTO public.order_payment_accounts (order_id, account_number, bank_name, account_name, provider, expires_at, created_at) VALUES ('10000000-0000-4000-8000-000000000017', '9990004444', 'Paystack-Titan', 'Shop Ltd/ORD17-buffer', 'paystack', now() + interval '5 minutes', now());
SELECT pg_temp.assert_true((SELECT public.mark_manual_document_dispatch_started((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice'), 'm2-worker', '10000000-0000-4000-8000-000000000002', 'buyer@example.com', NULL, NULL, 100, 0, 0, 0, 0, 50, 'NGN', NULL, 'partially_paid', 'invoice', 'pending', NULL, NULL, NULL, NULL, NULL, NULL, '10000000-0000-4000-8000-000000000010', NULL, NULL, 'invoice', 1, (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', oi.id, 'name', oi.name, 'quantity', oi.quantity, 'price', oi.price, 'variant_name', oi.variant_name, 'condition', oi.condition, 'item_description', oi.item_description) ORDER BY oi.id), '[]'::jsonb) FROM public.order_items AS oi WHERE oi.order_id = '10000000-0000-4000-8000-000000000017'), NULL, NULL, NULL, NULL, '9990004444', 'Paystack-Titan', 'Shop Ltd/ORD17-buffer', 0, '[]'::jsonb, 0, '[]'::jsonb, 'Fixture', 'Fixture Ltd', '1 Market St', '{"city": "Lagos"}'::jsonb, 'RC123', 'TIN123', 'registered', 7.5, NULL, NULL, NULL, NULL, 'fixture', '2026-09-30T10:00:00Z')->>'status' = 'stale'), 'near-expiry virtual account stays out of the snapshot');
SELECT pg_temp.assert_true((SELECT public.mark_manual_document_dispatch_started((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice'), 'm2-worker', '10000000-0000-4000-8000-000000000002', 'buyer@example.com', NULL, NULL, 100, 0, 0, 0, 0, 50, 'NGN', NULL, 'partially_paid', 'invoice', 'pending', NULL, NULL, NULL, NULL, NULL, NULL, '10000000-0000-4000-8000-000000000010', NULL, NULL, 'invoice', 1, (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', oi.id, 'name', oi.name, 'quantity', oi.quantity, 'price', oi.price, 'variant_name', oi.variant_name, 'condition', oi.condition, 'item_description', oi.item_description) ORDER BY oi.id), '[]'::jsonb) FROM public.order_items AS oi WHERE oi.order_id = '10000000-0000-4000-8000-000000000017'), NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, '[]'::jsonb, 0, '[]'::jsonb, 'Fixture', 'Fixture Ltd', '1 Market St', '{"city": "Lagos"}'::jsonb, 'RC123', 'TIN123', 'registered', 7.5, NULL, NULL, NULL, NULL, 'fixture', '2026-09-30T10:00:00Z')->>'status' = 'marked'), 'buffered invoice marks without the near-expiry account');
DELETE FROM public.order_payment_accounts WHERE order_id = '10000000-0000-4000-8000-000000000017' AND account_number = '9990004444';
UPDATE public.order_notification_outbox SET status = 'sent' WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice';
UPDATE public.orders SET amount_paid = 100 WHERE id = '10000000-0000-4000-8000-000000000017';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true((SELECT public.preview_receipt_claim(repeat('9', 64))->>'document_kind' = 'invoice'), 'completed send keeps the sent preview across later payments');
RESET ROLE;
-- Restore the mid-flight state the dispatch snapshot tests below expect:
-- a processing row with the partial-payment snapshot.
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000017' AND event_type = 'manual_order_invoice';
UPDATE public.orders SET amount_paid = 50 WHERE id = '10000000-0000-4000-8000-000000000017';

SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.claim_order_notification_outbox(integer,text)', 'EXECUTE'), 'customers cannot drain queue');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.create_manual_order_document_claim(uuid,text,text)', 'EXECUTE'), 'public cannot generate claims');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated', 'public.receipt_claims', 'SELECT'), 'claim hashes remain private');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'private.redeem_receipt_claim_v2(text,text)', 'EXECUTE'), 'old private core cannot bypass verification');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.create_manual_order_document_claim(uuid,text,text)', 'EXECUTE'), 'customers cannot create manual claims');
SELECT pg_temp.assert_true(has_function_privilege('anon', 'private.preview_receipt_claim(text)', 'EXECUTE'), 'logged-out previews can execute');
SELECT pg_temp.assert_true(has_function_privilege('authenticated', 'private.preview_receipt_claim(text)', 'EXECUTE'), 'signed-in previews can execute');

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

-- Legacy shipping-status spellings stay terminal: enqueue and claim both normalize before comparing.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid, shipping_status)
VALUES ('10000000-0000-4000-8000-000000000027', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'paid', 100, 'Cancelled');
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000027', 'Device', 1, 100);
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000027'), 'legacy capitalized status never enqueues');
UPDATE public.orders SET shipping_status = '  CANCELED  ' WHERE id = '10000000-0000-4000-8000-000000000027';
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000027'), 'padded uppercase status never enqueues');
UPDATE public.orders SET shipping_status = 'pending' WHERE id = '10000000-0000-4000-8000-000000000027';
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000027' AND event_type = 'manual_order_receipt'), 'corrected status queues the receipt');
-- Legacy payment-status spellings queue like their normalized values.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000029', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'PAID', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000029', 'Device', 1, 100);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000029' AND event_type = 'manual_order_receipt'), 'legacy capitalized payment queues receipt');
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000029' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000029' AND event_type = 'manual_order_receipt'), 'm2-worker', repeat('0f', 32))->>'status' = 'created'), 'legacy capitalized payment creates its claim');
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000036', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', '  UNPAID  ', 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000036', 'Device', 1, 100);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000036' AND event_type = 'manual_order_invoice'), 'padded uppercase payment queues invoice');
-- Internal whitespace folds like the storefront: a spaced legacy status
-- queues instead of silently dropping the email.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000041', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'Partially Paid', 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000041', 'Device', 1, 100);
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000041' AND event_type = 'manual_order_invoice'), 'spaced legacy payment queues invoice');
-- Blank sources are absent, not imported: the email queues either way.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid, external_source)
VALUES ('10000000-0000-4000-8000-000000000042', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'paid', 100, ''),
('10000000-0000-4000-8000-000000000043', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'paid', 100, '   ');
INSERT INTO public.order_items (order_id, name, quantity, price) SELECT id, 'Device', 1, 100 FROM public.orders WHERE id IN ('10000000-0000-4000-8000-000000000042', '10000000-0000-4000-8000-000000000043');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000042' AND event_type = 'manual_order_receipt'), 'empty source queues receipt');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000043' AND event_type = 'manual_order_receipt'), 'whitespace source queues receipt');
-- An expired claim previews as a non-sensitive sentinel, even through a
-- direct RPC call: the loader keeps its 410 contract, details stay hidden.
UPDATE public.receipt_claims SET expires_at = now() - interval '1 second' WHERE token_hash = repeat('9', 64);
SELECT pg_temp.assert_true((SELECT public.preview_receipt_claim(repeat('9', 64))->>'expired' = 'true'), 'expired manual claim previews as expired');
SELECT pg_temp.assert_true((SELECT public.preview_receipt_claim(repeat('9', 64))->>'customer_email' IS NULL AND public.preview_receipt_claim(repeat('9', 64))->>'orders' IS NULL), 'expired preview hides claim details');
-- Commit, not rollback: the database is disposable (dropped after the run),
-- and the redemption/dispatch script reuses this state (enabled triggers,
-- merchants, customers, orders) in the same session.
COMMIT;
