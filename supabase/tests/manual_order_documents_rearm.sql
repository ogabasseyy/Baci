-- Re-arm scenarios: terminal skipped/failed rows return to pending when a
-- later correction re-triggers the queue; sent and possibly-dispatched
-- rows never do. Runs after manual_order_documents.sql in the same
-- database (see run-manual-order-document-tests.sh).

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

-- Item corrections re-arm like order corrections: an UPDATE unblocks a
-- stale/failed dispatch, while sent rows stay terminal.
UPDATE public.order_notification_outbox SET status = 'failed', attempt_count = 5, last_error = 'stale items', sent_at = NULL, dispatch_started_at = NULL, skip_reason = NULL WHERE order_id = '10000000-0000-4000-8000-000000000015';
UPDATE public.order_items SET price = 101 WHERE order_id = '10000000-0000-4000-8000-000000000015';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND attempt_count = 0 AND last_error IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000015'), 'failed row re-arms on item correction');
UPDATE public.order_notification_outbox SET status = 'sent', sent_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000015';
UPDATE public.order_items SET price = 102 WHERE order_id = '10000000-0000-4000-8000-000000000015';
SELECT pg_temp.assert_true((SELECT status = 'sent' FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000015'), 'sent row ignores item edits');
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000015', 'Bad line', 0, 50);
UPDATE public.order_notification_outbox SET status = 'failed', attempt_count = 5, last_error = 'order_validation_failed', sent_at = NULL, dispatch_started_at = NULL, skip_reason = NULL WHERE order_id = '10000000-0000-4000-8000-000000000015';
DELETE FROM public.order_items WHERE order_id = '10000000-0000-4000-8000-000000000015' AND name = 'Bad line';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND attempt_count = 0 AND last_error IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000015'), 'failed row re-arms on invalid line removal');
-- Moving a line between orders re-enqueues both sides: the source loses a
-- rendered line and the destination gains one.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000060', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'unpaid', 0);
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000061', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'unpaid', 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000060', 'Device', 1, 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000060', 'Widget', 1, 25);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000061', 'Accessory', 1, 50);
UPDATE public.order_notification_outbox SET status = 'failed', attempt_count = 5, last_error = 'order_validation_failed' WHERE order_id IN ('10000000-0000-4000-8000-000000000060', '10000000-0000-4000-8000-000000000061');
UPDATE public.order_items SET order_id = '10000000-0000-4000-8000-000000000061' WHERE order_id = '10000000-0000-4000-8000-000000000060' AND name = 'Device';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND attempt_count = 0 AND last_error IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000060'), 'moved line re-enqueues the source order');
SELECT pg_temp.assert_true((SELECT status = 'pending' AND attempt_count = 0 AND last_error IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000061'), 'moved line re-enqueues the destination order');
-- A move that empties the source still invalidates its in-flight send; the
-- itemless source just does not re-queue until its item batch lands.
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now(), dispatch_started_at = now(), attempt_count = 1, last_error = NULL WHERE order_id = '10000000-0000-4000-8000-000000000060';
UPDATE public.order_notification_outbox SET status = 'failed', attempt_count = 5, last_error = 'order_validation_failed' WHERE order_id = '10000000-0000-4000-8000-000000000061';
UPDATE public.order_items SET order_id = '10000000-0000-4000-8000-000000000061' WHERE order_id = '10000000-0000-4000-8000-000000000060' AND name = 'Widget';
SELECT pg_temp.assert_true((SELECT status = 'processing' AND dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000060'), 'emptying move invalidates the source send without re-queueing');
SELECT pg_temp.assert_true((SELECT status = 'pending' AND attempt_count = 0 AND last_error IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000061'), 'emptying move still re-enqueues the destination order');

-- Completing a merchant profile re-arms rows skipped as merchant_validation_failed.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000025', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'unpaid', 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000025', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'skipped', skip_reason = 'merchant_validation_failed', skipped_at = now(), attempt_count = 2 WHERE order_id = '10000000-0000-4000-8000-000000000025';
UPDATE public.merchants SET vat_rate = 10 WHERE id = '10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND attempt_count = 0 AND skip_reason IS NULL AND skipped_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000025'), 'merchant correction re-arms the skipped row');
-- The skipped-row re-arm gates on validation inputs only: an unrelated
-- profile edit must not burn an attempt on a re-validation that cannot
-- change. (Undispatched processing rows still re-arm on any merchant
-- edit — the worker may have snapshotted a rendered field already.)
UPDATE public.order_notification_outbox SET status = 'skipped', skip_reason = 'merchant_validation_failed', skipped_at = now(), attempt_count = 2 WHERE order_id = '10000000-0000-4000-8000-000000000025';
UPDATE public.merchants SET business_name = 'Fixture Fixed' WHERE id = '10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT status = 'skipped' AND skip_reason = 'merchant_validation_failed' FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000025'), 'unrelated merchant edit leaves the skipped row alone');
UPDATE public.order_notification_outbox SET status = 'skipped', skip_reason = 'ineligible_manual_order', skipped_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000025';
UPDATE public.merchants SET vat_rate = 7.5, business_name = 'Fixture' WHERE id = '10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT status = 'skipped' FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000025'), 'merchant update leaves other skip reasons alone');
-- A monetary or order-number correction alone re-arms a terminal row the worker gave up on.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000026', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'unpaid', 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000026', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'failed', attempt_count = 5, last_error = 'order_validation_failed' WHERE order_id = '10000000-0000-4000-8000-000000000026';
UPDATE public.orders SET shipping_fee = -5 WHERE id = '10000000-0000-4000-8000-000000000026';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND attempt_count = 0 AND last_error IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000026'), 'monetary correction re-arms the failed row');
UPDATE public.order_notification_outbox SET status = 'failed', attempt_count = 5, last_error = 'order_validation_failed' WHERE order_id = '10000000-0000-4000-8000-000000000026';
UPDATE public.orders SET order_number = 'ORD-FIXED' WHERE id = '10000000-0000-4000-8000-000000000026';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND attempt_count = 0 AND last_error IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000026'), 'order number correction re-arms the failed row');
-- A creation-date correction re-arms a row skipped as order_validation_failed: the schema rejects a missing date, so without this the corrected document is permanently lost.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid, created_at)
VALUES ('10000000-0000-4000-8000-000000000053', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'unpaid', 0, NULL);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000053', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'skipped', skip_reason = 'order_validation_failed', skipped_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000053';
UPDATE public.orders SET created_at = '2026-09-30T11:00:00Z' WHERE id = '10000000-0000-4000-8000-000000000053';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND skip_reason IS NULL AND skipped_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000053'), 'creation-date correction re-arms the skipped row');
-- Restoring a soft-deleted customer re-arms rows skipped as
-- document_claim_unavailable; the delete alone re-arms nothing.
INSERT INTO public.customers (id, merchant_id, email) VALUES ('10000000-0000-4000-8000-000000000055', '10000000-0000-4000-8000-000000000001', 'restored@example.com');
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000056', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000055', '10000000-0000-4000-8000-000000000010', 'restored@example.com', 'unpaid', 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000056', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'skipped', skip_reason = 'document_claim_unavailable', skipped_at = now(), attempt_count = 2 WHERE order_id = '10000000-0000-4000-8000-000000000056';
UPDATE public.customers SET deleted_at = now() WHERE id = '10000000-0000-4000-8000-000000000055';
SELECT pg_temp.assert_true((SELECT status = 'skipped' FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000056'), 'customer delete alone leaves the skipped row alone');
UPDATE public.customers SET deleted_at = NULL WHERE id = '10000000-0000-4000-8000-000000000055';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND attempt_count = 0 AND skip_reason IS NULL AND skipped_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000056'), 'customer restore re-arms the skipped row');
-- A restore racing the claim read re-arms the undispatched processing row
-- too, like the merchant and child paths: without this the worker records
-- a terminal skip from its stale document_claim_unavailable decision.
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000056';
UPDATE public.customers SET deleted_at = now() WHERE id = '10000000-0000-4000-8000-000000000055';
UPDATE public.customers SET deleted_at = NULL WHERE id = '10000000-0000-4000-8000-000000000055';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND locked_by IS NULL AND locked_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000056'), 'customer restore re-arms the undispatched processing row');
-- A correction landing while a worker holds the row re-arms it: without
-- this the worker records a terminal skip from its stale read and the
-- correction is permanently suppressed. Dispatch-started rows stay put.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000067', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'unpaid', 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000067', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000067' AND event_type = 'manual_order_invoice';
UPDATE public.orders SET notes = 'corrected' WHERE id = '10000000-0000-4000-8000-000000000067';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND locked_by IS NULL AND locked_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000067' AND event_type = 'manual_order_invoice'), 'mid-flight correction re-arms the processing row');
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000067' AND event_type = 'manual_order_invoice';
-- Split from the claim: the dispatch-boundary trigger clears the marker on
-- any status transition, so the marker must land in its own update.
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000067' AND event_type = 'manual_order_invoice';
UPDATE public.orders SET notes = 'corrected again' WHERE id = '10000000-0000-4000-8000-000000000067';
SELECT pg_temp.assert_true((SELECT status = 'processing' AND locked_by = 'm2-worker' FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000067' AND event_type = 'manual_order_invoice'), 'dispatch-started row survives a mid-flight correction');
-- A tax correction re-arms an invoice skipped as tax_breakdown_invalid;
-- other skip reasons keep their own re-arm paths.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000068', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'unpaid', 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000068', 'Device', 1, 100);
INSERT INTO public.order_tax_subtotals (order_id, vat_category_code, vat_rate, taxable_amount, tax_amount) VALUES ('10000000-0000-4000-8000-000000000068', 'S', -7.5, 100, -7.5);
UPDATE public.order_notification_outbox SET status = 'skipped', skip_reason = 'tax_breakdown_invalid', skipped_at = now(), attempt_count = 1 WHERE order_id = '10000000-0000-4000-8000-000000000068' AND event_type = 'manual_order_invoice';
UPDATE public.order_tax_subtotals SET vat_rate = 7.5, tax_amount = 7.5 WHERE order_id = '10000000-0000-4000-8000-000000000068';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND attempt_count = 0 AND skip_reason IS NULL AND skipped_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000068' AND event_type = 'manual_order_invoice'), 'tax correction re-arms the skipped invoice');
-- A payment correction re-arms a receipt skipped as payment_history_invalid.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000069', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000069', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'skipped', skip_reason = 'payment_history_invalid', skipped_at = now(), attempt_count = 1 WHERE order_id = '10000000-0000-4000-8000-000000000069' AND event_type = 'manual_order_receipt';
INSERT INTO public.transactions (id, order_id, transaction_type, amount, status) VALUES ('10000000-0000-4000-8000-000000000c03', '10000000-0000-4000-8000-000000000069', 'payment', 100, 'completed');
SELECT pg_temp.assert_true((SELECT status = 'pending' AND attempt_count = 0 AND skip_reason IS NULL AND skipped_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000069' AND event_type = 'manual_order_receipt'), 'payment correction re-arms the skipped receipt');
-- A tax correction racing validation re-arms the undispatched processing
-- row: the in-flight worker loses its claim and the corrected invoice is
-- retried instead of terminally skipping from the stale read.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000075', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'unpaid', 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000075', 'Device', 1, 100);
INSERT INTO public.order_tax_subtotals (order_id, vat_category_code, vat_rate, taxable_amount, tax_amount) VALUES ('10000000-0000-4000-8000-000000000075', 'S', -7.5, 100, -7.5);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000075' AND event_type = 'manual_order_invoice';
UPDATE public.order_tax_subtotals SET vat_rate = 7.5, tax_amount = 7.5 WHERE order_id = '10000000-0000-4000-8000-000000000075';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND locked_by IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000075' AND event_type = 'manual_order_invoice'), 'tax correction re-arms the processing invoice');
-- A payment correction racing validation re-arms the undispatched
-- processing row the same way.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000076', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000076', 'Device', 1, 100);
INSERT INTO public.transactions (id, order_id, transaction_type, amount, status) VALUES ('10000000-0000-4000-8000-000000000c04', '10000000-0000-4000-8000-000000000076', 'payment', -100, 'completed');
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000076' AND event_type = 'manual_order_receipt';
UPDATE public.transactions SET amount = 100 WHERE id = '10000000-0000-4000-8000-000000000c04';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND locked_by IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000076' AND event_type = 'manual_order_receipt'), 'payment correction re-arms the processing receipt');
-- A merchant correction racing validation re-arms the undispatched
-- processing row instead of letting the stale skip go terminal.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000077', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000010', 'buyer@example.com', 'unpaid', 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000077', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice';
UPDATE public.merchants SET slug = 'fixture-fixed' WHERE id = '10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND locked_by IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice'), 'merchant correction re-arms the processing row');
UPDATE public.merchants SET slug = 'fixture' WHERE id = '10000000-0000-4000-8000-000000000001';
-- An unrendered-field edit keeps an undispatched processing lease:
-- repeated unrelated saves must not starve delivery.
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice';
UPDATE public.merchants SET cac_rc_number = 'RC999' WHERE id = '10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT status = 'processing' AND locked_by = 'm2-worker' FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice'), 'unrendered merchant edit keeps the processing lease');
UPDATE public.merchants SET cac_rc_number = 'RC123' WHERE id = '10000000-0000-4000-8000-000000000001';
-- A business_address edit under a nonempty registered address resets
-- receipt markers alone: invoices render the registered line, so the
-- invoice send is pixel-identical and stays undispatched-but-claimed.
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000076' AND event_type = 'manual_order_receipt';
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000076' AND event_type = 'manual_order_receipt';
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice';
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice';
UPDATE public.merchants SET business_address = '2 Marina St' WHERE id = '10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT status = 'processing' AND dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000076' AND event_type = 'manual_order_receipt'), 'shadowed business edit still resets the receipt marker');
SELECT pg_temp.assert_true((SELECT status = 'processing' AND locked_by = 'm2-worker' AND dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice'), 'shadowed business edit keeps the invoice marker and lease');
UPDATE public.merchants SET business_address = '1 Market St' WHERE id = '10000000-0000-4000-8000-000000000001';
-- Admin-only shipping keys (name/phone/flat address) never invalidate an
-- in-flight send; rendered locality keys do. The NULL-to-object write
-- below consumes the 077 marker via the rendered change, so re-mark first.
UPDATE public.orders SET shipping_address = '{"address": "12 Allen Ave", "city": "Lagos", "state": null, "name": "Ada", "phone": ""}' WHERE id = '10000000-0000-4000-8000-000000000077';
SELECT pg_temp.assert_true((SELECT status = 'processing' AND dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice'), 'rendered shipping write invalidates the marker');
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice';
UPDATE public.orders SET shipping_address = shipping_address || '{"name": "Ade", "phone": "08012345678"}' WHERE id = '10000000-0000-4000-8000-000000000077';
SELECT pg_temp.assert_true((SELECT status = 'processing' AND dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice'), 'admin-only shipping edit keeps the marker');
UPDATE public.orders SET shipping_address = shipping_address || '{"city": "Abuja"}' WHERE id = '10000000-0000-4000-8000-000000000077';
SELECT pg_temp.assert_true((SELECT status = 'processing' AND dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice'), 'rendered shipping edit resets the marker');
-- Legacy aliases canonicalize onto the rendered keys: an alias VALUE
-- change resets, while moving the same value between alias and
-- canonical keys (or collapsing null/'' per the falsy filter) keeps.
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice';
UPDATE public.orders SET shipping_address = shipping_address || '{"address": "14 Broad St"}' WHERE id = '10000000-0000-4000-8000-000000000077';
SELECT pg_temp.assert_true((SELECT status = 'processing' AND dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice'), 'alias street change resets the invoice marker');
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice';
UPDATE public.orders SET shipping_address = shipping_address - 'address' || '{"address_line1": "14 Broad St"}' WHERE id = '10000000-0000-4000-8000-000000000077';
SELECT pg_temp.assert_true((SELECT status = 'processing' AND dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice'), 'alias-to-canonical move keeps the invoice marker');
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice';
UPDATE public.orders SET shipping_address = shipping_address || '{"postalCode": "100001"}' WHERE id = '10000000-0000-4000-8000-000000000077';
SELECT pg_temp.assert_true((SELECT status = 'processing' AND dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice'), 'alias postcode change resets the invoice marker');
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice';
UPDATE public.orders SET shipping_address = shipping_address - 'postalCode' || '{"postal_code": "100001"}' WHERE id = '10000000-0000-4000-8000-000000000077';
SELECT pg_temp.assert_true((SELECT status = 'processing' AND dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice'), 'alias-to-canonical postcode move keeps the invoice marker');
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice';
UPDATE public.orders SET shipping_address = shipping_address || '{"state": ""}' WHERE id = '10000000-0000-4000-8000-000000000077';
SELECT pg_temp.assert_true((SELECT status = 'processing' AND dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice'), 'null-to-empty collapse keeps the invoice marker');
-- A bank-code correction under a placeholder name resets the invoice
-- marker (the emailed card changes); a code-only edit under a valid
-- name keeps it. The fallback card needs an account number to render,
-- so the probe sets one first.
UPDATE public.merchants SET bank_account_number = '1234567890', bank_name = 'unknown', bank_code = '058' WHERE id = '10000000-0000-4000-8000-000000000001';
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice';
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice';
UPDATE public.merchants SET bank_code = '011' WHERE id = '10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT status = 'processing' AND dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice'), 'code correction under a placeholder resets the invoice marker');
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice';
UPDATE public.merchants SET bank_name = 'GTBank' WHERE id = '10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT status = 'processing' AND dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice'), 'placeholder-to-valid name change resets the invoice marker');
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice';
UPDATE public.merchants SET bank_code = '058' WHERE id = '10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT status = 'processing' AND dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice'), 'code-only edit under a valid name keeps the invoice marker');
UPDATE public.merchants SET bank_account_number = NULL, bank_name = NULL, bank_code = NULL WHERE id = '10000000-0000-4000-8000-000000000001';
-- The contact phone resolves (support_phone, else phone): editing the
-- shadowed column changes no pixel and keeps the marker, while an
-- effective change resets it.
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice';
UPDATE public.merchants SET support_phone = '+2348000000001' WHERE id = '10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT status = 'processing' AND dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice'), 'effective contact-phone change resets the invoice marker');
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice';
UPDATE public.merchants SET phone = '+2348000000002' WHERE id = '10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT status = 'processing' AND dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice'), 'shadowed phone edit keeps the invoice marker');
UPDATE public.merchants SET support_phone = NULL WHERE id = '10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true((SELECT status = 'processing' AND dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000077' AND event_type = 'manual_order_invoice'), 'support-phone removal resets the invoice marker');
UPDATE public.merchants SET phone = NULL WHERE id = '10000000-0000-4000-8000-000000000001';
