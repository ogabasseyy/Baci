SELECT set_config('test.role','authenticated',false), set_config('test.merchant','00000000-0000-0000-0000-000000000010',false);
SET ROLE authenticated;
SELECT public.assign_variant_inventory_unit_offer('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003');
SELECT public.assign_variant_inventory_unit_offer('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000003');
SELECT public.assign_variant_inventory_unit_offer('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000003');
DO $$ BEGIN
  BEGIN
    PERFORM public.assign_variant_inventory_unit_offer('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000013');
    RAISE EXCEPTION 'wrong product accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.assign_variant_inventory_unit_offer('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000003');
    RAISE EXCEPTION 'reserved unit accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM set_config('test.merchant','00000000-0000-0000-0000-000000000020',true);
  BEGIN
    PERFORM public.assign_variant_inventory_unit_offer('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003');
    RAISE EXCEPTION 'wrong tenant accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ DECLARE listing jsonb; BEGIN
 listing := private.list_variant_inventory_units('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001');
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(listing->'rows') AS row WHERE row->>'id' = '00000000-0000-0000-0000-000000000004' AND row->>'condition_offer_id' = '00000000-0000-0000-0000-000000000003' AND (row->>'is_inventory_anchor')::boolean IS TRUE) THEN
  RAISE EXCEPTION 'listing lacks unit offer assignment';
 END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.test_cache_targets WHERE merchant_id = '00000000-0000-0000-0000-000000000010' AND product_slugs = ARRAY['sample-phone']) <> 3 THEN
  RAISE EXCEPTION 'assignment must enqueue merchant and product cache targets';
 END IF;
END $$;
UPDATE public.variant_inventory SET condition_offer_id=condition_offer_id WHERE id='00000000-0000-0000-0000-000000000004';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.test_cache_targets) <> 3 THEN RAISE EXCEPTION 'unchanged assignment invalidated cache'; END IF;
END $$;
UPDATE public.variant_inventory SET status='reserved', order_id='00000000-0000-0000-0000-000000000099' WHERE id='00000000-0000-0000-0000-000000000006';
UPDATE public.variant_inventory SET status='defective' WHERE id='00000000-0000-0000-0000-000000000007';
DO $$ BEGIN
 IF (SELECT condition_offer_id FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000004') IS DISTINCT FROM '00000000-0000-0000-0000-000000000003'::uuid THEN RAISE EXCEPTION 'assignment changed'; END IF;
 BEGIN
  UPDATE public.product_offers SET product_id='00000000-0000-0000-0000-000000000011' WHERE id='00000000-0000-0000-0000-000000000003';
  RAISE EXCEPTION 'assigned offer moved';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  UPDATE public.product_offers SET condition='refurbished' WHERE id='00000000-0000-0000-0000-000000000003';
  RAISE EXCEPTION 'assigned offer condition changed';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  UPDATE public.product_variants SET is_inventory_anchor=false WHERE id='00000000-0000-0000-0000-000000000002';
  RAISE EXCEPTION 'assigned anchor changed';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  UPDATE public.products SET has_variants=true WHERE id='00000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'assigned product shape changed';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 DELETE FROM public.product_offers WHERE id='00000000-0000-0000-0000-000000000003';
 IF (SELECT condition_offer_id FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000004') IS NOT NULL THEN RAISE EXCEPTION 'deletion did not unassign'; END IF;
 IF (SELECT condition_offer_id FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000006') IS DISTINCT FROM '00000000-0000-0000-0000-000000000003'::uuid THEN RAISE EXCEPTION 'deleted offer lost reserved unit identity'; END IF;
 UPDATE public.variant_inventory SET status='available',order_id=NULL WHERE id='00000000-0000-0000-0000-000000000006';
 IF (SELECT condition_offer_id FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000006') IS NOT NULL THEN RAISE EXCEPTION 'released unit retained deleted offer'; END IF;
 UPDATE public.variant_inventory SET status='available' WHERE id='00000000-0000-0000-0000-000000000007';
 IF (SELECT condition_offer_id FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000007') IS NOT NULL THEN RAISE EXCEPTION 'reconditioned unit retained deleted offer'; END IF;
END $$;

DO $$ BEGIN
 IF (SELECT count(*) FROM public.test_cache_targets) <> 6 THEN RAISE EXCEPTION 'offer deletion and release must invalidate cache'; END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_indexes
  WHERE schemaname='public' AND tablename='variant_inventory'
    AND indexname='variant_inventory_condition_offer_id_idx'
    AND indexdef LIKE '%(condition_offer_id)%'
    AND indexdef LIKE '%condition_offer_id IS NOT NULL%'
 ) THEN RAISE EXCEPTION 'all-status offer identity index is missing'; END IF;
END $$;
