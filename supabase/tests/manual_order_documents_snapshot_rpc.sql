-- Claim-bound snapshot + sent-marker RPC coverage (split for the 300-line
-- gate). Brings its own order (070), so no state handoff with siblings.
INSERT INTO public.customers (id, merchant_id, email) VALUES ('10000000-0000-4000-8000-000000000083', '10000000-0000-4000-8000-000000000001', 'snap70@example.com');
INSERT INTO public.orders (id, merchant_id, customer_id, recorded_by_user_id, customer_email, payment_status, amount_paid)
VALUES ('10000000-0000-4000-8000-000000000070', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000083', '10000000-0000-4000-8000-000000000010', 'snap70@example.com', 'paid', 100);
INSERT INTO public.order_items (order_id, name, quantity, price) VALUES ('10000000-0000-4000-8000-000000000070', 'Device', 1, 100);
UPDATE public.order_notification_outbox SET status = 'processing', locked_by = 'm2-worker', locked_at = now() WHERE order_id = '10000000-0000-4000-8000-000000000070' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.create_manual_order_document_claim((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000070' AND event_type = 'manual_order_receipt'), 'm2-worker', ('f70' || repeat('7', 61)))->>'status' = 'created'), 'snapshot probe claim created');
-- The snapshot serves the order, its item, and the merchant in one call.
SELECT pg_temp.assert_true((SELECT public.get_manual_order_document_snapshot((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000070' AND event_type = 'manual_order_receipt'), 'm2-worker')->'order'->>'id' = '10000000-0000-4000-8000-000000000070'), 'snapshot serves the bound order');
SELECT pg_temp.assert_true((SELECT public.get_manual_order_document_snapshot((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000070' AND event_type = 'manual_order_receipt'), 'm2-worker')->'merchant'->>'id' = '10000000-0000-4000-8000-000000000001'), 'snapshot serves the merchant');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(public.get_manual_order_document_snapshot((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000070' AND event_type = 'manual_order_receipt'), 'm2-worker')->'order'->'order_items') = 1), 'snapshot serves the order items');
-- A stolen claim reads NULL instead of a superseded snapshot.
UPDATE public.order_notification_outbox SET locked_by = 'thief-worker' WHERE order_id = '10000000-0000-4000-8000-000000000070' AND event_type = 'manual_order_receipt';
SELECT pg_temp.assert_true((SELECT public.get_manual_order_document_snapshot((SELECT id FROM public.order_notification_outbox WHERE order_id = '10000000-0000-4000-8000-000000000070' AND event_type = 'manual_order_receipt'), 'm2-worker') IS NULL), 'stolen claim reads NULL');
UPDATE public.order_notification_outbox SET locked_by = 'm2-worker' WHERE order_id = '10000000-0000-4000-8000-000000000070' AND event_type = 'manual_order_receipt';
-- The sent marker stamps the claim and refuses a foreign merchant.
SELECT pg_temp.assert_true((SELECT public.mark_manual_document_claim_sent((SELECT rco.receipt_claim_id FROM public.receipt_claim_orders AS rco WHERE rco.order_id = '10000000-0000-4000-8000-000000000070' LIMIT 1), '10000000-0000-4000-8000-000000000001', repeat('e0', 32)) IS NOT NULL), 'marker returns the stamped claim');
SELECT pg_temp.assert_true((SELECT notification_sent_at IS NOT NULL FROM public.receipt_claims AS c JOIN public.receipt_claim_orders AS rco ON rco.receipt_claim_id = c.id WHERE rco.order_id = '10000000-0000-4000-8000-000000000070' LIMIT 1), 'marker stamps notification_sent_at');
SELECT pg_temp.assert_true((SELECT delivered_token_hash = repeat('e0', 32) FROM public.receipt_claims AS c JOIN public.receipt_claim_orders AS rco ON rco.receipt_claim_id = c.id WHERE rco.order_id = '10000000-0000-4000-8000-000000000070' LIMIT 1), 'marker advances the delivered hash to the mailed token');
SELECT pg_temp.assert_true((SELECT public.mark_manual_document_claim_sent((SELECT rco.receipt_claim_id FROM public.receipt_claim_orders AS rco WHERE rco.order_id = '10000000-0000-4000-8000-000000000070' LIMIT 1), '20000000-0000-4000-8000-000000000001', repeat('e0', 32)) IS NULL), 'marker refuses a foreign merchant');
-- Service-role-only boundary: no grant leaks to client roles.
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.get_manual_order_document_snapshot(uuid, text)', 'EXECUTE'), 'snapshot RPC withholds execute from authenticated');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.get_manual_order_document_snapshot(uuid, text)', 'EXECUTE'), 'snapshot RPC withholds execute from anon');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.get_manual_order_document_snapshot(uuid, text)', 'EXECUTE'), 'snapshot RPC grants execute to service_role');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated', 'public.mark_manual_document_claim_sent(uuid, uuid, text)', 'EXECUTE'), 'marker RPC withholds execute from authenticated');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.mark_manual_document_claim_sent(uuid, uuid, text)', 'EXECUTE'), 'marker RPC grants execute to service_role');
