-- Keep an existing product-only website line on its original identity.
-- This also routes its assurance and negotiation through the normal guard.
DO $migration$
DECLARE
  definition text := pg_catalog.pg_get_functiondef(
    'public.commerce_cart_import_mcp_handoff(text,uuid,text,integer)'::regprocedure
  );
  options_anchor constant text := '    AND coalesce(item.identity->''options'', ''{}''::jsonb) = ''{}''::jsonb';
  legacy_destination constant text := $legacy$
    AND NOT EXISTS (
      SELECT 1 FROM public.commerce_cart_lines legacy_line
      WHERE legacy_line.merchant_id = merchant AND legacy_line.cart_id = destination_id
        AND legacy_line.product_id = product.id AND legacy_line.variant_id IS NULL
        AND legacy_line.condition IS NULL AND coalesce(nullif(legacy_line.options, 'null'::jsonb), '{}'::jsonb) = '{}'::jsonb
        AND legacy_line.voucher_token IS NULL AND legacy_line.voucher_award_id IS NULL
    )$legacy$;
BEGIN
  IF strpos(definition, options_anchor) = 0
  THEN RAISE EXCEPTION 'MCP cart import legacy destination source mismatch'; END IF;
  EXECUTE replace(definition, options_anchor, options_anchor || legacy_destination);
END $migration$;
