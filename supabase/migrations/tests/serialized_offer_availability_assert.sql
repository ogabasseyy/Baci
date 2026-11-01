BEGIN;

-- A stale extra anchor must not hide the product's designated stock anchor.
INSERT INTO public.product_variants VALUES ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010',true,'off');
-- PDP must count only this offer's eligible units, including branch scope.
DO $$ DECLARE n integer; BEGIN
  SELECT private.get_serialized_offer_available_units('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003', NULL) INTO n;
  IF n <> 2 THEN RAISE EXCEPTION 'expected two assigned used units, got %', n; END IF;
  SELECT allocatable_stock INTO n FROM public.get_storefront_offer_resolution('00000000-0000-0000-0000-000000000010',ARRAY['00000000-0000-0000-0000-000000000001']::uuid[]) WHERE offer_id='00000000-0000-0000-0000-000000000003';
  IF n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'offer authority must use designated anchor policy, got %', n; END IF;
  INSERT INTO public.branches VALUES ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000010',true), ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000010',true);
  UPDATE public.variant_inventory SET branch_id='00000000-0000-0000-0000-000000000021' WHERE id='00000000-0000-0000-0000-000000000011';
  SELECT private.get_serialized_offer_available_units('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003', NULL) INTO n;
  IF n <> 1 THEN RAISE EXCEPTION 'default multi-branch scope must exclude branch stock'; END IF;
  SELECT private.get_serialized_offer_available_units('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000021') INTO n;
  IF n <> 2 THEN RAISE EXCEPTION 'explicit branch must include global and matching stock'; END IF;
  SELECT private.get_serialized_offer_available_units('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000099') INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'invalid branch must expose no stock'; END IF;
END $$;
ROLLBACK;

DO $$ DECLARE n integer; BEGIN
 SELECT allocatable_stock INTO n FROM public.get_storefront_offer_resolution('00000000-0000-0000-0000-000000000010',ARRAY['00000000-0000-0000-0000-000000000001']::uuid[]) WHERE offer_id='00000000-0000-0000-0000-000000000003';
 IF n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'used offer must expose only its two assigned units, got %',n; END IF;
 SELECT allocatable_stock INTO n FROM public.get_storefront_offer_resolution('00000000-0000-0000-0000-000000000010',ARRAY['00000000-0000-0000-0000-000000000001']::uuid[]) WHERE offer_id='00000000-0000-0000-0000-000000000004';
 IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'new offer must expose only its assigned unit, got %',n; END IF;
 SELECT public_available_units INTO n FROM public.get_public_serialized_variant_availability_counts('00000000-0000-0000-0000-000000000010',ARRAY['00000000-0000-0000-0000-000000000001']::uuid[]) WHERE variant_id IS NULL;
 IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'ordinary pool must exclude assigned units, got %',n; END IF;
END $$;
-- Reserved units must disappear from their offer, while its scalar remains a cap.
UPDATE public.variant_inventory SET status='reserved' WHERE id='00000000-0000-0000-0000-000000000011';
UPDATE public.product_offers SET stock_quantity=1 WHERE id='00000000-0000-0000-0000-000000000004';
DO $$ DECLARE n integer; BEGIN
 SELECT allocatable_stock INTO n FROM public.get_storefront_offer_resolution('00000000-0000-0000-0000-000000000010',ARRAY['00000000-0000-0000-0000-000000000001']::uuid[]) WHERE offer_id='00000000-0000-0000-0000-000000000003';
 IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'reserved unit must not count'; END IF;
 SELECT allocatable_stock INTO n FROM public.get_storefront_offer_resolution('00000000-0000-0000-0000-000000000010',ARRAY['00000000-0000-0000-0000-000000000001']::uuid[]) WHERE offer_id='00000000-0000-0000-0000-000000000004';
 IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'offer scalar cap incorrect'; END IF;
END $$;
INSERT INTO public.branches VALUES ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000010',true);
UPDATE public.variant_inventory SET branch_id='00000000-0000-0000-0000-000000000021' WHERE id='00000000-0000-0000-0000-000000000012';
DO $$ DECLARE n integer; BEGIN
 SELECT allocatable_stock INTO n FROM public.get_storefront_offer_resolution('00000000-0000-0000-0000-000000000010',ARRAY['00000000-0000-0000-0000-000000000001']::uuid[]) WHERE offer_id='00000000-0000-0000-0000-000000000003';
 IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'only active branch should count'; END IF;
END $$;
INSERT INTO public.branches VALUES ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000010',true);
DO $$ DECLARE n integer; BEGIN
 SELECT allocatable_stock INTO n FROM public.get_storefront_offer_resolution('00000000-0000-0000-0000-000000000010',ARRAY['00000000-0000-0000-0000-000000000001']::uuid[]) WHERE offer_id='00000000-0000-0000-0000-000000000003';
 IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'ambiguous branch unit should not count'; END IF;
END $$;
