-- Permit zero-price (free / fully discounted) negotiations in the
-- canonical writer: client schemas, native hydration, and the shared
-- command contract already accept zero, but the installed parser,
-- writer, auto-accept threshold, and state assembly rejected every
-- value below 1, so a free negotiation failed to sync as invalid_item.
-- Patch the installed definitions in place; committed migrations are
-- never edited.
DO $repair$
DECLARE
  definition text;
  old text;
BEGIN
  -- Parser: add/replace/import lines may carry a zero negotiated price.
  definition := pg_get_functiondef('public.commerce_cart_parse_input_line(jsonb)'::regprocedure);
  old := 'OR v_text::bigint <= 0 THEN pi_product := NULL';
  IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'zero negotiation parser source mismatch';
  END IF;
  definition := replace(definition, old, 'OR v_text::bigint < 0 THEN pi_product := NULL');
  EXECUTE definition;

  -- Auto-accept threshold: zero is a value, not a missing price. The
  -- discount band is unchanged, so a free line still needs the
  -- merchant-side acceptance path rather than auto-accepting.
  definition := pg_get_functiondef('public.commerce_cart_negotiation_auto_accepts(uuid,uuid,uuid,bigint)'::regprocedure);
  old := 'OR p_negotiated < 1 OR';
  IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'zero negotiation auto-accept source mismatch';
  END IF;
  definition := replace(definition, old, 'OR p_negotiated < 0 OR');
  EXECUTE definition;

  -- Writer: set_negotiated_price accepts zero.
  definition := pg_get_functiondef('public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)'::regprocedure);
  old := 'IF v_negotiated < 1';
  IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'zero negotiation writer source mismatch';
  END IF;
  definition := replace(definition, old, 'IF v_negotiated < 0');
  EXECUTE definition;

  -- State assembly: a stored zero negotiated price is valid, not a
  -- pricing anomaly.
  definition := pg_get_functiondef('public.commerce_cart_assemble_state(uuid,uuid)'::regprocedure);
  old := 'OR l.negotiated_unit_price_minor <= 0';
  IF (length(definition) - length(replace(definition, old, ''))) / length(old) <> 1 THEN
    RAISE EXCEPTION 'zero negotiation assembly source mismatch';
  END IF;
  definition := replace(definition, old, 'OR l.negotiated_unit_price_minor < 0');
  EXECUTE definition;
END
$repair$;
