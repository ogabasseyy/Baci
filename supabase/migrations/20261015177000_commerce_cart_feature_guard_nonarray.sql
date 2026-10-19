-- Tolerate non-array premium_features in the canonical feature guard:
-- jsonb_array_elements_text raises on objects and scalars, which would
-- break unrelated merchant writes whose stored shape the client gates
-- already treat as "no features". Non-array values carry no feature
-- strings, so they pass through unchanged.
CREATE OR REPLACE FUNCTION public.commerce_cart_guard_canonical_features()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  feature text;
  normalized text;
BEGIN
  IF NEW.premium_features IS NULL THEN
    RETURN NEW;
  END IF;
  IF pg_catalog.jsonb_typeof(NEW.premium_features) <> 'array' THEN
    RETURN NEW;
  END IF;
  FOR feature IN
    SELECT value FROM pg_catalog.jsonb_array_elements_text(NEW.premium_features)
  LOOP
    normalized := pg_catalog.lower(
      pg_catalog.regexp_replace(
        feature,
        '^[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
        '',
        'g'
      )
    );
    IF normalized IN (
        'shared_cart', 'shared_cart_realtime', 'shared_cart_accounts',
        'shared_cart_native'
      )
      AND feature <> normalized THEN
      RAISE EXCEPTION 'shared cart premium_features values must be exact lowercase: %', feature
        USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
