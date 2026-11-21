-- The catalog treats refurbished as open_box, while older cart rows
-- can store either spelling. Send the exact stored key to the writer.
DO $migration$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(
    'public.commerce_cart_import_mcp_handoff(text,uuid,text,integer)'::regprocedure
  );
  projection_start integer := strpos(definition, '''variantId'', CASE WHEN EXISTS (');
  projection_end integer := strpos(definition, ')) END ORDER BY entry.ordinality)');
  offer_anchor constant text := $offer$AND offer.status = 'active'
    );$offer$;
  alias_join constant text := $join$AND offer.status = 'active'
    )
  LEFT JOIN LATERAL (
    SELECT coalesce(
      discovery.canonical_product_condition(variant.condition),
      discovery.canonical_product_condition(coalesce(product.condition, 'new'))
    ) AS condition
  ) resolved ON variant.id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT legacy_line.condition
    FROM public.commerce_cart_lines legacy_line
    WHERE legacy_line.merchant_id = merchant AND legacy_line.cart_id = destination_id
      AND legacy_line.product_id = product.id AND legacy_line.variant_id IS NULL
      AND discovery.canonical_product_condition(legacy_line.condition) = resolved.condition
      AND legacy_line.options = '{}'::jsonb
      AND legacy_line.voucher_token IS NULL AND legacy_line.voucher_award_id IS NULL
    ORDER BY (legacy_line.condition = resolved.condition) DESC, legacy_line.condition
    LIMIT 1
  ) legacy_match ON resolved.condition IS NOT NULL;$join$;
  projection constant text := $projection$'variantId', CASE WHEN legacy_match.condition IS NULL THEN variant.id END,
      'condition', coalesce(legacy_match.condition, resolved.condition)$projection$;
  anchor text;
BEGIN
  IF projection_start = 0 OR projection_end <= projection_start
  THEN RAISE EXCEPTION 'MCP cart import condition alias projection mismatch'; END IF;
  FOREACH anchor IN ARRAY ARRAY[
    offer_anchor,
    'coalesce(item.identity->''options'', ''{}''::jsonb) = ''{}''::jsonb',
    'coalesce(nullif(variant.attributes, ''null''::jsonb), ''{}''::jsonb) = ''{}''::jsonb',
    'destination_line.options = coalesce(copy.value->''item''->''options'', ''{}''::jsonb)',
    'AND legacy_line.condition IS NULL AND legacy_line.options = ''{}''::jsonb'
  ] LOOP
    IF length(definition) - length(replace(definition, anchor, '')) <> length(anchor)
    THEN RAISE EXCEPTION 'MCP cart import condition alias anchor mismatch'; END IF;
  END LOOP;
  definition := overlay(definition PLACING projection FROM projection_start FOR projection_end - projection_start);
  EXECUTE replace(definition, offer_anchor, alias_join);
END $migration$;
