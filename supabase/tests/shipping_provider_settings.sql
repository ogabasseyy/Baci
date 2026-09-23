-- =============================================
-- VERIFICATION: merchant shipping provider opt-in
--   Run against a Supabase branch after applying
--   20260921100200_enforce_merchant_shipping_provider_policy.sql.
--
-- USAGE:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/shipping_provider_settings.sql
-- =============================================

BEGIN;

INSERT INTO public.merchants (
  id, email, business_name, slug, business_type, is_published
)
VALUES (
  '00000000-0000-0000-0000-000000003008',
  'shipping-provider-settings@example.com',
  'Shipping Provider Settings',
  'shipping-provider-settings',
  'electronics',
  true
)
ON CONFLICT (id) DO UPDATE
SET is_published = EXCLUDED.is_published;

-- Recreate the settings row without explicitly supplying shipping_providers:
-- new merchants must default to no live carrier integrations.
DELETE FROM public.merchant_feature_settings
WHERE merchant_id = '00000000-0000-0000-0000-000000003008';

INSERT INTO public.merchant_feature_settings (merchant_id)
VALUES ('00000000-0000-0000-0000-000000003008');

DO $$
DECLARE
  providers jsonb;
BEGIN
  SELECT shipping_providers
  INTO providers
  FROM public.merchant_feature_settings
  WHERE merchant_id = '00000000-0000-0000-0000-000000003008';

  IF providers IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'new merchant shipping providers must default to []: %', providers;
  END IF;
END $$;

DO $$
BEGIN
  IF private.supported_carrier_provider_ids()
    IS DISTINCT FROM ARRAY['gigl', 'topship']::text[] THEN
    RAISE EXCEPTION 'supported carrier helper must define the live catalog';
  END IF;
END $$;

-- Grandfathering: merchants that predate the opt-in flip keep gigl+topship.
-- A NULL row and a missing row must both end up on the prior effective
-- default instead of being normalized to disabled.
INSERT INTO public.merchants (
  id, email, business_name, slug, business_type, is_published
)
VALUES (
  '00000000-0000-0000-0000-000000003020',
  'shipping-provider-grandfather-null@example.com',
  'Shipping Provider Grandfather Null',
  'shipping-provider-grandfather-null',
  'electronics',
  true
), (
  '00000000-0000-0000-0000-000000003021',
  'shipping-provider-grandfather-missing@example.com',
  'Shipping Provider Grandfather Missing',
  'shipping-provider-grandfather-missing',
  'electronics',
  true
)
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.merchant_feature_settings
WHERE merchant_id IN (
  '00000000-0000-0000-0000-000000003020',
  '00000000-0000-0000-0000-000000003021'
);

INSERT INTO public.merchant_feature_settings (merchant_id, shipping_providers)
VALUES ('00000000-0000-0000-0000-000000003020', NULL);

-- Re-apply the migration's grandfathering statements (idempotent).
UPDATE public.merchant_feature_settings
SET shipping_providers = '["gigl", "topship"]'::jsonb
WHERE shipping_providers IS NULL;

INSERT INTO public.merchant_feature_settings (merchant_id, shipping_providers)
SELECT m.id, '["gigl", "topship"]'::jsonb
FROM public.merchants AS m
WHERE m.id IN (
  '00000000-0000-0000-0000-000000003020',
  '00000000-0000-0000-0000-000000003021'
)
AND NOT EXISTS (
  SELECT 1
  FROM public.merchant_feature_settings AS mfs
  WHERE mfs.merchant_id = m.id
)
ON CONFLICT (merchant_id) DO NOTHING;

DO $$
DECLARE
  null_row_providers jsonb;
  missing_row_providers jsonb;
BEGIN
  SELECT shipping_providers
  INTO null_row_providers
  FROM public.merchant_feature_settings
  WHERE merchant_id = '00000000-0000-0000-0000-000000003020';

  SELECT shipping_providers
  INTO missing_row_providers
  FROM public.merchant_feature_settings
  WHERE merchant_id = '00000000-0000-0000-0000-000000003021';

  IF null_row_providers IS DISTINCT FROM '["gigl", "topship"]'::jsonb THEN
    RAISE EXCEPTION 'NULL shipping providers must grandfather to gigl+topship: %',
      null_row_providers;
  END IF;

  IF missing_row_providers IS DISTINCT FROM '["gigl", "topship"]'::jsonb THEN
    RAISE EXCEPTION 'missing settings rows must grandfather to gigl+topship: %',
      missing_row_providers;
  END IF;
END $$;

-- The storefront RPC returns only supported, enabled carrier ids.
UPDATE public.merchant_feature_settings
SET shipping_providers = '["gigl", "shiip", "gigl"]'::jsonb
WHERE merchant_id = '00000000-0000-0000-0000-000000003008';

DO $$
DECLARE
  providers jsonb;
BEGIN
  SELECT public.get_storefront_shipping_rates(
    '00000000-0000-0000-0000-000000003008'
  )->'shipping_providers'
  INTO providers;

  IF providers IS DISTINCT FROM '["gigl"]'::jsonb THEN
    RAISE EXCEPTION 'storefront carrier providers must be sanitized: %', providers;
  END IF;
END $$;

-- merchant and self-fulfillment provider stamps must remain allowed without
-- enabling a carrier: they are durable order metadata, not carrier selections.
INSERT INTO public.orders (
  id, merchant_id, order_number, total, shipping_provider, fulfillment_type
)
VALUES
  (
    '00000000-0000-0000-0000-000000003017',
    '00000000-0000-0000-0000-000000003008',
    'shipping-provider-merchant-rate-test',
    0,
    'MERCHANT',
    NULL
  ),
  (
    '00000000-0000-0000-0000-000000003018',
    '00000000-0000-0000-0000-000000003008',
    'shipping-provider-merchant-pickup-test',
    0,
    'MERCHANT_PICKUP',
    NULL
  ),
  (
    '00000000-0000-0000-0000-000000003019',
    '00000000-0000-0000-0000-000000003008',
    'shipping-provider-self-fulfillment-test',
    0,
    'Self-Delivery',
    'self'
  );

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.orders
    WHERE id IN (
      '00000000-0000-0000-0000-000000003017',
      '00000000-0000-0000-0000-000000003018',
      '00000000-0000-0000-0000-000000003019'
    )
  ) <> 3 THEN
    RAISE EXCEPTION 'merchant and self-fulfillment provider stamps must remain allowed';
  END IF;
END $$;

-- A disabled carrier cannot bypass the opt-in guard by omitting the quote id.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.orders (
      id, merchant_id, order_number, total, shipping_provider
    )
    VALUES (
      '00000000-0000-0000-0000-000000003015',
      '00000000-0000-0000-0000-000000003008',
      'shipping-provider-disabled-without-quote-test',
      0,
      'TOPSHIP'
    );

    RAISE EXCEPTION 'disabled provider must not create an order without a quote id';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%shipping_quote_required%' THEN
        RAISE;
      END IF;
  END;

  IF EXISTS (
    SELECT 1
    FROM public.orders
    WHERE id = '00000000-0000-0000-0000-000000003015'
  ) THEN
    RAISE EXCEPTION 'disabled carrier order without quote id must not be inserted';
  END IF;
END $$;

INSERT INTO public.shipping_quotes (
  id, merchant_id, session_id, provider, price, expires_at
)
VALUES (
  '00000000-0000-0000-0000-000000003009',
  '00000000-0000-0000-0000-000000003008',
  'shipping-provider-settings-test',
  'GIGL',
  0,
  now() + interval '1 hour'
)
ON CONFLICT (id) DO UPDATE
SET merchant_id = EXCLUDED.merchant_id,
    provider = EXCLUDED.provider,
    expires_at = EXCLUDED.expires_at;

-- A disabled provider cannot be attached to a new carrier-backed order.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.orders (
      id, merchant_id, order_number, total, selected_quote_id, shipping_provider
    )
    VALUES (
      '00000000-0000-0000-0000-000000003010',
      '00000000-0000-0000-0000-000000003008',
      'shipping-provider-disabled-test',
      0,
      '00000000-0000-0000-0000-000000003009',
      'TOPSHIP'
    );

    RAISE EXCEPTION 'disabled provider must not create a carrier-backed order';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%shipping_quote_required%' THEN
        RAISE;
      END IF;
  END;

  IF EXISTS (
    SELECT 1
    FROM public.orders
    WHERE id = '00000000-0000-0000-0000-000000003010'
  ) THEN
    RAISE EXCEPTION 'disabled carrier order must not be inserted';
  END IF;
END $$;

-- The retired Shiip value cannot be used even if a stale configuration row
-- still contains it during rollout.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.orders (
      id, merchant_id, order_number, total, selected_quote_id, shipping_provider
    )
    VALUES (
      '00000000-0000-0000-0000-000000003012',
      '00000000-0000-0000-0000-000000003008',
      'shipping-provider-retired-test',
      0,
      '00000000-0000-0000-0000-000000003009',
      'SHIIP'
    );

    RAISE EXCEPTION 'retired carrier must not create a carrier-backed order';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%shipping_quote_required%' THEN
        RAISE;
      END IF;
  END;

  IF EXISTS (
    SELECT 1
    FROM public.orders
    WHERE id = '00000000-0000-0000-0000-000000003012'
  ) THEN
    RAISE EXCEPTION 'retired carrier order must not be inserted';
  END IF;
END $$;

-- The explicitly-enabled carrier remains usable.
INSERT INTO public.orders (
  id, merchant_id, order_number, total, selected_quote_id, shipping_provider
)
VALUES (
  '00000000-0000-0000-0000-000000003011',
  '00000000-0000-0000-0000-000000003008',
  'shipping-provider-enabled-test',
  0,
  '00000000-0000-0000-0000-000000003009',
  'GIGL'
);

-- Turning a carrier off affects new selections only. Existing orders must
-- remain mutable, including updates that fire the trigger with the same
-- carrier-backed selection.
UPDATE public.merchant_feature_settings
SET shipping_providers = '[]'::jsonb
WHERE merchant_id = '00000000-0000-0000-0000-000000003008';

UPDATE public.orders
SET order_number = 'shipping-provider-enabled-test-updated'
WHERE id = '00000000-0000-0000-0000-000000003011';

UPDATE public.orders
SET shipping_provider = shipping_provider
WHERE id = '00000000-0000-0000-0000-000000003011';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.orders
    WHERE id = '00000000-0000-0000-0000-000000003011'
      AND order_number = 'shipping-provider-enabled-test-updated'
      AND shipping_provider = 'GIGL'
  ) THEN
    RAISE EXCEPTION 'existing carrier order must remain mutable after opt-out';
  END IF;
END $$;

-- Clearing a stale selected_quote_id after opt-out is quote invalidation, not
-- a new carrier selection, so it stays allowed while the provider is
-- unchanged. Unrelated updates and unchanged selections remain mutable.
UPDATE public.orders
SET selected_quote_id = NULL
WHERE id = '00000000-0000-0000-0000-000000003011';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.orders
    WHERE id = '00000000-0000-0000-0000-000000003011'
      AND selected_quote_id IS NULL
  ) THEN
    RAISE EXCEPTION 'clearing a stale carrier selection after opt-out must succeed';
  END IF;
END $$;

-- Changing a carrier selection after opt-out must still be rejected.
DO $$
BEGIN
  BEGIN
    UPDATE public.orders
    SET selected_quote_id = '00000000-0000-0000-0000-000000003009'
    WHERE id = '00000000-0000-0000-0000-000000003011';

    RAISE EXCEPTION 'changing a carrier selection after opt-out must be rejected';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%shipping_quote_required%' THEN
        RAISE;
      END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = '00000000-0000-0000-0000-000000003011'
      AND selected_quote_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'rejected carrier selection change must not persist';
  END IF;
END $$;

-- Mixed-case persisted settings are normalized by the guard before comparing
-- the supported provider selected by a new carrier-backed order.
UPDATE public.merchant_feature_settings
SET shipping_providers = '["GIGL"]'::jsonb
WHERE merchant_id = '00000000-0000-0000-0000-000000003008';

INSERT INTO public.orders (
  id, merchant_id, order_number, total, selected_quote_id, shipping_provider
)
VALUES (
  '00000000-0000-0000-0000-000000003016',
  '00000000-0000-0000-0000-000000003008',
  'shipping-provider-mixed-case-test',
  0,
  '00000000-0000-0000-0000-000000003009',
  'gigl'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.orders
    WHERE id = '00000000-0000-0000-0000-000000003016'
  ) THEN
    RAISE EXCEPTION 'mixed-case stored carrier settings must authorize a new selection';
  END IF;
END $$;

ROLLBACK;
