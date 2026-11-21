-- Resolve an unconfigured MCP line to the same SKU as the storefront
-- when the published catalog has only one optionless, equivalent SKU.
-- Keep transfer history in source identity so old receipts and later
-- source revisions cannot copy units again after this mapping changes.
DO $migration$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(
    'public.commerce_cart_import_mcp_handoff(text,uuid,text,integer)'::regprocedure
  );
  guard_start integer := strpos(definition, '  -- The add writer can increment an existing line');
  guard_end integer := strpos(definition,
    '  IF scope = ''bootstrap'' AND prior_import.source_version IS NULL THEN');
  old_create constant text := 'public.commerce_cart_create(''mcp-import:'' || handoff.id, incoming, source.currency)';
  new_create constant text := 'public.commerce_cart_create(''mcp-import:'' || handoff.id, copy_lines, source.currency)';
  resolve_and_guard constant text := $body$
  SELECT jsonb_agg(CASE WHEN variant.id IS NULL THEN entry.value ELSE
    jsonb_set(entry.value, '{item}', item.identity || jsonb_build_object(
      'variantId', variant.id, 'condition', discovery.canonical_product_condition(variant.condition)
    )) END ORDER BY entry.ordinality)
  INTO copy_lines
  FROM jsonb_array_elements(copy_lines) WITH ORDINALITY entry
  CROSS JOIN LATERAL (SELECT entry.value->'item' AS identity) item
  LEFT JOIN public.products product
    ON product.merchant_id = merchant AND product.id = (item.identity->>'productId')::uuid
    AND product.status = 'active'
    AND NOT (item.identity ? 'variantId') AND NOT (item.identity ? 'condition')
    AND item.identity->'options' = '{}'::jsonb
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(incoming) other
      WHERE other.value->'item'->>'productId' = item.identity->>'productId'
        AND other.value->'item' <> item.identity
    )
  LEFT JOIN public.product_variants variant
    ON variant.id = product.default_variant_id AND variant.merchant_id = merchant
    AND variant.product_id = product.id AND variant.is_inventory_anchor IS NOT TRUE
    AND variant.attributes = '{}'::jsonb
    AND discovery.canonical_product_condition(variant.condition) =
        discovery.canonical_product_condition(coalesce(product.condition, 'new'))
    AND coalesce(variant.price_override, product.price) = product.price
    AND NOT EXISTS (
      SELECT 1 FROM public.product_variants sibling
      WHERE sibling.merchant_id = merchant AND sibling.product_id = product.id
        AND sibling.is_inventory_anchor IS NOT TRUE AND sibling.id <> variant.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.product_offers offer
      WHERE offer.merchant_id = merchant AND offer.product_id = product.id
        AND offer.status = 'active'
    );

  -- Compare the resolved identity so automatic import still cannot add
  -- to a line with assurance or negotiated terms.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(copy_lines) copy
    JOIN public.commerce_cart_lines destination_line
      ON destination_line.merchant_id = merchant AND destination_line.cart_id = destination_id
      AND destination_line.product_id = (copy.value->'item'->>'productId')::uuid
      AND destination_line.variant_id IS NOT DISTINCT FROM (copy.value->'item'->>'variantId')::uuid
      AND destination_line.condition IS NOT DISTINCT FROM copy.value->'item'->>'condition'
      AND destination_line.options = copy.value->'item'->'options'
    WHERE destination_line.voucher_token IS NULL AND destination_line.voucher_award_id IS NULL
      AND (destination_line.has_assurance OR destination_line.negotiated_unit_price_minor IS NOT NULL
        OR coalesce(destination_line.negotiation_status, 'none') <> 'none')
  ) THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_item'); END IF;
$body$;
BEGIN
  IF guard_start = 0 OR guard_end <= guard_start OR strpos(definition, old_create) = 0 THEN
    RAISE EXCEPTION 'MCP cart import default variant source mismatch';
  END IF;
  definition := overlay(definition PLACING resolve_and_guard FROM guard_start FOR guard_end - guard_start);
  EXECUTE replace(definition, old_create, new_create);
END $migration$;
