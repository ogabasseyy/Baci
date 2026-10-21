-- Disposable database regression; run after the storefront fixture and migrations.
RESET ROLE;
ALTER TABLE public.merchants DISABLE TRIGGER USER;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('31000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'offer-authority-owner@example.com', 'test',
  now(), now(), now(), '{}', '{}');
INSERT INTO public.merchants (id, user_id, email, business_name, slug, is_published)
VALUES ('00000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002',
  'offer-authority@example.com', 'Offer Authority', 'offer-authority-fixture', true);
ALTER TABLE public.merchants ENABLE TRIGGER USER;
ALTER TABLE public.products DISABLE TRIGGER USER;
INSERT INTO public.products(id, merchant_id, name, status, price, stock, stock_quantity, manage_stock, has_variants, has_condition_offers)
VALUES ('31000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','authority simple','active',100,5,5,true,false,true),
('31000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','authority variant parent','active',100,5,5,true,true,true),
('31000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','authority flag off','active',100,5,5,true,false,false),
('31000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','authority unmanaged','active',100,0,0,false,false,true),
('31000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','authority stray variant','active',100,5,5,true,false,true),
('31000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','authority archived','archived',100,5,5,true,false,true);
-- Chunk page: 201 live products of one merchant, so the scoped call
-- must slice the serialized-count page (200 ids) instead of tripping
-- its too_many_product_ids guard.
INSERT INTO public.products(id, merchant_id, name, status, price, stock, stock_quantity, manage_stock, has_variants, has_condition_offers)
SELECT ('31000001-' || lpad(g::text, 4, '0') || '-4000-8000-' || lpad(g::text, 12, '0'))::uuid, '00000000-0000-4000-8000-000000000001', 'chunk-' || g, 'active', 100, 5, 5, true, false, true FROM generate_series(1, 201) g;
ALTER TABLE public.products ENABLE TRIGGER USER;
ALTER TABLE public.product_variants DISABLE TRIGGER USER;
INSERT INTO public.product_variants(id,product_id,merchant_id,is_inventory_anchor)
VALUES ('31000000-0000-4000-8000-000000000010','31000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',false),
('31000000-0000-4000-8000-000000000011','31000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001',false);
ALTER TABLE public.product_variants ENABLE TRIGGER USER;
ALTER TABLE public.product_offers DISABLE TRIGGER USER;
INSERT INTO public.product_offers(id,product_id,merchant_id,condition,price,stock_quantity,status)
VALUES ('31000000-0000-4000-8000-000000000020','31000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','used',80,3,'active'),
('31000000-0000-4000-8000-000000000021','31000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','refurbished',70,0,'active'),
('31000000-0000-4000-8000-000000000022','31000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','open_box',60,4,'inactive'),
('31000000-0000-4000-8000-000000000023','31000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','used',80,3,'active'),
('31000000-0000-4000-8000-000000000024','31000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','used',80,3,'active'),
('31000000-0000-4000-8000-000000000025','31000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','used',80,2,'active'),
('31000000-0000-4000-8000-000000000026','31000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','used',80,3,'active'),
('31000000-0000-4000-8000-000000000027','31000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','used',80,3,'active');
ALTER TABLE public.product_offers ENABLE TRIGGER USER;
SET ROLE anon;
DO $$
DECLARE n integer; r record; price numeric;
BEGIN
 -- Live rows: price basis, scalar allocation, eligibility; inactive excluded.
 SELECT count(*) INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000001']::uuid[]);
 IF n <> 2 THEN RAISE EXCEPTION 'simple product must return its two active offers'; END IF;
 SELECT * INTO r FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000001']::uuid[]) WHERE offer_id = '31000000-0000-4000-8000-000000000020';
 IF r.price_basis <> 80 OR r.allocatable_stock <> 3 OR r.parent_eligible IS NOT TRUE THEN RAISE EXCEPTION 'live offer basis/allocation/eligibility wrong'; END IF;
 SELECT * INTO r FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000001']::uuid[]) WHERE offer_id = '31000000-0000-4000-8000-000000000021';
 IF r.allocatable_stock <> 0 OR r.parent_eligible IS NOT TRUE THEN RAISE EXCEPTION 'zeroed offer stays eligible with zero allocation'; END IF;
 -- Variant-bearing, flag-disabled, and stray-variant parents resolve
 -- nothing: gated-out rows are withheld, not flagged.
 SELECT count(*) INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000002']::uuid[]);
 IF n <> 0 THEN RAISE EXCEPTION 'variant parent must resolve nothing'; END IF;
 SELECT count(*) INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000003']::uuid[]);
 IF n <> 0 THEN RAISE EXCEPTION 'flag-disabled parent must resolve nothing'; END IF;
 SELECT count(*) INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000005']::uuid[]);
 IF n <> 0 THEN RAISE EXCEPTION 'stray-variant parent must resolve nothing'; END IF;
 -- The finite scalar binds even on unmanaged parents.
 SELECT allocatable_stock INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000004']::uuid[]);
 IF n <> 2 THEN RAISE EXCEPTION 'unmanaged parent must not lift the offer scalar'; END IF;
 -- Non-active products resolve nothing.
 SELECT count(*) INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000006']::uuid[]);
 IF n <> 0 THEN RAISE EXCEPTION 'archived product must resolve nothing'; END IF;
 -- Merchant scoping: wrong merchant resolves nothing, NULL stays unscoped.
 SELECT count(*) INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-999999999999', ARRAY['31000000-0000-4000-8000-000000000001']::uuid[]);
 IF n <> 0 THEN RAISE EXCEPTION 'foreign merchant must resolve nothing'; END IF;
 SELECT count(*) INTO n FROM public.get_storefront_offer_resolution(NULL, ARRAY['31000000-0000-4000-8000-000000000001']::uuid[]);
 IF n <> 2 THEN RAISE EXCEPTION 'NULL merchant must keep the unscoped read'; END IF;
 -- Batch policy: 201 live ids of one merchant succeed scoped (sliced
 -- into 200-pages for the serialized-count call), fail unscoped, and
 -- 1001 ids fail even scoped.
 SELECT count(*) INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', (SELECT array_agg(('31000001-' || lpad(g::text, 4, '0') || '-4000-8000-' || lpad(g::text, 12, '0'))::uuid) FROM generate_series(1, 201) g));
 IF n <> 0 THEN RAISE EXCEPTION 'chunked scoped call must resolve without offers'; END IF;
 BEGIN
  PERFORM public.get_storefront_offer_resolution(NULL, (SELECT array_agg(('31000001-' || lpad(g::text, 4, '0') || '-4000-8000-' || lpad(g::text, 12, '0'))::uuid) FROM generate_series(1, 201) g));
  RAISE EXCEPTION 'unscoped 201-id call must raise the 200 cap';
 EXCEPTION WHEN sqlstate '22023' THEN
  IF SQLERRM NOT LIKE '%at most 200 product IDs without a merchant scope%' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 1001)));
  RAISE EXCEPTION 'scoped 1001-id call must raise the 1000 cap';
 EXCEPTION WHEN sqlstate '22023' THEN
  IF SQLERRM NOT LIKE '%at most 1000 product IDs%' THEN RAISE; END IF;
 END;
 -- Search delegation: the stocked offer is advertised at its live price, the zeroed one is not.
 SELECT count(*) INTO n FROM public.get_storefront_search_price_options('00000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001');
 IF n <> 2 THEN RAISE EXCEPTION 'search must emit the stocked offer plus the base row'; END IF;
 SELECT effective_price INTO price FROM public.get_storefront_search_price_options('00000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001') WHERE offer_id = '31000000-0000-4000-8000-000000000020';
 IF price <> 80 THEN RAISE EXCEPTION 'search must advertise the live offer price'; END IF;
 SELECT count(*) INTO n FROM public.get_storefront_search_price_options('00000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001') WHERE offer_id = '31000000-0000-4000-8000-000000000021';
 IF n <> 0 THEN RAISE EXCEPTION 'search must not advertise the zeroed offer'; END IF;
 -- Search delegation: gated parents emit no offer rows.
 SELECT count(*) INTO n FROM public.get_storefront_search_price_options('00000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002') WHERE offer_id IS NOT NULL;
 IF n <> 0 THEN RAISE EXCEPTION 'search must not advertise variant-parent offers'; END IF;
 SELECT count(*) INTO n FROM public.get_storefront_search_price_options('00000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000005') WHERE offer_id IS NOT NULL;
 IF n <> 0 THEN RAISE EXCEPTION 'search must not advertise stray-variant offers'; END IF;
END $$;
RESET ROLE;
