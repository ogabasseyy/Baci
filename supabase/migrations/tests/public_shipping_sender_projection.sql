-- REGRESSION TEST: the public shipping sender projection exposes only published
-- merchant origins and only to the roles required by storefront quote flows.

BEGIN;

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (
  id,
  email,
  business_name,
  business_address,
  phone,
  country,
  state_code,
  slug,
  is_published
)
VALUES
  (
    '72a63d82-0000-4000-8000-000000000001',
    'published-shipping-sender@example.com',
    'Published Shipping Sender',
    '29 Yedseram Crescent, Maitama, 904101',
    '08012345678',
    'NG',
    'FC',
    'published-shipping-sender',
    true
  ),
  (
    '72a63d82-0000-4000-8000-000000000002',
    'private-shipping-sender@example.com',
    'Private Shipping Sender',
    '1 Private Road, Lagos',
    '08087654321',
    'NG',
    'LA',
    'private-shipping-sender',
    false
  );

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);

DO $test$
BEGIN
  IF public.get_storefront_shipping_sender(
    '72a63d82-0000-4000-8000-000000000001'
  ) ->> 'business_name' IS DISTINCT FROM 'Published Shipping Sender' THEN
    RAISE EXCEPTION 'anon did not receive the published merchant projection';
  END IF;

  IF public.get_storefront_shipping_sender(
    '72a63d82-0000-4000-8000-000000000002'
  ) IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'anon received an unpublished merchant projection';
  END IF;

  IF public.get_storefront_shipping_sender(
    '72a63d82-0000-4000-8000-000000000003'
  ) IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'anon received data for a missing merchant';
  END IF;
END;
$test$;

RESET ROLE;

DO $test$
DECLARE
  v_unexpected_grantees text[];
BEGIN
  IF NOT has_function_privilege(
    'anon',
    'public.get_storefront_shipping_sender(uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.get_storefront_shipping_sender(uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.get_storefront_shipping_sender(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'required storefront roles cannot execute sender projection';
  END IF;

  SELECT array_agg(role_name ORDER BY role_name)
  INTO v_unexpected_grantees
  FROM (
    SELECT COALESCE(role.rolname, 'PUBLIC') AS role_name
    FROM pg_catalog.pg_proc AS procedure
    CROSS JOIN LATERAL aclexplode(procedure.proacl) AS privilege
    LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = privilege.grantee
    WHERE procedure.oid =
      'public.get_storefront_shipping_sender(uuid)'::regprocedure
      AND privilege.privilege_type = 'EXECUTE'
      AND privilege.grantee <> procedure.proowner
      AND COALESCE(role.rolname, 'PUBLIC') NOT IN (
        'anon',
        'authenticated',
        'service_role'
      )
  ) AS unexpected;

  IF v_unexpected_grantees IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected sender projection grantees: %',
      v_unexpected_grantees;
  END IF;
END;
$test$;

ROLLBACK;
