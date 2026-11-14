-- Exercise the add wrapper with the real private PDP snapshot and canonical
-- cart mutation RPC in this suite's disposable merchant/catalog fixture.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

UPDATE public.merchants
SET premium_features = coalesce(premium_features, '[]'::jsonb) || '["shared_cart"]'::jsonb
WHERE id = '4d19ab10-0000-4000-8000-000000000001'::uuid;
UPDATE public.products
SET default_variant_id = '4d19ab10-0000-4000-8000-000000000006'::uuid
WHERE id = '4d19ab10-0000-4000-8000-000000000005'::uuid;
INSERT INTO public.commerce_carts(id, merchant_id, expires_at)
VALUES (
  '4d19ab10-0000-4000-8000-000000000040'::uuid,
  '4d19ab10-0000-4000-8000-000000000001'::uuid,
  now() + interval '1 day'
);
INSERT INTO public.commerce_cart_grants(id, merchant_id, cart_id, principal_id, allowed_operations, expires_at)
VALUES (
  '4d19ab10-0000-4000-8000-000000000041'::uuid,
  '4d19ab10-0000-4000-8000-000000000001'::uuid,
  '4d19ab10-0000-4000-8000-000000000040'::uuid,
  'snapshot-chatwoot-shopper',
  ARRAY['add']::text[],
  now() + interval '1 day'
);

DO $snapshot_contract$
DECLARE
  snapshot jsonb;
BEGIN
  SELECT product_data INTO snapshot
  FROM private.get_storefront_pdp_core_v2(
    '4d19ab10-0000-4000-8000-000000000001'::uuid,
    'serialized-snapshot-phone',
    NULL
  )
  WHERE resolution_status = 'found';
  IF snapshot IS NULL
    OR jsonb_typeof(snapshot->'has_variants') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(snapshot->'has_condition_offers') IS DISTINCT FROM 'boolean'
    OR snapshot->>'merchant_id' IS DISTINCT FROM '4d19ab10-0000-4000-8000-000000000001'
    OR (snapshot->>'stock_quantity')::integer IS DISTINCT FROM 1
    OR (snapshot->>'manage_stock')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'real PDP snapshot no longer matches chatwoot add requirements: %', snapshot;
  END IF;

  SELECT product_data INTO snapshot
  FROM private.get_storefront_pdp_core_v2(
    '4d19ab10-0000-4000-8000-000000000001'::uuid,
    'variant-snapshot-phone',
    NULL
  )
  WHERE resolution_status = 'found';
  IF snapshot IS NULL
    OR jsonb_typeof(snapshot->'has_variants') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(snapshot->'product_variants') IS DISTINCT FROM 'array'
    OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(snapshot->'product_variants') AS variants(item)
      WHERE item->>'id' = '4d19ab10-0000-4000-8000-000000000006'
        AND item->>'product_id' = '4d19ab10-0000-4000-8000-000000000005'
        AND jsonb_typeof(item->'attributes') = 'object'
        AND (item->>'stock_quantity')::integer = 1
    ) THEN
    RAISE EXCEPTION 'real variant PDP projection lost required identity/inventory fields: %', snapshot;
  END IF;
END;
$snapshot_contract$;

SET LOCAL ROLE commerce_cart_shopper;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'role', 'commerce_cart_shopper',
  'exp', extract(epoch FROM now())::bigint + 300,
  'cart_scope', 'session',
  'cart_merchant_id', '4d19ab10-0000-4000-8000-000000000001',
  'cart_principal_id', 'snapshot-chatwoot-shopper',
  'cart_id', '4d19ab10-0000-4000-8000-000000000040',
  'cart_grant_id', '4d19ab10-0000-4000-8000-000000000041'
)::text, true);

DO $chatwoot_add$
DECLARE
  result jsonb;
BEGIN
  result := public.commerce_cart_add_chatwoot(
    '4d19ab10-0000-4000-8000-000000000040'::uuid,
    'snapshot-simple-add', 1, 'serialized-snapshot-phone', NULL
  );
  IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'replayed' IS DISTINCT FROM 'false'
    OR (SELECT quantity FROM public.commerce_cart_lines WHERE cart_id='4d19ab10-0000-4000-8000-000000000040' AND product_id='4d19ab10-0000-4000-8000-000000000003') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'real simple-product PDP add failed: %', result;
  END IF;

  result := public.commerce_cart_add_chatwoot(
    '4d19ab10-0000-4000-8000-000000000040'::uuid,
    'snapshot-default-variant-add', 2, 'variant-snapshot-phone',
    '4d19ab10-0000-4000-8000-000000000006'::uuid
  );
  IF result->>'ok' IS DISTINCT FROM 'true'
    OR NOT EXISTS (SELECT 1 FROM public.commerce_cart_lines WHERE cart_id='4d19ab10-0000-4000-8000-000000000040' AND variant_id='4d19ab10-0000-4000-8000-000000000006') THEN
    RAISE EXCEPTION 'real default-variant PDP add failed: %', result;
  END IF;
END;
$chatwoot_add$;

RESET ROLE;
UPDATE public.products SET status='inactive'
WHERE id IN (
  '4d19ab10-0000-4000-8000-000000000003'::uuid,
  '4d19ab10-0000-4000-8000-000000000005'::uuid
);
UPDATE public.commerce_carts SET state='checkout'
WHERE id='4d19ab10-0000-4000-8000-000000000040'::uuid;
SET LOCAL ROLE commerce_cart_shopper;

DO $chatwoot_replay$
DECLARE
  result jsonb;
BEGIN
  result := public.commerce_cart_add_chatwoot(
    '4d19ab10-0000-4000-8000-000000000040'::uuid,
    'snapshot-simple-add', 1, 'serialized-snapshot-phone', NULL
  );
  IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'replayed' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'real simple-product receipt did not replay after catalog deactivation: %', result;
  END IF;
  result := public.commerce_cart_add_chatwoot(
    '4d19ab10-0000-4000-8000-000000000040'::uuid,
    'snapshot-default-variant-add', 2, 'variant-snapshot-phone',
    '4d19ab10-0000-4000-8000-000000000006'::uuid
  );
  IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'replayed' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'real variant receipt did not replay after catalog deactivation: %', result;
  END IF;
  result := public.commerce_cart_add_chatwoot(
    '4d19ab10-0000-4000-8000-000000000040'::uuid,
    'snapshot-locked-new-add', 3, 'serialized-snapshot-phone', NULL
  );
  IF result->>'code' IS DISTINCT FROM 'cart_locked' THEN
    RAISE EXCEPTION 'locked real cart accepted a new add: %', result;
  END IF;
END;
$chatwoot_replay$;

RESET ROLE;
