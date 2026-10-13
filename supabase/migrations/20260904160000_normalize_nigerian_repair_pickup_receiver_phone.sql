-- Accept Nigerian local trunk phones (0XXXXXXXXXX) for repair-center
-- projection. App schemas accept 09070007000 via normalizePhoneToE164 →
-- 2349070007000, but is_usable_repair_pickup_phone previously kept the
-- leading 0 and failed ^[1-9]..., so get_repair_pickup_receiver returned {}.

CREATE OR REPLACE FUNCTION public.normalize_repair_pickup_phone_digits(
  p_phone text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_phone IS NULL OR btrim(p_phone) = '' THEN NULL
    ELSE (
      WITH raw AS (
        SELECT
          left(btrim(p_phone), 1) = '+' AS had_plus,
          regexp_replace(btrim(p_phone), '[^0-9]', '', 'g') AS digits
      ),
      normalized AS (
        SELECT CASE
          WHEN digits = '' THEN NULL
          WHEN had_plus AND left(digits, 1) = '0'
            THEN '234' || substring(digits FROM 2)
          WHEN had_plus AND left(digits, 4) = '2340'
            THEN '234' || substring(digits FROM 5)
          WHEN had_plus THEN digits
          WHEN left(digits, 2) = '00' AND substring(digits FROM 3 FOR 4) = '2340'
            THEN '234' || substring(digits FROM 7)
          WHEN left(digits, 2) = '00'
            THEN substring(digits FROM 3)
          WHEN left(digits, 1) = '0'
            THEN '234' || substring(digits FROM 2)
          WHEN left(digits, 4) = '2340'
            THEN '234' || substring(digits FROM 5)
          WHEN left(digits, 3) = '234'
            THEN digits
          ELSE '234' || digits
        END AS value
        FROM raw
      )
      SELECT value FROM normalized
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_usable_repair_pickup_phone(p_phone text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_phone IS NULL OR btrim(p_phone) = '' THEN false
    WHEN lower(btrim(p_phone)) IN ('unknown', 'n/a', 'na', 'none', '-', 'nil')
      THEN false
    ELSE COALESCE(
      public.normalize_repair_pickup_phone_digits(p_phone),
      ''
    ) ~ '^[1-9][0-9]{7,14}$'
  END;
$$;

COMMENT ON FUNCTION public.normalize_repair_pickup_phone_digits(text) IS
  'Normalizes repair-center phones to bare E.164 digits (Nigerian local 0… → 234…).';

COMMENT ON FUNCTION public.is_usable_repair_pickup_phone(text) IS
  'True when a repair-center phone normalizes to a usable E.164 digit string.';

NOTIFY pgrst, 'reload schema';
