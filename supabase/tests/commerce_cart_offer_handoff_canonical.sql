-- Full-schema exact-offer handoff regression.
BEGIN;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
INSERT INTO public.merchants(id,slug,email,business_name,is_published,premium_features)
VALUES ('11111111-1111-4111-8111-111111111111','offer-handoff-canonical',
  'offer-handoff@example.test','Offer handoff fixture',true,'["shared_cart"]')
ON CONFLICT(id) DO UPDATE SET is_published=true,premium_features=excluded.premium_features;
INSERT INTO public.products(id,merchant_id,name,slug,price,status,stock_quantity,stock,manage_stock)
VALUES ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111',
  'Offer handoff product','offer-handoff-product',15,'active',10,10,true)
ON CONFLICT(id) DO UPDATE SET status='active',stock_quantity=10,stock=10;
\ir commerce_cart_offer_handoff_case.sql
ROLLBACK;
