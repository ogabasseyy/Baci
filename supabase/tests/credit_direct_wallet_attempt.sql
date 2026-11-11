CREATE FUNCTION public.test_assert(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',message; END IF; END $$;
CREATE FUNCTION public.test_reject(statement text,expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN IF strpos(SQLERRM,expected)>0 THEN RETURN; END IF; RAISE EXCEPTION 'Expected %, got %',expected,SQLERRM; END;
 RAISE EXCEPTION 'Expected rejection: %',expected;
END $$;
INSERT INTO public.merchants VALUES('00000000-0000-4000-8000-000000000002');
INSERT INTO public.customers VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003');
INSERT INTO public.merchant_feature_settings VALUES('00000000-0000-4000-8000-000000000002',true,10000,500000);
INSERT INTO public.orders(id,merchant_id,customer_id,total,amount_paid,wallet_amount_used)
 SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',50000,20000,20000 FROM generate_series(10,19) n;
INSERT INTO public.customer_wallet_transactions(source_id,source_type,type,amount,customer_id,merchant_id)
 SELECT id,'order_redemption','redemption',20000,customer_id,merchant_id FROM public.orders;
-- Attach the real reversal RPC's wallet before reserving the order.
INSERT INTO public.customer_wallets(id,merchant_id,customer_id,available_balance,total_redeemed)
VALUES('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',0,20000);
UPDATE public.customer_wallet_transactions SET wallet_id='00000000-0000-4000-8000-000000000004'
 WHERE source_id='00000000-0000-4000-8000-000000000010';
UPDATE public.merchants SET user_id='00000000-0000-4000-8000-000000000005';
SELECT set_config('test.role','authenticated',false);
DO $$
DECLARE token record; again record;
BEGIN
 SET LOCAL ROLE authenticated;
 SELECT * INTO token FROM public.issue_credit_direct_checkout_token('00000000-0000-4000-8000-000000000010','wallet@example.com','00000000-0000-4000-8000-000000000002','first-session','unguessable-tracking-token');
 PERFORM public.test_assert(token.signed_amount=30000,'sign the remainder exactly once');
 PERFORM public.set_credit_direct_session(token.checkout_token,'00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','first-session',30000);
 -- This fails before the fix: a new session can replace a still-chargeable one.
 PERFORM public.test_reject($q$SELECT public.issue_credit_direct_checkout_token('00000000-0000-4000-8000-000000000010','wallet@example.com','00000000-0000-4000-8000-000000000002','second-session','unguessable-tracking-token')$q$,'credit_direct_wallet_attempt_pending');
END $$;
SELECT public.test_assert((SELECT gross_amount=50000 AND wallet_amount=20000 AND financed_amount=30000 AND session_id='first-session' FROM credit_direct_private.wallet_attempts WHERE order_id='00000000-0000-4000-8000-000000000010'),'durable funding reservation');
-- Consumed token removal/expiry does not authorize a fresh financial session.
DELETE FROM public.credit_direct_checkout_tokens;
SELECT public.test_reject($q$SELECT public.issue_credit_direct_checkout_token('00000000-0000-4000-8000-000000000010','wallet@example.com','00000000-0000-4000-8000-000000000002','third-session','unguessable-tracking-token')$q$,'credit_direct_wallet_attempt_pending');
SELECT public.test_reject($q$UPDATE public.orders SET payment_method='card' WHERE id='00000000-0000-4000-8000-000000000010'$q$,'credit_direct_wallet_attempt_pending');
SELECT public.test_reject($q$UPDATE public.orders SET total=60000 WHERE id='00000000-0000-4000-8000-000000000010'$q$,'credit_direct_wallet_attempt_pending');
SELECT public.test_reject($q$UPDATE public.orders SET amount_paid=50000 WHERE id='00000000-0000-4000-8000-000000000010'$q$,'credit_direct_wallet_attempt_pending');
SELECT public.test_reject($q$UPDATE public.customer_wallet_transactions SET status='failed' WHERE source_id='00000000-0000-4000-8000-000000000010'$q$,'credit_direct_wallet_attempt_pending');
SELECT public.test_reject($q$INSERT INTO public.customer_wallet_transactions(source_id,source_type,type,amount) VALUES('00000000-0000-4000-8000-000000000010','order_reversal','adjustment',20000)$q$,'credit_direct_wallet_attempt_pending');
-- Retained delivery economics must be resolved before token issuance.
UPDATE public.orders SET shipping_funding_source='customer_checkout',shipping_platform_retained_amount=5000 WHERE id='00000000-0000-4000-8000-000000000011';
SELECT public.test_reject($q$SELECT public.issue_credit_direct_checkout_token('00000000-0000-4000-8000-000000000011','wallet@example.com','00000000-0000-4000-8000-000000000002','shipping-session','unguessable-tracking-token')$q$,'credit_direct_wallet_shipping_unsupported');
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.credit_direct_checkout_tokens WHERE order_id='00000000-0000-4000-8000-000000000011'),'no token or provider session for unsupported shipping');
SELECT public.test_assert((SELECT amount_paid=20000 AND wallet_amount_used=20000 FROM public.orders WHERE id='00000000-0000-4000-8000-000000000011'),'unsupported shipping preserves wallet credit');
-- The signature-verified internal webhook boundary must confirm the exact net.
SELECT public.test_reject($q$SELECT public.verify_credit_direct_wallet_event('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','provider-reference',true,30000)$q$,'forbidden');
SELECT set_config('test.role','service_role',false);
SELECT public.test_reject($q$SELECT public.verify_credit_direct_wallet_event('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','provider-reference',true,50000)$q$,'credit_direct_wallet_reconciliation_required');
SELECT public.verify_credit_direct_wallet_event('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','provider-reference',false,30000);
SELECT public.test_reject($q$UPDATE public.orders SET amount_paid=50000 WHERE id='00000000-0000-4000-8000-000000000010'$q$,'credit_direct_wallet_attempt_pending');
SELECT public.verify_credit_direct_wallet_event('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','provider-reference',true,30000);
UPDATE public.orders SET amount_paid=50000,payment_status='paid' WHERE id='00000000-0000-4000-8000-000000000010';
SELECT public.verify_credit_direct_wallet_event('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','provider-reference',true,30000);
SELECT public.test_reject($q$SELECT public.verify_credit_direct_wallet_event('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','other-reference',true,30000)$q$,'credit_direct_wallet_reconciliation_required');
-- Preserve historical full-payment Credit Direct token/session behavior.
INSERT INTO public.orders(id,merchant_id,total) VALUES('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000002',50000);
DO $$
DECLARE token record;
BEGIN
 SELECT * INTO token FROM public.issue_credit_direct_checkout_token('00000000-0000-4000-8000-000000000020','wallet@example.com','00000000-0000-4000-8000-000000000002','full-payment-first','unguessable-tracking-token');
 PERFORM public.set_credit_direct_session(token.checkout_token,'00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000002','full-payment-first',50000);
 SELECT * INTO token FROM public.issue_credit_direct_checkout_token('00000000-0000-4000-8000-000000000020','wallet@example.com','00000000-0000-4000-8000-000000000002','full-payment-retry','unguessable-tracking-token');
 PERFORM public.test_assert(token.signed_amount=50000,'historical full payment preserved');
END $$;
-- Legacy or switched rails have no new-wallet admission proof.
UPDATE public.orders SET payment_method='card' WHERE id='00000000-0000-4000-8000-000000000012';
UPDATE public.orders SET payment_method='credit_direct' WHERE id='00000000-0000-4000-8000-000000000012';
SELECT public.test_reject($q$SELECT public.issue_credit_direct_checkout_token('00000000-0000-4000-8000-000000000012','wallet@example.com','00000000-0000-4000-8000-000000000002','switched-session','unguessable-tracking-token')$q$,'credit_direct_wallet_origin_unverified');
-- Reversed and incomplete wallet debits cannot finance an invoice remainder.
INSERT INTO public.customer_wallet_transactions(source_id,source_type,type,amount) VALUES('00000000-0000-4000-8000-000000000013','order_reversal','adjustment',20000);
SELECT public.test_reject($q$SELECT public.issue_credit_direct_checkout_token('00000000-0000-4000-8000-000000000013','wallet@example.com','00000000-0000-4000-8000-000000000002','reversed-session','unguessable-tracking-token')$q$,'credit_direct_wallet_reconciliation_required');
UPDATE public.customer_wallet_transactions SET status='pending' WHERE source_id='00000000-0000-4000-8000-000000000014';
SELECT public.test_reject($q$SELECT public.issue_credit_direct_checkout_token('00000000-0000-4000-8000-000000000014','wallet@example.com','00000000-0000-4000-8000-000000000002','pending-ledger-session','unguessable-tracking-token')$q$,'credit_direct_wallet_reconciliation_required');
-- A previously issued token cannot reserve stale funding or unsupported shipping.
DO $$
DECLARE token record;
BEGIN
 SELECT * INTO token FROM public.issue_credit_direct_checkout_token('00000000-0000-4000-8000-000000000015','wallet@example.com','00000000-0000-4000-8000-000000000002','changed-shipping-session','unguessable-tracking-token');
 UPDATE public.orders SET shipping_platform_retained_amount=5000 WHERE id='00000000-0000-4000-8000-000000000015';
 PERFORM public.test_reject(format('SELECT public.set_credit_direct_session(%L,%L,%L,%L,30000)',token.checkout_token,'00000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000002','changed-shipping-session'),'credit_direct_wallet_shipping_unsupported');
 PERFORM public.test_assert(NOT EXISTS(SELECT 1 FROM credit_direct_private.wallet_attempts WHERE order_id='00000000-0000-4000-8000-000000000015'),'failed consume rolls back reservation');
END $$;
-- Authenticating the customer event must not authorize a merchant paid write.
SELECT public.test_assert(NOT has_function_privilege('authenticated','public.verify_credit_direct_wallet_event(uuid,uuid,text,boolean,numeric)','EXECUTE'),'customer cannot submit provider evidence');
SELECT set_config('test.role','',false);
SELECT public.test_reject($q$UPDATE public.orders SET amount_paid=20000 WHERE id='00000000-0000-4000-8000-000000000010'$q$,'credit_direct_wallet_attempt_pending');
SELECT set_config('test.role','service_role',false);
-- Exercise the real wallet reversal RPC with the actor and cancellation stamp
-- that cancel_order_as_merchant supplies. Direct execution remains restricted.
SELECT public.test_assert(NOT has_function_privilege('authenticated','public.reverse_wallet_redemption(uuid,text,uuid)','EXECUTE'),'buyers cannot call the reversal directly');
SELECT set_config('test.role','authenticated',false);
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000005',false);
SELECT public.test_reject($q$SELECT * FROM public.reverse_wallet_redemption('00000000-0000-4000-8000-000000000010','Uncancelled order','00000000-0000-4000-8000-000000000002')$q$,'credit_direct_wallet_attempt_pending');
-- Exercise the legacy spelling in isolation, then test the canonical spelling.
BEGIN;
UPDATE public.orders SET shipping_status='canceled',cancelled_at=now(),cancelled_by='merchant' WHERE id='00000000-0000-4000-8000-000000000010';
SELECT public.test_assert((SELECT success AND reversed_amount=20000 AND new_balance=20000 FROM public.reverse_wallet_redemption('00000000-0000-4000-8000-000000000010','Merchant canceled','00000000-0000-4000-8000-000000000002')),'legacy canceled spelling restores the original wallet debit');
ROLLBACK;
UPDATE public.orders SET shipping_status='cancelled',cancelled_at=now(),cancelled_by='merchant' WHERE id='00000000-0000-4000-8000-000000000010';
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000003',false);
SELECT public.test_reject($q$SELECT * FROM public.reverse_wallet_redemption('00000000-0000-4000-8000-000000000010','Wrong actor','00000000-0000-4000-8000-000000000002')$q$,'credit_direct_wallet_attempt_pending');
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000005',false);
SELECT public.test_assert((SELECT success AND reversed_amount=20000 AND new_balance=20000 FROM public.reverse_wallet_redemption('00000000-0000-4000-8000-000000000010','Merchant cancelled','00000000-0000-4000-8000-000000000002')),'captured merchant cancellation restores exactly the original wallet debit');
SELECT public.test_assert((SELECT NOT success AND reversed_amount=0 AND new_balance=20000 FROM public.reverse_wallet_redemption('00000000-0000-4000-8000-000000000010','Duplicate cancellation','00000000-0000-4000-8000-000000000002')),'cancellation replay cannot credit the wallet twice');
SELECT set_config('test.role','service_role',false);
SELECT public.verify_credit_direct_wallet_event('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','provider-reference',true,30000);
-- Full-payment Credit Direct refunds are not accidentally fenced by the new wallet rule.
INSERT INTO public.customer_wallet_transactions(source_id,source_type,type,amount) VALUES('00000000-0000-4000-8000-000000000020','order_refund','refund',50000);
SELECT public.test_reject($q$UPDATE public.orders SET shipping_platform_retained_amount=5000 WHERE id='00000000-0000-4000-8000-000000000010'$q$,'credit_direct_wallet_attempt_pending');
