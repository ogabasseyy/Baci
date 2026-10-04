-- Kind-gated invalidation, scope re-arm, and kind-flip retirement
-- (otZEY/otZEb/otZEc). Own merchant (084) so the merchant UPDATEs touch
-- no sibling rows; own orders, so no state handoff.
INSERT INTO public.merchants (id, user_id, slug, business_name, email, legal_entity_name, business_address, registered_address, cac_rc_number, tax_identification_number, vat_registration_status, vat_rate) VALUES ('10000000-0000-4000-8000-000000000084', '10000000-0000-4000-8000-000000000010', 'kindgate', 'Kindgate', 'kind@example.com', 'Kindgate Ltd', '1 Market St', '{"city": "Lagos"}', 'RC123', 'TIN123', 'registered', 7.5);
INSERT INTO public.customers (id, merchant_id, email) VALUES ('10000000-0000-4000-8000-000000000085', '10000000-0000-4000-8000-000000000084', 'kind85@example.com');
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, total, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000086', '10000000-0000-4000-8000-000000000084', '10000000-0000-4000-8000-000000000085', '10000000-0000-4000-8000-000000000010', 'kind85@example.com', 'unpaid', 100, 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000086', 'Device', 1, 100);
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, total, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000087', '10000000-0000-4000-8000-000000000084', '10000000-0000-4000-8000-000000000085', '10000000-0000-4000-8000-000000000010', 'kind85@example.com', 'paid', 100, 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000087', 'Device', 1, 100);
-- Registered address prints on invoices only: an edit resets the
-- invoice marker and keeps the receipt marker (no corrective dup).
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000086' AND event_type = 'manual_order_invoice';
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000086' AND event_type = 'manual_order_invoice';
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000087' AND event_type = 'manual_order_receipt';
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000087' AND event_type = 'manual_order_receipt';
UPDATE public.merchants SET registered_address = '{"city": "Abuja"}' WHERE id = '10000000-0000-4000-8000-000000000084';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000086' AND event_type = 'manual_order_invoice'), 'registered address edit resets the invoice marker');
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000087' AND event_type = 'manual_order_receipt'), 'registered address edit keeps the receipt marker');
-- Validation-only merchant fields print nowhere: edits reset nothing.
UPDATE public.order_notification_outbox SET dispatch_started_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000086' AND event_type = 'manual_order_invoice';
UPDATE public.merchants SET cac_rc_number = 'RC999', vat_rate = 5.0 WHERE id = '10000000-0000-4000-8000-000000000084';
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000086' AND event_type = 'manual_order_invoice'), 'cac/vat edit keeps the invoice marker');
SELECT pg_temp.assert_true((SELECT dispatch_started_at IS NOT NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000087' AND event_type = 'manual_order_receipt'), 'cac/vat edit keeps the receipt marker');
-- A customer moved back under the order's merchant re-arms rows
-- skipped as document_claim_unavailable; a move away re-arms nothing.
INSERT INTO public.customers (id, merchant_id, email) VALUES ('10000000-0000-4000-8000-000000000088', '10000000-0000-4000-8000-000000000084', 'scope88@example.com');
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, total, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000089', '10000000-0000-4000-8000-000000000084', '10000000-0000-4000-8000-000000000088', '10000000-0000-4000-8000-000000000010', 'scope88@example.com', 'unpaid', 100, 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000089', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'skipped', skip_reason = 'document_claim_unavailable', skipped_at = now(), attempt_count = 2 WHERE order_id = '10000000-0000-4000-8000-000000000089';
UPDATE public.customers SET merchant_id = '10000000-0000-4000-8000-000000000001' WHERE id = '10000000-0000-4000-8000-000000000088';
SELECT pg_temp.assert_true((SELECT status = 'skipped' FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000089'), 'customer move away leaves the skipped row alone');
UPDATE public.customers SET merchant_id = '10000000-0000-4000-8000-000000000084' WHERE id = '10000000-0000-4000-8000-000000000088';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND attempt_count = 0 AND skip_reason IS NULL AND skipped_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000089'), 'customer move back re-arms the skipped row');
-- A kind flip retires the opposite undispatched pending row so the
-- sequence claim releases the fresh document without waiting out the
-- stale row's retry delay; the flip back retires in reverse.
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, total, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000090', '10000000-0000-4000-8000-000000000084', '10000000-0000-4000-8000-000000000085', '10000000-0000-4000-8000-000000000010', 'kind85@example.com', 'unpaid', 100, 0);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000090', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET next_attempt_at = now() + interval '1 hour' WHERE order_id = '10000000-0000-4000-8000-000000000090' AND event_type = 'manual_order_invoice';
UPDATE public.orders SET payment_status = 'paid', amount_paid = 100 WHERE id = '10000000-0000-4000-8000-000000000090';
SELECT pg_temp.assert_true((SELECT status = 'pending' FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000090' AND event_type = 'manual_order_receipt'), 'paid flip queues the receipt');
SELECT pg_temp.assert_true((SELECT status = 'skipped' AND skip_reason = 'document_state_changed' AND next_attempt_at IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000090' AND event_type = 'manual_order_invoice'), 'paid flip retires the pending invoice');
UPDATE public.orders SET payment_status = 'unpaid', amount_paid = 0 WHERE id = '10000000-0000-4000-8000-000000000090';
SELECT pg_temp.assert_true((SELECT status = 'pending' AND skip_reason IS NULL FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000090' AND event_type = 'manual_order_invoice'), 'unpaid flip re-queues the invoice');
SELECT pg_temp.assert_true((SELECT status = 'skipped' AND skip_reason = 'document_state_changed' FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000090' AND event_type = 'manual_order_receipt'), 'unpaid flip retires the pending receipt');
