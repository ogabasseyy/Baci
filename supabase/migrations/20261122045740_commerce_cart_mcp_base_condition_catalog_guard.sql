-- Match the storefront default for an unset condition, and exclude
-- SKU-matrix products even if their denormalized variant flag is stale.
DO $migration$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(
    'public.commerce_cart_import_mcp_handoff(text,uuid,text,integer)'::regprocedure
  );
  prior constant text := $where$    AND product.has_variants IS NOT TRUE
    AND discovery.canonical_product_condition(product.condition) = 'new'$where$;
  guarded constant text := $where$    AND product.has_variants IS NOT TRUE
    AND product.variant_model IS DISTINCT FROM 'sku_matrix'
    AND discovery.canonical_product_condition(coalesce(product.condition, 'new')) = 'new'$where$;
BEGIN
  IF length(definition) - length(replace(definition, prior, '')) <> length(prior)
  THEN RAISE EXCEPTION 'MCP cart import base condition catalog guard source mismatch'; END IF;
  EXECUTE replace(definition, prior, guarded);
END $migration$;
