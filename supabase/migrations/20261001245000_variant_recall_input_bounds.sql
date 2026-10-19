-- Shared anonymous-executable input bounds for variant recall. The recall
-- RPC admits raw PostgREST callers, so every argument is bounded before the
-- query: JSON payloads by element count and bytes, scalars by the public
-- schema limits. Byte caps admit the worst-case valid intent with
-- headroom: a 100-code-point text value serializes to 600 bytes when it is
-- all JSON-escaped control characters (valid: trim keeps interior
-- controls), so 50 maxed constraints reach 33,550 bytes and five maxed
-- identity branches reach 39,615 bytes; 10 maxed excluded types reach only
-- ~6KB. Short-but-unrecognized conditions still canonicalize to NULL
-- downstream (fail open); these guards only reject absurd sizes.
CREATE OR REPLACE FUNCTION discovery.assert_variant_recall_input_bounds(
  p_filters jsonb,
  p_identity jsonb,
  p_excluded_types jsonb,
  p_brand text,
  p_category text,
  p_condition text
)
RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF pg_catalog.jsonb_typeof(p_filters) = 'array'
    AND (pg_catalog.jsonb_array_length(p_filters) > 50
      OR pg_catalog.octet_length(p_filters::text) > 40960) THEN
    RAISE EXCEPTION 'variant recall accepts at most 50 constraints'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_typeof(p_identity) = 'array'
    AND (pg_catalog.jsonb_array_length(p_identity) > 5
      OR pg_catalog.octet_length(p_identity::text) > 49152) THEN
    RAISE EXCEPTION 'variant recall accepts identity for at most 5 branches'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_typeof(p_excluded_types) = 'array'
    AND (pg_catalog.jsonb_array_length(p_excluded_types) > 10
      OR pg_catalog.octet_length(p_excluded_types::text) > 8192) THEN
    RAISE EXCEPTION 'variant recall accepts at most 10 excluded product types'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.char_length(p_brand) > 50 THEN
    RAISE EXCEPTION 'variant recall accepts brand filters of at most 50 characters'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.char_length(p_category) > 50 THEN
    RAISE EXCEPTION 'variant recall accepts category filters of at most 50 characters'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.char_length(p_condition) > 50 THEN
    RAISE EXCEPTION 'variant recall accepts condition filters of at most 50 characters'
      USING ERRCODE = '22023';
  END IF;
END;
$$;
