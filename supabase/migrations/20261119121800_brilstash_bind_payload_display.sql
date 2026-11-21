-- The wire display fields must come from the approved source. Builder
-- entitlement does not authorize inventing copy or choosing another site.
CREATE FUNCTION private.brilstash_trim_display(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT btrim(p_text, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;

CREATE FUNCTION private.brilstash_sanitize_display(p_text text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = '' AS $$
DECLARE result text := left(p_text, 100000);
DECLARE next_result text;
BEGIN
  FOR pass IN 1..10 LOOP
    EXIT WHEN strpos(result, '<') = 0;
    next_result := regexp_replace(result, '<[^>]{0,1000}>', '', 'g');
    EXIT WHEN next_result = result;
    result := next_result;
  END LOOP;
  RETURN left(private.brilstash_trim_display(result), 10000);
END;
$$;

CREATE FUNCTION private.brilstash_normalize_facts(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT regexp_replace(
    private.brilstash_sanitize_display(p_text),
    U&'[\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]+',
    ' ', 'g'
  )
$$;

CREATE FUNCTION private.brilstash_storefront_slug_segment(p_slug text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = '' AS $$
DECLARE normalized text := p_slug;
DECLARE decoded_hex text;
DECLARE bytes bytea;
DECLARE result text;
BEGIN
  -- Match the storefront segment serializer's one decode pass. Preserve
  -- literal malformed escapes, and encode a single segment from UTF-8 bytes.
  IF strpos(p_slug, '%') > 0 AND p_slug !~ '%(?![0-9A-Fa-f]{2})' THEN
    SELECT string_agg(CASE WHEN length(piece[1]) = 3 AND left(piece[1], 1) = '%'
      THEN substring(piece[1] FROM 2)
      ELSE encode(convert_to(piece[1], 'UTF8'), 'hex') END, '' ORDER BY ordinal)
    INTO decoded_hex
    FROM regexp_matches(p_slug, '%[0-9A-Fa-f]{2}|.', 'gs') WITH ORDINALITY t(piece, ordinal);
    BEGIN
      normalized := convert_from(decode(decoded_hex, 'hex'), 'UTF8');
    EXCEPTION WHEN character_not_in_repertoire OR untranslatable_character THEN
      normalized := p_slug;
    END;
  END IF;

  normalized := private.brilstash_trim_display(normalized);
  IF normalized IN ('', '.', '..') OR normalized ~ '[[:cntrl:]/]' OR strpos(normalized, chr(92)) > 0 THEN
    RETURN NULL;
  END IF;
  bytes := convert_to(normalized, 'UTF8');
  SELECT string_agg(CASE WHEN n BETWEEN 48 AND 57 OR n BETWEEN 65 AND 90
      OR n BETWEEN 97 AND 122 OR n IN (33, 39, 40, 41, 42, 45, 46, 95, 126)
    THEN chr(n) ELSE '%' || upper(lpad(to_hex(n), 2, '0')) END, '' ORDER BY i)
  INTO result
  FROM generate_series(0, octet_length(bytes) - 1) i
  CROSS JOIN LATERAL (SELECT get_byte(bytes, i) AS n) value;
  RETURN result;
END;
$$;

CREATE FUNCTION private.brilstash_candidate_display_is_authoritative(
  p_merchant_id uuid, p_payload jsonb, p_rows jsonb
)
RETURNS boolean LANGUAGE sql STABLE STRICT SET search_path = '' AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_payload) item
    LEFT JOIN jsonb_array_elements(p_rows) source ON source->>'externalId' = item->>'external_id'
    CROSS JOIN LATERAL (
      SELECT substring(item->>'product_url' FROM '^https://([a-z0-9.-]+)/') AS hostname,
        private.brilstash_storefront_slug_segment(source->>'slug') AS slug_segment,
        CASE source->>'condition'
          WHEN 'new' THEN 'New' WHEN 'used' THEN 'Used' WHEN 'uk_used' THEN 'UK Used'
          WHEN 'open_box' THEN 'Open Box' WHEN 'refurbished' THEN 'Refurbished'
        END AS condition_label,
        private.brilstash_normalize_facts(source->'approvedFacts'->>'specifications') AS specifications,
        private.brilstash_normalize_facts(source->'approvedFacts'->>'boxContents') AS box,
        private.brilstash_normalize_facts(source->'approvedFacts'->>'warranty') AS warranty
    ) display
    WHERE source IS NULL
      OR display.hostname IS NULL OR display.slug_segment IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.merchants merchant
        WHERE merchant.id = p_merchant_id AND merchant.is_published IS TRUE
          AND (display.hostname = merchant.slug || '.usebaci.com' OR EXISTS (
            SELECT 1 FROM public.domains domain
            WHERE domain.merchant_id = merchant.id AND domain.domain = display.hostname AND domain.status = 'active'
          ))
      )
      OR item->>'product_url' IS DISTINCT FROM (
        'https://' || display.hostname || '/products/' || display.slug_segment ||
        CASE source->>'kind'
          WHEN 'variant' THEN '?variantId=' || (source->>'id') || '&condition=' || (source->>'condition')
          WHEN 'offer' THEN '?offer_id=' || (source->>'id') || '&condition=' || (source->>'condition')
          WHEN 'product' THEN ''
        END
      )
      OR NULLIF(display.specifications, '') IS NULL OR NULLIF(display.box, '') IS NULL
      OR NULLIF(display.warranty, '') IS NULL OR display.condition_label IS NULL
      OR item->>'title' IS DISTINCT FROM private.brilstash_sanitize_display(source->>'name')
      OR item->>'description' IS DISTINCT FROM (
        'Condition: ' || display.condition_label || '. Specifications: ' || display.specifications ||
        '. Box contents: ' || display.box || '. Warranty: ' || display.warranty || '.'
      )
      OR item->>'brand' IS DISTINCT FROM NULLIF(private.brilstash_sanitize_display(source->>'brand'), '')
      OR item ? 'model_number'
  )
$$;

CREATE FUNCTION private.brilstash_validate_generation_display()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE merchant_id uuid;
DECLARE source_rows jsonb;
BEGIN
  SELECT installation.merchant_id INTO merchant_id
  FROM private.brilstash_installations installation WHERE installation.id = NEW.installation_id;
  SELECT COALESCE(jsonb_agg(source.row), '[]'::jsonb) INTO source_rows
  FROM private.brilstash_source_rows(NEW.installation_id, merchant_id) source(row);
  IF private.brilstash_candidate_display_is_authoritative(merchant_id, NEW.payload, source_rows) IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'BrilStash candidate display does not match the approved source' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_brilstash_generation_display
BEFORE INSERT ON private.brilstash_generations
FOR EACH ROW EXECUTE FUNCTION private.brilstash_validate_generation_display();

REVOKE ALL ON FUNCTION private.brilstash_trim_display(text),
  private.brilstash_sanitize_display(text), private.brilstash_normalize_facts(text),
  private.brilstash_storefront_slug_segment(text), private.brilstash_candidate_display_is_authoritative(uuid, jsonb, jsonb),
  private.brilstash_validate_generation_display()
  FROM PUBLIC, anon, authenticated, service_role;
