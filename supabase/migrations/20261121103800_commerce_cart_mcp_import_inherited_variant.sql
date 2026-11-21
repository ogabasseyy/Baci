-- A default SKU may inherit the product condition. Match the cart
-- writer's empty options when the source snapshot omits the key.
DO $migration$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(
    'public.commerce_cart_import_mcp_handoff(text,uuid,text,integer)'::regprocedure
  );
  variant_condition constant text := 'discovery.canonical_product_condition(variant.condition)';
  inherited_condition constant text := $condition$coalesce(
      discovery.canonical_product_condition(variant.condition),
      discovery.canonical_product_condition(coalesce(product.condition, 'new'))
    )$condition$;
  source_options constant text := 'item.identity->''options'' = ''{}''::jsonb';
  variant_attributes constant text := 'variant.attributes = ''{}''::jsonb';
  guard_options constant text := 'destination_line.options = copy.value->''item''->''options''';
BEGIN
  IF strpos(definition, variant_condition) = 0
     OR strpos(definition, source_options) = 0
     OR strpos(definition, variant_attributes) = 0
     OR strpos(definition, guard_options) = 0
  THEN RAISE EXCEPTION 'MCP cart import inherited variant source mismatch'; END IF;

  definition := replace(definition, variant_condition, inherited_condition);
  definition := replace(definition, source_options,
    'coalesce(item.identity->''options'', ''{}''::jsonb) = ''{}''::jsonb');
  definition := replace(definition, variant_attributes,
    'coalesce(nullif(variant.attributes, ''null''::jsonb), ''{}''::jsonb) = ''{}''::jsonb');
  definition := replace(definition, guard_options,
    'destination_line.options = coalesce(copy.value->''item''->''options'', ''{}''::jsonb)');
  EXECUTE definition;
END $migration$;
