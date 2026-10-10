-- Disposable database regression; run after the storefront fixture and migrations.
RESET ROLE;
UPDATE public.product_variants SET inventory_tracking_policy = 'inherit'
WHERE product_id = '20000000-0000-4000-8000-000000000001';
INSERT INTO public.products(id, merchant_id, name, status, price, manage_stock, has_variants, has_condition_offers)
VALUES ('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','anchor only','active',1,false,true,false),
('30000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','missing variants','active',1,false,true,true),
('30000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','base product','active',1,false,false,false);
INSERT INTO public.product_variants(id,product_id,merchant_id,is_inventory_anchor)
VALUES ('30000000-0000-4000-8000-000000000010','30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',true);
INSERT INTO public.product_offers(id,product_id,merchant_id,condition,price,stock_quantity,status)
VALUES ('30000000-0000-4000-8000-000000000020','30000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','new',1,9,'active');
SET ROLE anon;
DO $$
DECLARE n integer; v uuid;
BEGIN
 SELECT count(*), min(variant_id::text)::uuid INTO n,v FROM public.get_storefront_search_price_options('00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
 IF n <> 1 OR v <> '20000000-0000-4000-8000-000000000011' THEN RAISE EXCEPTION 'inherit must use parent serialized counts'; END IF;
 SELECT count(*) INTO n FROM public.get_storefront_search_price_options('00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
 IF n <> 0 THEN RAISE EXCEPTION 'anchor-only parent fell back to base'; END IF;
 SELECT count(*) INTO n FROM public.get_storefront_search_price_options('00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002');
 IF n <> 0 THEN RAISE EXCEPTION 'variant parent fell back to offer'; END IF;
 SELECT count(*) INTO n FROM public.get_storefront_search_price_options('00000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003');
 IF n <> 1 THEN RAISE EXCEPTION 'variantless base must remain purchasable'; END IF;
END $$;
RESET ROLE;
UPDATE public.products SET inventory_tracking_policy='serialized_then_unlimited' WHERE id='20000000-0000-4000-8000-000000000001';
SET ROLE anon;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.get_storefront_search_price_options('00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001')) <> 2 THEN RAISE EXCEPTION 'inherit must allow serialized-then-unlimited options'; END IF;
END $$;
