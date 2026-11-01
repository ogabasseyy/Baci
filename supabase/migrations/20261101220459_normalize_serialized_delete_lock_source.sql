-- Normalize only the blocks required by the following deletion lock patch.
DO $patch$
DECLARE
  definition text := pg_get_functiondef('private.delete_variant_inventory_unit(uuid,uuid)'::regprocedure);
  block text;
  crlf_block text;
  lf_count integer;
  crlf_count integer;
BEGIN
  FOREACH block IN ARRAY ARRAY[
    E'  -- 2. Lock unit and verify ownership\n  SELECT vi.*, pv.product_id',
    E'  WHERE vi.id = p_unit_id AND vi.merchant_id = p_merchant_id\n  FOR UPDATE;'
  ] LOOP
    crlf_block := replace(block, E'\n', E'\r\n');
    lf_count := (length(definition) - length(replace(definition, block, ''))) / length(block);
    crlf_count := (length(definition) - length(replace(definition, crlf_block, ''))) / length(crlf_block);
    IF lf_count + crlf_count <> 1 THEN
      RAISE EXCEPTION 'serialized unit deletion normalization source mismatch';
    END IF;
    IF crlf_count = 1 THEN definition := replace(definition, crlf_block, block); END IF;
  END LOOP;
  EXECUTE definition;
END $patch$;
