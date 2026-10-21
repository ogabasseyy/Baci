-- Append-only: match hyphens in the search condition normalizer.
--
-- normalize_condition_for_match mapped whitespace to underscores but
-- returned NULL for hyphenated spellings such as `open-box`, while the
-- shared TypeScript normalizer maps them to `open_box`. The offer-options
-- branch therefore treated an `open_box` offer as distinct from its
-- hyphenated parent and advertised a price + offer_id the categorized
-- PDP (which canonicalizes both sides) drops, leaving the deep link
-- unresolvable. Normalize hyphens the same way; all other behavior
-- (uk_used/refurbished folding, allowlist) is unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION storefront_search_private.normalize_condition_for_match(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE regexp_replace(lower(trim(COALESCE(raw, ''))), '[\s-]+', '_', 'g')
    WHEN 'uk_used' THEN 'used'
    WHEN 'refurbished' THEN 'open_box'
    WHEN 'new' THEN 'new'
    WHEN 'used' THEN 'used'
    WHEN 'open_box' THEN 'open_box'
    ELSE NULL
  END
$$;

COMMIT;
