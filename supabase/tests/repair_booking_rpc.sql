-- =============================================
-- VERIFICATION: repair booking RPC ACL + repairs anon hardening
--   Run against a Supabase branch after applying the repairs migrations.
--
-- USAGE:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/repair_booking_rpc.sql
-- =============================================

BEGIN;

-- Public wrapper: SECURITY INVOKER, pinned search_path, anon + authenticated can EXECUTE.
DO $$
DECLARE
  is_definer boolean;
  config text[];
BEGIN
  SELECT prosecdef, proconfig INTO is_definer, config
  FROM pg_proc
  WHERE oid = 'public.create_repair_booking(uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid)'::regprocedure;

  IF is_definer IS NOT FALSE THEN
    RAISE EXCEPTION 'public.create_repair_booking must be SECURITY INVOKER';
  END IF;

  -- Wrapper must pin search_path = '' (hardening migration 20260711100009).
  IF config IS NULL OR NOT EXISTS (
    SELECT 1 FROM unnest(config) AS entry
    WHERE entry LIKE 'search_path=%'
      AND trim(both '"' from split_part(entry, '=', 2)) = ''
  ) THEN
    RAISE EXCEPTION 'public.create_repair_booking must SET search_path = ''''';
  END IF;

  IF NOT has_function_privilege('anon',
    'public.create_repair_booking(uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'anon must have EXECUTE on public.create_repair_booking';
  END IF;

  IF NOT has_function_privilege('authenticated',
    'public.create_repair_booking(uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must have EXECUTE on public.create_repair_booking';
  END IF;
END $$;

-- Private fn: SECURITY DEFINER, empty search_path, anon can EXECUTE (invoker wrapper).
DO $$
DECLARE
  is_definer boolean;
  config text[];
BEGIN
  SELECT prosecdef, proconfig
  INTO is_definer, config
  FROM pg_proc
  WHERE oid = 'private.create_repair_booking(uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid)'::regprocedure;

  IF is_definer IS NOT TRUE THEN
    RAISE EXCEPTION 'private.create_repair_booking must be SECURITY DEFINER';
  END IF;
  -- proconfig serializes an empty search_path as search_path= or search_path=""
  IF config IS NULL OR NOT EXISTS (
    SELECT 1 FROM unnest(config) AS entry
    WHERE entry LIKE 'search_path=%'
      AND trim(both '"' from split_part(entry, '=', 2)) = ''
  ) THEN
    RAISE EXCEPTION 'private.create_repair_booking must SET search_path = ''''';
  END IF;

  IF NOT has_function_privilege('anon',
    'private.create_repair_booking(uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'anon must have EXECUTE on private.create_repair_booking (invoker wrapper)';
  END IF;
END $$;

-- The limiter counts and insert must be serialized for each merchant so
-- concurrent valid bookings cannot both observe a below-limit count.
DO $$
DECLARE
  definition text;
  lock_offset integer;
  first_count_offset integer;
BEGIN
  SELECT pg_get_functiondef(
    'private.create_repair_booking(uuid, text, text, text, text, text, text, timestamptz, text, text, uuid, uuid)'::regprocedure
  )
  INTO definition;

  lock_offset := strpos(definition, 'pg_advisory_xact_lock');
  first_count_offset := strpos(definition, 'SELECT count(*) INTO v_per_email_count');

  IF definition !~ 'pg_advisory_xact_lock\s*\(\s*pg_catalog\.hashtextextended\s*\(\s*p_merchant_id::text\s*,\s*0\s*\)\s*\)'
    OR lock_offset = 0
    OR lock_offset > first_count_offset THEN
    RAISE EXCEPTION 'private.create_repair_booking must lock a merchant before rate-limit counts';
  END IF;
END $$;

-- Anon must have NO direct DML on repairs and the public INSERT policy must be gone.
DO $$
BEGIN
  IF has_table_privilege('anon', 'public.repairs', 'INSERT') THEN
    RAISE EXCEPTION 'anon must NOT have INSERT on public.repairs after hardening';
  END IF;
  IF has_table_privilege('anon', 'public.repairs', 'SELECT') THEN
    RAISE EXCEPTION 'anon must NOT have SELECT on public.repairs after hardening';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.repairs'::regclass
      AND polname = 'Public can create repair requests'
  ) THEN
    RAISE EXCEPTION 'the public repairs INSERT policy must be dropped';
  END IF;
END $$;

-- Direct RPC callers bypass app-layer Zod, so the function must reject malformed
-- payloads and normalize accepted values itself.
INSERT INTO public.merchants (
  id, email, business_name, slug, business_type, is_published
)
VALUES (
  '00000000-0000-0000-0000-000000003006',
  'repair-rpc-validation@example.com',
  'Repair RPC Validation',
  'repair-rpc-validation',
  'electronics',
  true
)
ON CONFLICT (id) DO UPDATE
SET business_type = EXCLUDED.business_type,
    is_published = EXCLUDED.is_published;

UPDATE public.merchant_feature_settings
SET repairs_catalog_enabled = true
WHERE merchant_id = '00000000-0000-0000-0000-000000003006';

INSERT INTO public.merchant_feature_settings (
  merchant_id, repairs_catalog_enabled
)
SELECT '00000000-0000-0000-0000-000000003006', true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.merchant_feature_settings
  WHERE merchant_id = '00000000-0000-0000-0000-000000003006'
);

DO $$
BEGIN
  PERFORM *
  FROM public.create_repair_booking(
    '00000000-0000-0000-0000-000000003006',
    'Ada Lovelace',
    'not-an-email',
    '08012345678',
    'Smartphone',
    'iPhone 15',
    'The screen is cracked and the battery drains quickly.',
    NULL,
    'dropoff',
    NULL,
    NULL,
    NULL
  );

  RAISE EXCEPTION 'direct RPC must reject invalid customer email';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%invalid_customer_email%' THEN
      RAISE;
    END IF;
END $$;

-- ordinary email and phone values must pass the repair booking validator;
-- dollar-quoted function bodies use single regex escapes.
DO $$
DECLARE
  created record;
BEGIN
  SELECT *
  INTO created
  FROM public.create_repair_booking(
    '00000000-0000-0000-0000-000000003006',
    '  Ada Lovelace  ',
    '  ADA@EXAMPLE.COM  ',
    ' 08012345678 ',
    'Smartphone',
    '  iPhone 15  ',
    '  The screen is cracked and the battery drains quickly.  ',
    NULL,
    'dropoff',
    NULL,
    NULL,
    NULL
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.repairs AS r
    WHERE r.id = created.id
      AND r.customer_name = 'Ada Lovelace'
      AND r.customer_email = 'ada@example.com'
      AND r.customer_phone = '08012345678'
      AND r.device_model = 'iPhone 15'
      AND r.issue_description = 'The screen is cracked and the battery drains quickly.'
  ) THEN
    RAISE EXCEPTION 'direct RPC must store normalized booking values';
  END IF;
END $$;

-- The free-form legacy booking branch (no quote and no device id) must use the
-- same electronics/gadgets + published + flag gate as catalogue bookings.
INSERT INTO public.merchants (
  id, email, business_name, slug, business_type, is_published
)
VALUES (
  '00000000-0000-0000-0000-000000003007',
  'repair-rpc-ineligible@example.com',
  'Repair RPC Ineligible',
  'repair-rpc-ineligible',
  'fashion',
  true
)
ON CONFLICT (id) DO UPDATE
SET business_type = EXCLUDED.business_type,
    is_published = EXCLUDED.is_published;

UPDATE public.merchant_feature_settings
SET repairs_catalog_enabled = true
WHERE merchant_id = '00000000-0000-0000-0000-000000003007';

INSERT INTO public.merchant_feature_settings (
  merchant_id, repairs_catalog_enabled
)
SELECT '00000000-0000-0000-0000-000000003007', true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.merchant_feature_settings
  WHERE merchant_id = '00000000-0000-0000-0000-000000003007'
);

DO $$
BEGIN
  BEGIN
    PERFORM *
    FROM public.create_repair_booking(
      '00000000-0000-0000-0000-000000003007',
      'Ada Lovelace',
      'ada@example.com',
      '08012345678',
      'Smartphone',
      'iPhone 15',
      'The screen is cracked and the battery drains quickly.',
      NULL,
      'dropoff',
      NULL,
      NULL,
      NULL
    );

    RAISE EXCEPTION 'free-form repair booking must reject an ineligible merchant';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%catalog_disabled%' THEN
        RAISE;
      END IF;
  END;

  IF EXISTS (
    SELECT 1
    FROM public.repairs AS r
    WHERE r.merchant_id = '00000000-0000-0000-0000-000000003007'
  ) THEN
    RAISE EXCEPTION 'ineligible merchant must not receive a free-form repair booking';
  END IF;
END $$;

-- The shared public gate also rejects electronics/gadgets merchants when the
-- storefront is unpublished or the repairs catalog feature is disabled.
INSERT INTO public.merchants (
  id, email, business_name, slug, business_type, is_published
)
VALUES
  (
    '00000000-0000-0000-0000-000000003013',
    'repair-rpc-unpublished@example.com',
    'Repair RPC Unpublished',
    'repair-rpc-unpublished',
    'electronics',
    false
  ),
  (
    '00000000-0000-0000-0000-000000003014',
    'repair-rpc-disabled@example.com',
    'Repair RPC Disabled',
    'repair-rpc-disabled',
    'gadgets',
    true
  )
ON CONFLICT (id) DO UPDATE
SET business_type = EXCLUDED.business_type,
    is_published = EXCLUDED.is_published;

UPDATE public.merchant_feature_settings
SET repairs_catalog_enabled = CASE merchant_id
  WHEN '00000000-0000-0000-0000-000000003013'::uuid THEN true
  WHEN '00000000-0000-0000-0000-000000003014'::uuid THEN false
  ELSE repairs_catalog_enabled
END
WHERE merchant_id IN (
  '00000000-0000-0000-0000-000000003013',
  '00000000-0000-0000-0000-000000003014'
);

INSERT INTO public.merchant_feature_settings (
  merchant_id, repairs_catalog_enabled
)
SELECT fixture.merchant_id, fixture.repairs_catalog_enabled
FROM (
  VALUES
    ('00000000-0000-0000-0000-000000003013'::uuid, true),
    ('00000000-0000-0000-0000-000000003014'::uuid, false)
) AS fixture(merchant_id, repairs_catalog_enabled)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.merchant_feature_settings AS mfs
  WHERE mfs.merchant_id = fixture.merchant_id
);

DO $$
DECLARE
  target_merchant_id uuid;
BEGIN
  FOREACH target_merchant_id IN ARRAY ARRAY[
    '00000000-0000-0000-0000-000000003013'::uuid,
    '00000000-0000-0000-0000-000000003014'::uuid
  ]
  LOOP
    BEGIN
      PERFORM *
      FROM public.create_repair_booking(
        target_merchant_id,
        'Ada Lovelace',
        'ada@example.com',
        '08012345678',
        'Smartphone',
        'iPhone 15',
        'The screen is cracked and the battery drains quickly.',
        NULL,
        'dropoff',
        NULL,
        NULL,
        NULL
      );

      RAISE EXCEPTION 'disabled repair catalog must reject a booking';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%catalog_disabled%' THEN
          RAISE;
        END IF;
    END;

    IF EXISTS (
      SELECT 1
      FROM public.repairs AS r
      WHERE r.merchant_id = target_merchant_id
    ) THEN
      RAISE EXCEPTION 'disabled repair catalog must not receive a booking';
    END IF;
  END LOOP;
END $$;

ROLLBACK;
