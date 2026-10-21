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
-- Serialized-policy parents: strict via the product column (007),
-- strict via the anchor variant (008), unlimited via the product
-- column (009).
INSERT INTO public.products(id, merchant_id, name, status, price, stock, stock_quantity, manage_stock, has_variants, has_condition_offers, inventory_tracking_policy)
VALUES ('31000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000001','authority strict','active',100,5,5,true,false,true,'serialized_strict'),
('31000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000001','authority anchor strict','active',100,5,5,true,false,true,'off'),
('31000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000001','authority unlimited','active',100,0,0,true,false,true,'serialized_then_unlimited');
-- Strict zero-unit parent (033): no inventory rows at all;
-- available_units must emit 0, never NULL. No multi-anchor
-- fixture: idx_product_variants_one_inventory_anchor forbids two
-- anchors per product, so the ORDER BY id tiebreak is a
-- deterministic guard, not a live branch.
INSERT INTO public.products(id, merchant_id, name, status, price, stock, stock_quantity, manage_stock, has_variants, has_condition_offers, inventory_tracking_policy)
VALUES ('31000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000001','authority strict zero','active',100,5,5,true,false,true,'serialized_strict');
-- 'inherit'/unrecognized policies (035/036): the effective policy must
-- normalize to 'legacy', never emit the raw token.
INSERT INTO public.products(id, merchant_id, name, status, price, stock, stock_quantity, manage_stock, has_variants, has_condition_offers, inventory_tracking_policy)
VALUES ('31000000-0000-4000-8000-000000000035','00000000-0000-4000-8000-000000000001','authority inherit','active',100,5,5,true,false,true,'inherit'),
('31000000-0000-4000-8000-000000000036','00000000-0000-4000-8000-000000000001','authority inherit anchor','active',100,5,5,true,false,true,'off');
-- Chunk page: 201 live STRICT products of one merchant, so the scoped
-- call must form the merchant slices and call the serialized-count
-- page twice (200 + 1 ids) instead of tripping its
-- too_many_product_ids guard. Offers on the first and last page
-- prove both slices merge.
INSERT INTO public.products(id, merchant_id, name, status, price, stock, stock_quantity, manage_stock, has_variants, has_condition_offers, inventory_tracking_policy)
SELECT ('31000001-' || lpad(g::text, 4, '0') || '-4000-8000-' || lpad(g::text, 12, '0'))::uuid, '00000000-0000-4000-8000-000000000001', 'chunk-' || g, 'active', 100, 5, 5, true, false, true, 'serialized_strict' FROM generate_series(1, 201) g;
-- Mixed page: 50 legacy products of the same strict merchant, so the
-- serialized slices must carry strict ids only while the merged call
-- still resolves both policies.
INSERT INTO public.products(id, merchant_id, name, status, price, stock, stock_quantity, manage_stock, has_variants, has_condition_offers, inventory_tracking_policy)
SELECT ('31000002-' || lpad(g::text, 4, '0') || '-4000-8000-' || lpad(g::text, 12, '0'))::uuid, '00000000-0000-4000-8000-000000000001', 'mixed-' || g, 'active', 100, 5, 5, true, false, true, 'legacy' FROM generate_series(1, 50) g;
ALTER TABLE public.products ENABLE TRIGGER USER;
ALTER TABLE public.product_variants DISABLE TRIGGER USER;
INSERT INTO public.product_variants(id,product_id,merchant_id,is_inventory_anchor)
VALUES ('31000000-0000-4000-8000-000000000010','31000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',false),
('31000000-0000-4000-8000-000000000011','31000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001',false);
INSERT INTO public.product_variants(id,product_id,merchant_id,inventory_tracking_policy,is_inventory_anchor)
VALUES ('41000000-0000-4000-8000-000000000012','31000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000001','inherit',true),
('41000000-0000-4000-8000-000000000013','31000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000001','serialized_strict',true),
('41000000-0000-4000-8000-000000000014','31000001-0001-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','inherit',true),
('41000000-0000-4000-8000-000000000015','31000001-0201-4000-8000-000000000201','00000000-0000-4000-8000-000000000001','inherit',true);
INSERT INTO public.product_variants(id,product_id,merchant_id,inventory_tracking_policy,is_inventory_anchor)
VALUES ('41000000-0000-4000-8000-000000000018','31000000-0000-4000-8000-000000000035','00000000-0000-4000-8000-000000000001','inherit',true),
('41000000-0000-4000-8000-000000000019','31000000-0000-4000-8000-000000000036','00000000-0000-4000-8000-000000000001','inherit',true);
ALTER TABLE public.product_variants ENABLE TRIGGER USER;
ALTER TABLE public.variant_inventory DISABLE TRIGGER USER;
INSERT INTO public.variant_inventory(id,variant_id,merchant_id,identifier_type,identifier_value,status)
VALUES ('51000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','imei','611111111111111','available'),
('51000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','imei','611111111111112','available'),
('51000000-0000-4000-8000-000000000003','41000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','imei','611111111111113','available'),
('51000000-0000-4000-8000-000000000004','41000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000001','imei','611111111111114','available'),
('51000000-0000-4000-8000-000000000005','41000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000001','imei','611111111111115','available'),
('51000000-0000-4000-8000-000000000006','41000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000001','imei','611111111111116','available'),
('51000000-0000-4000-8000-000000000007','41000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000001','imei','611111111111117','available'),
('51000000-0000-4000-8000-000000000008','41000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000001','imei','611111111111118','available'),
('51000000-0000-4000-8000-000000000009','41000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000001','imei','611111111111119','available'),
('51000000-0000-4000-8000-000000000010','41000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000001','imei','611111111111120','available'),
('51000000-0000-4000-8000-000000000011','41000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000001','imei','611111111111121','available'),
('51000000-0000-4000-8000-000000000012','41000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000001','imei','611111111111122','available');
ALTER TABLE public.variant_inventory ENABLE TRIGGER USER;
ALTER TABLE public.product_offers DISABLE TRIGGER USER;
INSERT INTO public.product_offers(id,product_id,merchant_id,condition,price,stock_quantity,status)
VALUES ('31000000-0000-4000-8000-000000000020','31000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','used',80,3,'active'),
('31000000-0000-4000-8000-000000000021','31000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','refurbished',70,0,'active'),
('31000000-0000-4000-8000-000000000022','31000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','open_box',60,4,'inactive'),
('31000000-0000-4000-8000-000000000023','31000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','used',80,3,'active'),
('31000000-0000-4000-8000-000000000024','31000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','used',80,3,'active'),
('31000000-0000-4000-8000-000000000025','31000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','used',80,2,'active'),
('31000000-0000-4000-8000-000000000026','31000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','used',80,3,'active'),
('31000000-0000-4000-8000-000000000027','31000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','used',80,3,'active'),
('31000000-0000-4000-8000-000000000028','31000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000001','used',90,10,'active'),
('31000000-0000-4000-8000-000000000029','31000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000001','used',90,2,'active'),
('31000000-0000-4000-8000-000000000030','31000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000001','used',90,4,'active'),
('32000001-0001-4000-8000-000000000001','31000001-0001-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','used',90,10,'active'),
('32000001-0201-4000-8000-000000000201','31000001-0201-4000-8000-000000000201','00000000-0000-4000-8000-000000000001','used',90,10,'active'),
('31000000-0000-4000-8000-000000000034','31000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000001','used',90,5,'active'),
('31000000-0000-4000-8000-000000000037','31000000-0000-4000-8000-000000000035','00000000-0000-4000-8000-000000000001','used',90,5,'active'),
('31000000-0000-4000-8000-000000000038','31000000-0000-4000-8000-000000000036','00000000-0000-4000-8000-000000000001','used',90,5,'active'),
('32000002-0001-4000-8000-000000000001','31000002-0001-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','used',90,7,'active');
ALTER TABLE public.product_offers ENABLE TRIGGER USER;
SET ROLE anon;
DO $$
DECLARE n integer; r record; price numeric;
BEGIN
 -- Live rows: price basis, scalar allocation, eligibility; archived excluded.
 SELECT count(*) INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000001']::uuid[]);
 IF n <> 2 THEN RAISE EXCEPTION 'simple product must return its two active offers'; END IF;
 SELECT * INTO r FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000001']::uuid[]) WHERE offer_id = '31000000-0000-4000-8000-000000000020';
 IF r.price_basis <> 80 OR r.allocatable_stock <> 3 OR r.parent_eligible IS NOT TRUE THEN RAISE EXCEPTION 'live offer basis/allocation/eligibility wrong'; END IF;
 SELECT * INTO r FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000001']::uuid[]) WHERE offer_id = '31000000-0000-4000-8000-000000000021';
 IF r.allocatable_stock <> 0 OR r.parent_eligible IS NOT TRUE THEN RAISE EXCEPTION 'zeroed offer stays eligible with zero allocation'; END IF;
 -- Variant-bearing, flag-disabled, and stray-variant parents still
 -- resolve their offers (the order RPC stages them), flagged
 -- parent_eligible = false for discovery surfaces.
 SELECT count(*) INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000002']::uuid[]);
 IF n <> 1 THEN RAISE EXCEPTION 'variant parent must resolve its offer'; END IF;
 SELECT * INTO r FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000002']::uuid[]) WHERE offer_id = '31000000-0000-4000-8000-000000000023';
 IF r.parent_eligible IS NOT FALSE OR r.allocatable_stock <> 3 THEN RAISE EXCEPTION 'variant-parent offer must flag ineligible with its scalar'; END IF;
 SELECT count(*) INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000003']::uuid[]);
 IF n <> 1 THEN RAISE EXCEPTION 'flag-disabled parent must resolve its offer'; END IF;
 SELECT * INTO r FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000003']::uuid[]) WHERE offer_id = '31000000-0000-4000-8000-000000000024';
 IF r.parent_eligible IS NOT FALSE OR r.allocatable_stock <> 3 THEN RAISE EXCEPTION 'flag-disabled offer must flag ineligible with its scalar'; END IF;
 SELECT count(*) INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000005']::uuid[]);
 IF n <> 1 THEN RAISE EXCEPTION 'stray-variant parent must resolve its offer'; END IF;
 SELECT * INTO r FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000005']::uuid[]) WHERE offer_id = '31000000-0000-4000-8000-000000000026';
 IF r.parent_eligible IS NOT FALSE OR r.allocatable_stock <> 3 THEN RAISE EXCEPTION 'stray-variant offer must flag ineligible with its scalar'; END IF;
 -- The finite scalar binds even on unmanaged parents.
 SELECT allocatable_stock INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000004']::uuid[]);
 IF n <> 2 THEN RAISE EXCEPTION 'unmanaged parent must not lift the offer scalar'; END IF;
 -- Strict caps the scalar by serialized base units (product policy and
 -- anchor-derived policy alike); unlimited binds only the scalar.
 SELECT * INTO r FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000007']::uuid[]) WHERE offer_id = '31000000-0000-4000-8000-000000000028';
 IF r.allocatable_stock <> 3 OR r.available_units <> 3 OR r.parent_eligible IS NOT TRUE THEN RAISE EXCEPTION 'strict must cap the scalar by units'; END IF;
 SELECT * INTO r FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000008']::uuid[]) WHERE offer_id = '31000000-0000-4000-8000-000000000029';
 IF r.allocatable_stock <> 2 OR r.available_units <> 5 OR r.parent_eligible IS NOT TRUE THEN RAISE EXCEPTION 'anchor-derived strict must cap the scalar by units'; END IF;
 SELECT * INTO r FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000009']::uuid[]) WHERE offer_id = '31000000-0000-4000-8000-000000000030';
 IF r.allocatable_stock <> 4 OR r.available_units IS NOT NULL OR r.parent_eligible IS NOT TRUE THEN RAISE EXCEPTION 'unlimited must bind only the scalar'; END IF;
 -- Non-active products resolve nothing.
 SELECT count(*) INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000006']::uuid[]);
 IF n <> 0 THEN RAISE EXCEPTION 'archived product must resolve nothing'; END IF;
 -- Merchant scoping: wrong merchant resolves nothing, NULL stays unscoped.
 SELECT count(*) INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-999999999999', ARRAY['31000000-0000-4000-8000-000000000001']::uuid[]);
 IF n <> 0 THEN RAISE EXCEPTION 'foreign merchant must resolve nothing'; END IF;
 SELECT count(*) INTO n FROM public.get_storefront_offer_resolution(NULL, ARRAY['31000000-0000-4000-8000-000000000001']::uuid[]);
 IF n <> 2 THEN RAISE EXCEPTION 'NULL merchant must keep the unscoped read'; END IF;
 -- Batch policy: 201 strict ids of one merchant succeed scoped (the
 -- merchant slices call the serialized-count page twice, 200 + 1,
 -- and both slices merge with capped units), fail unscoped, and
 -- 1001 ids fail even scoped.
 SELECT count(*) INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', (SELECT array_agg(('31000001-' || lpad(g::text, 4, '0') || '-4000-8000-' || lpad(g::text, 12, '0'))::uuid) FROM generate_series(1, 201) g));
 IF n <> 2 THEN RAISE EXCEPTION 'chunked scoped call must merge both slices'; END IF;
 SELECT allocatable_stock INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', (SELECT array_agg(('31000001-' || lpad(g::text, 4, '0') || '-4000-8000-' || lpad(g::text, 12, '0'))::uuid) FROM generate_series(1, 201) g)) WHERE offer_id = '32000001-0001-4000-8000-000000000001';
 IF n <> 3 THEN RAISE EXCEPTION 'first slice must cap by its units'; END IF;
 SELECT allocatable_stock INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', (SELECT array_agg(('31000001-' || lpad(g::text, 4, '0') || '-4000-8000-' || lpad(g::text, 12, '0'))::uuid) FROM generate_series(1, 201) g)) WHERE offer_id = '32000001-0201-4000-8000-000000000201';
 IF n <> 1 THEN RAISE EXCEPTION 'second slice must cap by its units'; END IF;
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
 SELECT count(*) INTO n FROM public.get_storefront_search_price_options('00000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000003') WHERE offer_id IS NOT NULL;
 IF n <> 0 THEN RAISE EXCEPTION 'search must not advertise flag-disabled offers'; END IF;
 -- Strict zero-unit parents emit available_units = 0, never NULL, so
 -- genuine sell-outs are distinguishable from projection outages.
 SELECT * INTO r FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000033']::uuid[]) WHERE offer_id = '31000000-0000-4000-8000-000000000034';
 IF r.allocatable_stock <> 0 OR r.available_units IS NULL OR r.available_units <> 0 OR r.parent_eligible IS NOT TRUE THEN RAISE EXCEPTION 'strict zero-unit must emit zero units, not NULL'; END IF;
 -- 'inherit' and unrecognized policies normalize to 'legacy', never emit
 -- raw; an 'inherit' anchor still falls through to a valid row policy.
 SELECT * INTO r FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000035']::uuid[]) WHERE offer_id = '31000000-0000-4000-8000-000000000037';
 IF r.effective_policy <> 'legacy' OR r.allocatable_stock <> 5 OR r.parent_eligible IS NOT TRUE THEN RAISE EXCEPTION 'inherit policies must normalize to legacy'; END IF;
 SELECT * INTO r FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', ARRAY['31000000-0000-4000-8000-000000000036']::uuid[]) WHERE offer_id = '31000000-0000-4000-8000-000000000038';
 IF r.effective_policy <> 'off' OR r.allocatable_stock <> 5 OR r.parent_eligible IS NOT TRUE THEN RAISE EXCEPTION 'inherit anchor must fall through to the row policy'; END IF;
 -- Mixed merchant: one strict plus fifty legacy ids resolve together;
 -- the strict offer stays capped by its units while the legacy offer
 -- keeps its scalar (the slices carry strict ids only).
 SELECT count(*) INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', (SELECT array_prepend('31000000-0000-4000-8000-000000000007', array_agg(('31000002-' || lpad(g::text, 4, '0') || '-4000-8000-' || lpad(g::text, 12, '0'))::uuid)) FROM generate_series(1, 50) g));
 IF n <> 2 THEN RAISE EXCEPTION 'mixed merchant call must resolve both policies'; END IF;
 SELECT allocatable_stock INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', (SELECT array_prepend('31000000-0000-4000-8000-000000000007', array_agg(('31000002-' || lpad(g::text, 4, '0') || '-4000-8000-' || lpad(g::text, 12, '0'))::uuid)) FROM generate_series(1, 50) g)) WHERE offer_id = '31000000-0000-4000-8000-000000000028';
 IF n <> 3 THEN RAISE EXCEPTION 'mixed merchant must keep the strict cap'; END IF;
 SELECT allocatable_stock INTO n FROM public.get_storefront_offer_resolution('00000000-0000-4000-8000-000000000001', (SELECT array_prepend('31000000-0000-4000-8000-000000000007', array_agg(('31000002-' || lpad(g::text, 4, '0') || '-4000-8000-' || lpad(g::text, 12, '0'))::uuid)) FROM generate_series(1, 50) g)) WHERE offer_id = '32000002-0001-4000-8000-000000000001';
 IF n <> 7 THEN RAISE EXCEPTION 'mixed merchant must keep the legacy scalar'; END IF;
END $$;
RESET ROLE;
