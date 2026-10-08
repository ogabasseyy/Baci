-- Append-only: fold degenerate leading-zero runs into contact keys.
--
-- 20261008230000 strips one leading 00 pair, so '00234...' folds to the
-- '+234...' key but '000234...' (three or more leading zeros) keys
-- differently and bypasses duplicate suppression and the per-contact
-- budget. Keys now strip a run of two or more leading zeros; a single
-- leading 0 (domestic trunk) is still kept, so domestic spellings never
-- collide with unrelated numbers. Non-zero-prefixed formats such as
-- 011 IDD remain distinct keys (documented limitation, bounded by the
-- 50/hour merchant cap and the 10/hour per-IP route gate).
BEGIN;
CREATE OR REPLACE FUNCTION storefront_search_private.normalize_request_contact_key(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN raw ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN lower(raw)
    ELSE regexp_replace(regexp_replace(COALESCE(raw, ''), '[^0-9]', '', 'g'), '^00+', '')
  END
$$;
COMMIT;
