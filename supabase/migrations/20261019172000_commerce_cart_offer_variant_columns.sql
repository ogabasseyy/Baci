-- Match the production product_variants schema in the final offer validator.
-- Keep tenant, active-product, inventory-anchor and default-variant guards.
-- CREATE OR REPLACE preserves the existing owner and EXECUTE permissions.
DO $repair$
DECLARE
  definition text;
  repaired text;
BEGIN
  definition := pg_get_functiondef(
    'public.commerce_cart_require_offer(uuid,uuid,uuid)'::regprocedure
  );
  repaired := replace(definition,
    'AND coalesce(v.is_active,true) AND v.status=''active''
            AND v.deleted_at IS NULL AND v.archived_at IS NULL',
    '');
  IF repaired = definition OR repaired ~ 'v\.(is_active|status|deleted_at|archived_at)' THEN
    RAISE EXCEPTION 'unexpected commerce_cart_require_offer definition; variant repair refused';
  END IF;
  EXECUTE repaired;
END $repair$;
