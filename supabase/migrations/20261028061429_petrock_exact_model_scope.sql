BEGIN;
CREATE OR REPLACE FUNCTION public.petrock_model_scope_matches(
  p_device_model text,
  p_model_scope jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $$
DECLARE
  v_model text := lower(trim(p_device_model));
  v_kind text := p_model_scope ->> 'kind';
  v_required_family text := lower(trim(COALESCE(p_model_scope ->> 'family', '')));
  v_family text;
  v_canonical text;
  v_series integer;
  v_match text[];
  v_exact text[];
  v_min_text text := p_model_scope ->> 'min';
  v_max_text text := p_model_scope ->> 'max';
BEGIN
  IF v_model IS NULL OR v_model = '' OR v_model ~ '^(unknown( device)?|n/a|not available|null|none|undefined|(apple\s+)?iphone\s*[0-9]{1,2},[0-9]+)$' OR p_model_scope IS NULL THEN
    RETURN false;
  END IF;

  IF p_model_scope ? 'family' AND (jsonb_typeof(p_model_scope -> 'family') IS DISTINCT FROM 'string' OR v_required_family = '' OR length(v_required_family) > 64) THEN RETURN false; END IF;

  v_match := regexp_match(v_model, 'iphone\s*([0-9]{1,2})(?![0-9])', 'i');
  IF v_match IS NOT NULL THEN
    v_family := 'iphone';
    v_series := v_match[1]::integer;
    -- Exact sets must not match a different variant or an ambiguous description.
    -- Series ranges deliberately continue to cover the entire generation.
    v_exact := regexp_match(v_model, '^(?:apple\s+)?iphone\s*([0-9]{1,2})(?:\s+(pro\s+max|pro|plus|mini))?(?:\s*\([a-z0-9-]+\))?$', 'i');
    v_canonical := CASE WHEN v_exact IS NULL THEN '' ELSE
      'iphone-' || v_exact[1] || CASE WHEN v_exact[2] IS NULL THEN ''
        ELSE '-' || regexp_replace(lower(v_exact[2]), '\s+', '-', 'g') END END;
  ELSE
    v_match := regexp_match(v_model, 'ipad(?:\s+pro|\s+air)?\s*([0-9]{1,2})?', 'i');
    IF v_match IS NOT NULL THEN
      v_family := 'ipad';
      v_series := CASE WHEN v_match[1] IS NULL THEN NULL ELSE v_match[1]::integer END;
      v_canonical := CASE WHEN v_match[1] IS NULL
        THEN 'ipad' ELSE 'ipad-' || v_match[1] END;
    ELSE
      v_match := regexp_match(v_model, '(?:samsung\s+)?galaxy\s+([a-z][0-9]{1,3})', 'i');
      IF v_match IS NOT NULL THEN
        v_family := 'samsung';
        v_canonical := 'samsung-' || lower(v_match[1]);
      ELSE
        v_family := 'other';
        v_canonical := trim(BOTH '-' FROM regexp_replace(v_model, '[^a-z0-9]+', '-', 'g'));
      END IF;
    END IF;
  END IF;

  IF v_required_family <> '' AND v_required_family <> v_family THEN
    RETURN false;
  END IF;
  IF v_kind = 'generic' THEN RETURN true; END IF;
  IF v_kind = 'range' THEN
    IF v_family <> 'iphone' THEN RETURN false; END IF;
    IF jsonb_typeof(p_model_scope -> 'min') IS DISTINCT FROM 'number'
       OR jsonb_typeof(p_model_scope -> 'max') IS DISTINCT FROM 'number'
       OR v_min_text IS NULL OR v_max_text IS NULL
       OR length(v_min_text) > 20 OR length(v_max_text) > 20
       OR v_min_text !~ '^[0-9]+(\.0+)?$'
       OR v_max_text !~ '^[0-9]+(\.0+)?$' THEN
      RETURN false;
    END IF;
    IF v_min_text::numeric > v_max_text::numeric THEN RETURN false; END IF;
    RETURN v_series IS NOT NULL
      AND v_series >= v_min_text::numeric
      AND v_series <= v_max_text::numeric;
  END IF;
  IF v_kind = 'set' AND jsonb_typeof(p_model_scope -> 'models') = 'array' THEN
    IF v_canonical IS NULL OR v_canonical = '' OR v_family IN ('ipad', 'samsung')
       OR jsonb_array_length(p_model_scope -> 'models') = 0 OR jsonb_array_length(p_model_scope -> 'models') > 200
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_model_scope -> 'models') AS value(item)
                  WHERE jsonb_typeof(value.item) IS DISTINCT FROM 'string' OR length(trim(value.item #>> '{}')) NOT BETWEEN 1 AND 100)
    THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(p_model_scope -> 'models') AS candidate(model)
      WHERE lower(trim(candidate.model)) = v_canonical
    );
  END IF;
  RETURN false;
END;
$$;

COMMIT;
