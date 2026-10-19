-- Committed fixtures in an owned disposable cluster for two-session RPC races.
UPDATE public.merchants SET premium_features='["shared_cart"]' WHERE id='11111111-1111-4111-8111-111111111111';
INSERT INTO public.commerce_carts(id,merchant_id,expires_at) VALUES
 ('aaaaaaaa-2000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',now()+interval '7 days'),
 ('aaaaaaaa-2000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111',now()+interval '7 days');
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at) VALUES
 ('bbbbbbbb-2000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','aaaaaaaa-2000-4000-8000-000000000001','lock-source',now()+interval '7 days'),
 ('bbbbbbbb-2000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','aaaaaaaa-2000-4000-8000-000000000002','lock-merge-receiver',now()+interval '7 days');
INSERT INTO public.commerce_cart_lines(merchant_id,cart_id,product_id,quantity,last_unit_price_minor)
 VALUES('11111111-1111-4111-8111-111111111111','aaaaaaaa-2000-4000-8000-000000000001','44444444-4444-4444-8444-444444444444',1,1500);
INSERT INTO public.commerce_cart_handoffs(id,handoff_hash,merchant_id,source_cart_id,expires_at,destination)
 VALUES('cccccccc-2000-4000-8000-000000000001','lock-order-handoff','11111111-1111-4111-8111-111111111111','aaaaaaaa-2000-4000-8000-000000000001',now()+interval '5 minutes','{"type":"native"}');
