-- Match the pilot schema. Model numbers require an approved source before export.
CREATE OR REPLACE FUNCTION private.brilstash_payload_has_wire_shape(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = '' AS $$
DECLARE item jsonb;
DECLARE image jsonb;
DECLARE field text;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(p_payload) LOOP
    IF jsonb_typeof(item) <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(item) AS keys(key)
      WHERE key NOT IN ('external_id', 'product_url', 'title', 'description', 'category',
        'price_naira', 'stock_quantity', 'images', 'brand')
    ) THEN RETURN false; END IF;
    FOREACH field IN ARRAY ARRAY['external_id', 'product_url', 'title', 'description',
      'category', 'brand'] LOOP
      IF field = 'brand' AND NOT (item ? field) THEN CONTINUE; END IF;
      IF jsonb_typeof(item->field) IS DISTINCT FROM 'string'
        OR btrim(item->>field) = '' OR item->>field ~ '[<>[:cntrl:]]'
      THEN RETURN false; END IF;
    END LOOP;
    IF item->>'product_url' !~* '^https://[a-z0-9.-]+(:[0-9]{1,5})?([/?]|$)'
      OR substring(lower(item->>'product_url') FROM '^https://[a-z0-9.-]+:([0-9]{1,5})[/?]?')::integer > 65535
      OR item->>'product_url' ~ '[#[:space:][:cntrl:]]' OR strpos(item->>'product_url', chr(92)) > 0
      OR
      jsonb_typeof(item->'price_naira') IS DISTINCT FROM 'number' OR
      jsonb_typeof(item->'stock_quantity') IS DISTINCT FROM 'number' OR
      jsonb_typeof(item->'images') IS DISTINCT FROM 'array'
    THEN RETURN false; END IF;
    IF (item->>'price_naira')::numeric NOT BETWEEN 0.01 AND 9007199254740991
      OR (item->>'stock_quantity')::numeric NOT BETWEEN 0 AND 9007199254740991
      OR (item->>'stock_quantity')::numeric <> trunc((item->>'stock_quantity')::numeric)
      OR jsonb_array_length(item->'images') NOT BETWEEN 1 AND 10
    THEN RETURN false; END IF;
    FOR image IN SELECT value FROM jsonb_array_elements(item->'images') LOOP
      IF jsonb_typeof(image) <> 'object'
        OR jsonb_typeof(image->'url') IS DISTINCT FROM 'string'
        OR image - 'url' <> '{}'::jsonb
        OR image->>'url' !~ '^https://[^/?#@]+([/?]|$)'
        OR image->>'url' ~ '[#[:space:][:cntrl:]]' OR strpos(image->>'url', chr(92)) > 0
      THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  RETURN true;
END;
$$;
