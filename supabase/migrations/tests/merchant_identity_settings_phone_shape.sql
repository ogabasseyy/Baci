-- Regression: the guarded identity RPC accepted truncated contact numbers
-- such as "+23415781" (production 2026-09-05, 09-24 and 10-09), which then
-- reached GIG as the sender phone. Changed phone keys must now be complete;
-- saves that leave a stored phone alone keep working. ROLLBACK leaves the
-- replay database unchanged.
\set ON_ERROR_STOP on
BEGIN;

-- The merchants audit trigger refuses writes without an actor (28000), and
-- the fixture insert runs before any JWT claims exist.
SELECT pg_catalog.set_config(
  'app.audit_actor_user_id', 'a3300000-0000-4000-8000-000000000001', true
);

DO $$
DECLARE
  v_user_id uuid := 'a3300000-0000-4000-8000-000000000001';
  v_merchant_id uuid := 'a3300000-0000-4000-8000-000000000002';
  v_session_id uuid := 'a3300000-0000-4000-8000-000000000003';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    v_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'merchant-phone-shape@example.com',
    'test',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb
  );

  INSERT INTO public.merchants (
    id, user_id, email, business_name, slug, phone, support_phone
  ) VALUES (
    v_merchant_id,
    v_user_id,
    'merchant-phone-shape@example.com',
    'Phone Shape Store',
    'phone-shape-store',
    '+2348011111111',
    '+2348022222222'
  );

  INSERT INTO auth.sessions (id, user_id, created_at, updated_at, aal)
  VALUES (v_session_id, v_user_id, now(), now(), 'aal1');
END;
$$;

-- Capture the OCC token as the migration owner; refused calls never use it.
SELECT pg_catalog.set_config(
  'test.phone_shape_updated_at',
  (SELECT updated_at::text FROM public.merchants
    WHERE id = 'a3300000-0000-4000-8000-000000000002'),
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', 'a3300000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'session_id', 'a3300000-0000-4000-8000-000000000003',
    'aal', 'aal1',
    'amr', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'method', 'password',
        'timestamp', extract(epoch from now())::bigint
      )
    )
  )::text,
  true
);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_token timestamptz :=
    pg_catalog.current_setting('test.phone_shape_updated_at')::timestamptz;
  v_key text;
  v_value text;
BEGIN
  FOREACH v_key IN ARRAY ARRAY['phone', 'support_phone'] LOOP
    FOREACH v_value IN ARRAY ARRAY[
      '+23415781', '+23450642', '+23444633', '+234 1578 1',
      '+234814697892', '+23481469789211', '002341578100', '+1234567',
      '15781', '0814+6978921'
    ] LOOP
      BEGIN
        PERFORM public.update_merchant_identity_settings(
          'a3300000-0000-4000-8000-000000000002',
          pg_catalog.jsonb_build_object(v_key, v_value),
          v_token
        );
        RAISE EXCEPTION 'truncated % % was accepted', v_key, v_value;
      EXCEPTION
        WHEN SQLSTATE '22023' THEN
          IF SQLERRM <> 'invalid_support_phone' THEN
            RAISE;
          END IF;
      END;
    END LOOP;
  END LOOP;

  -- Booking reads a store phone without a country code as Nigerian, so a
  -- bare number that is not a complete Nigerian number is refused for phone.
  FOREACH v_value IN ARRAY ARRAY[
    '15781234', '1234567', '23415781', '2341234567', '0241234567',
    '(+44) 7911 123456'
  ] LOOP
    BEGIN
      PERFORM public.update_merchant_identity_settings(
        'a3300000-0000-4000-8000-000000000002',
        pg_catalog.jsonb_build_object('phone', v_value),
        v_token
      );
      RAISE EXCEPTION 'bare phone % was accepted', v_value;
    EXCEPTION
      WHEN SQLSTATE '22023' THEN
        IF SQLERRM <> 'invalid_support_phone' THEN
          RAISE;
        END IF;
    END;
  END LOOP;
END;
$$;

-- A national Nigerian store phone and a bare support phone are both allowed.
SELECT public.update_merchant_identity_settings(
  'a3300000-0000-4000-8000-000000000002',
  '{"phone":"0814 697 8921","support_phone":"15781234"}'::jsonb,
  pg_catalog.current_setting('test.phone_shape_updated_at')::timestamptz
);
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.merchants
     WHERE id = 'a3300000-0000-4000-8000-000000000002'
       AND phone = '0814 697 8921'
       AND support_phone = '15781234'
  ) THEN
    RAISE EXCEPTION 'complete contact phones were not saved';
  END IF;
END;
$$;

-- A stored junk phone must not block an unrelated save.
SELECT pg_catalog.set_config(
  'app.merchant_sensitive_update_authorized', 'true', true
);
UPDATE public.merchants
   SET phone = '+23415781'
 WHERE id = 'a3300000-0000-4000-8000-000000000002';
SELECT pg_catalog.set_config(
  'app.merchant_sensitive_update_authorized', '', true
);
SELECT pg_catalog.set_config(
  'test.phone_shape_updated_at',
  (SELECT updated_at::text FROM public.merchants
    WHERE id = 'a3300000-0000-4000-8000-000000000002'),
  true
);
SET LOCAL ROLE authenticated;
SELECT public.update_merchant_identity_settings(
  'a3300000-0000-4000-8000-000000000002',
  '{"site_description":"Phone shape check"}'::jsonb,
  pg_catalog.current_setting('test.phone_shape_updated_at')::timestamptz
);
RESET ROLE;

ROLLBACK;
