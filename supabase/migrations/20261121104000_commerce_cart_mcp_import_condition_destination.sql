-- Older website lines can carry a condition without a variant. Reuse
-- their exact identity only when it is the resolved SKU's condition.
DO $migration$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(
    'public.commerce_cart_import_mcp_handoff(text,uuid,text,integer)'::regprocedure
  );
  inherited_condition constant text := $condition$coalesce(
      discovery.canonical_product_condition(variant.condition),
      discovery.canonical_product_condition(coalesce(product.condition, 'new'))
    )$condition$;
  projection constant text := '''variantId'', variant.id, ''condition'', ' || inherited_condition;
  eligibility constant text := 'AND ' || inherited_condition || ' =';
  destination_variant constant text := $variant$'variantId', CASE WHEN EXISTS (
      SELECT 1 FROM public.commerce_cart_lines legacy_line
      WHERE legacy_line.merchant_id = merchant AND legacy_line.cart_id = destination_id
        AND legacy_line.product_id = product.id AND legacy_line.variant_id IS NULL
        AND legacy_line.condition = $variant$ || inherited_condition || $variant$
        AND legacy_line.options = '{}'::jsonb
        AND legacy_line.voucher_token IS NULL AND legacy_line.voucher_award_id IS NULL
    ) THEN NULL ELSE variant.id END, 'condition', $variant$ || inherited_condition;
BEGIN
  IF (length(definition) - length(replace(definition, projection, ''))) <> length(projection)
     OR (length(definition) - length(replace(definition, eligibility, ''))) <> length(eligibility)
  THEN RAISE EXCEPTION 'MCP cart import condition destination source mismatch'; END IF;
  EXECUTE replace(definition, projection, destination_variant);
END $migration$;
