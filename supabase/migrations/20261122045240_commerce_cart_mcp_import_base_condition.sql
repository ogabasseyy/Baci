-- For a base product sold only as new, reuse the website's explicit
-- condition when an optionless MCP line leaves it unset. Resolve only
-- the copy sent to the guarded writer, preserving source replay keys.
DO $migration$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(
    'public.commerce_cart_import_mcp_handoff(text,uuid,text,integer)'::regprocedure
  );
  projection constant text := 'CASE WHEN variant.id IS NULL THEN entry.value ELSE';
  resolution constant text := ') resolved ON variant.id IS NOT NULL';
  base_resolution constant text := $join$) resolved ON variant.id IS NOT NULL OR (
    product.id IS NOT NULL
    AND product.default_variant_id IS NULL
    AND product.has_variants IS NOT TRUE
    AND discovery.canonical_product_condition(product.condition) = 'new'
    AND NOT EXISTS (
      SELECT 1 FROM public.product_variants sibling
      WHERE sibling.merchant_id = merchant AND sibling.product_id = product.id
        AND sibling.is_inventory_anchor IS NOT TRUE
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.product_offers offer
      WHERE offer.merchant_id = merchant AND offer.product_id = product.id
        AND offer.status = 'active'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.commerce_cart_lines exact_line
      WHERE exact_line.merchant_id = merchant AND exact_line.cart_id = destination_id
        AND exact_line.product_id = product.id AND exact_line.variant_id IS NULL
        AND exact_line.condition IS NULL
        AND coalesce(nullif(exact_line.options, 'null'::jsonb), '{}'::jsonb) = '{}'::jsonb
        AND exact_line.voucher_token IS NULL AND exact_line.voucher_award_id IS NULL
    )
  )$join$;
  anchor text;
BEGIN
  FOREACH anchor IN ARRAY ARRAY[
    projection, resolution,
    'AND NOT (item.identity ? ''variantId'') AND NOT (item.identity ? ''condition'')',
    'AND discovery.canonical_product_condition(legacy_line.condition) = resolved.condition',
    'IF scope = ''bootstrap'' AND prior_import.source_version IS NULL THEN'
  ] LOOP
    IF length(definition) - length(replace(definition, anchor, '')) <> length(anchor)
    THEN RAISE EXCEPTION 'MCP cart import base condition source mismatch'; END IF;
  END LOOP;
  definition := replace(definition, projection,
    'CASE WHEN variant.id IS NULL AND legacy_match.condition IS NULL THEN entry.value ELSE');
  EXECUTE replace(definition, resolution, base_resolution);
END $migration$;
