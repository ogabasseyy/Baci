-- Enrollment values for the shared-cart flags must be stored in their
-- canonical exact-lowercase form. Client gates normalize stored values
-- (trim + lowercase) while the SQL cart RPCs and realtime checks use
-- exact jsonb containment, so a non-canonical value would light up
-- client surfaces while every server gate stays closed — a silent
-- half-enabled state. Reject such writes loudly at the database
-- boundary instead of relying on operator discipline.
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
  FOR feature IN
    SELECT value FROM pg_catalog.jsonb_array_elements_text(NEW.premium_features)
  LOOP
    -- Strip the full ECMAScript trim whitespace set (not just the
    -- PostgreSQL \s class, which misses U+00A0/U+FEFF and friends) so
    -- detection matches the client gates' String.trim() + lowercase.
    -- Only edge runs are stripped, matching String.trim(): interior
    -- whitespace stays, so unrelated values remain merely disabled.
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

DROP TRIGGER IF EXISTS commerce_cart_canonical_features_guard
  ON public.merchants;
CREATE TRIGGER commerce_cart_canonical_features_guard
  BEFORE INSERT OR UPDATE OF premium_features ON public.merchants
  FOR EACH ROW
  EXECUTE FUNCTION public.commerce_cart_guard_canonical_features();
