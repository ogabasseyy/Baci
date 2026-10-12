-- Canonical product condition for pre-cap recall matching. Mirrors
-- normalizeCanonicalProductCondition over the enum domain (ASCII spellings
-- with case/space/dash variants): edge whitespace trims, interior
-- whitespace/dash runs fold to one underscore, ASCII case folds (no
-- pg_catalog.lower: locale folding must not narrow differently from the
-- ASCII post-hydration filter), uk_used maps to used and refurbished to
-- open_box, anything outside new/open_box/used yields NULL.
DROP FUNCTION IF EXISTS discovery.canonical_product_condition(text);
CREATE FUNCTION discovery.canonical_product_condition(value text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT CASE folded
    WHEN 'uk_used' THEN 'used'
    WHEN 'refurbished' THEN 'open_box'
    WHEN 'new' THEN 'new'
    WHEN 'open_box' THEN 'open_box'
    WHEN 'used' THEN 'used'
    ELSE NULL
  END
  FROM (SELECT pg_catalog.translate(pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(value, '^[[:space:]]+|[[:space:]]+$', '', 'g'),
      '[[:space:]-]+', '_', 'g'),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') AS folded) AS normalized;
$$;
