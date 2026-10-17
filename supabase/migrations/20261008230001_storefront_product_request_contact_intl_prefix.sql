-- Append-only: fold the 00 international prefix into contact keys.
--
-- The canonicalizer collapsed non-digits but kept the 00 dialing prefix,
-- so '+234 801 234 5678' (key 234...) and '00234 801 234 5678' (key
-- 00234...) bypassed duplicate suppression and the per-contact budget as
-- distinct contacts. Keys now strip one leading 00 pair after digit
-- extraction; domestic numbers keep their single leading 0. Submit
-- references the normalizer dynamically, so no submit redefinition is
-- needed; validation, idempotency, grants, and budgets are unchanged.
BEGIN;
CREATE OR REPLACE FUNCTION storefront_search_private.normalize_request_contact_key(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN raw ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN lower(raw)
    ELSE regexp_replace(regexp_replace(COALESCE(raw, ''), '[^0-9]', '', 'g'), '^00', '')
  END
$$;
COMMIT;
