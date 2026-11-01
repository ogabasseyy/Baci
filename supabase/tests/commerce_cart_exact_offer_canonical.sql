-- Full-schema replay entry. Recording order stubs belong to the separate
-- disposable runner, which also runs the bound shopper/agentic/REDVAULT cases.
BEGIN;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
INSERT INTO public.merchants(id,slug,email,business_name,is_published,premium_features) VALUES
 ('11111111-1111-4111-8111-111111111111','exact-offer-canonical','exact-offer@example.test','Exact offer fixture',true,
 '["shared_cart","shared_cart_accounts","shared_cart_realtime"]')
ON CONFLICT(id) DO UPDATE SET is_published=true,premium_features=excluded.premium_features;
INSERT INTO public.products(id,merchant_id,name,slug,price,status,stock_quantity,stock,manage_stock) VALUES
 ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','Exact offer product','exact-offer-product',15,'active',10,10,true)
ON CONFLICT(id) DO UPDATE SET status='active',stock_quantity=10,stock=10;
\ir commerce_cart_line_offer_id.sql
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
\ir commerce_cart_exact_offer_review.sql
ROLLBACK;
