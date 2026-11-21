-- Restrict updates to fields used by the Google feed reader and the CrossRem
-- projection, including row eligibility, joins, order and pagination.
-- Keep these columns aligned when changing the feed reader's dependencies.
REVOKE ALL ON FUNCTION public.bump_crossrem_catalog_generation() FROM service_role;

DO $$
DECLARE
  source record;
  old_fields text;
  new_fields text;
BEGIN
  FOR source IN
    SELECT * FROM (VALUES
      ('products', 'merchant_id',
        'id,merchant_id,status,name,description,slug,price,compare_at_price,brand,gtin,mpn,sku,stock,stock_quantity,manage_stock,condition,has_condition_offers,variant_model,available_conditions,google_product_category,category,category_id,canonical_url,color,weight_value,weight_unit,created_at'),
      ('product_variants', 'merchant_id',
        'id,merchant_id,product_id,sku,attributes,condition,price_override,stock_quantity,is_inventory_anchor,created_at'),
      ('product_offers', 'merchant_id',
        'id,merchant_id,product_id,status,condition,price,compare_at_price,stock_quantity,images'),
      ('categories', 'merchant_id', 'id,merchant_id,is_active,name,slug'),
      ('domains', 'merchant_id', 'merchant_id,domain,status,is_primary'),
      ('product_categories', 'product', 'id,product_id,category_id,is_primary'),
      ('product_key_specs', 'product',
        'product_id,screen_size_inches,ram_gb,storage_gb,main_camera_mp,weight_g,available_colors,display_resolution,front_camera_mp')
    ) AS watched(relation, mode, fields)
  LOOP
    SELECT string_agg(format('OLD.%I', name), ', ' ORDER BY position),
           string_agg(format('NEW.%I', name), ', ' ORDER BY position)
    INTO old_fields, new_fields
    FROM unnest(string_to_array(source.fields, ',')) WITH ORDINALITY AS col(name, position);

    EXECUTE format('DROP TRIGGER zz_crossrem_catalog_generation ON public.%I', source.relation);
    EXECUTE format(
      'CREATE TRIGGER zz_crossrem_catalog_generation AFTER INSERT OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bump_crossrem_catalog_generation(%L)',
      source.relation, source.mode
    );
    EXECUTE format(
      'CREATE TRIGGER zz_crossrem_catalog_relevant_update AFTER UPDATE ON public.%I FOR EACH ROW WHEN (ROW(%s) IS DISTINCT FROM ROW(%s)) EXECUTE FUNCTION public.bump_crossrem_catalog_generation(%L)',
      source.relation, old_fields, new_fields, source.mode
    );
  END LOOP;
END;
$$;
