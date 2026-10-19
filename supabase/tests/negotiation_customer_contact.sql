-- Regression coverage for 20260821100000_enforce_negotiation_customer_contact.
-- Run against a migrated local/test database. All fixtures roll back.

BEGIN;

DO $$
DECLARE
  anon_roles text;
  authenticated_roles text;
  anon_check text;
  authenticated_check text;
BEGIN
  SELECT
    array_to_string(polroles::regrole[]::text[], ','),
    pg_get_expr(polwithcheck, polrelid)
  INTO anon_roles, anon_check
  FROM pg_policy
  WHERE polrelid = 'public.negotiation_requests'::regclass
    AND polname = 'Guests can create reachable negotiation requests';

  SELECT
    array_to_string(polroles::regrole[]::text[], ','),
    pg_get_expr(polwithcheck, polrelid)
  INTO authenticated_roles, authenticated_check
  FROM pg_policy
  WHERE polrelid = 'public.negotiation_requests'::regclass
    AND polname = 'Customers can create reachable negotiation requests';

  IF anon_roles IS NULL
    OR anon_check IS NULL
    OR anon_roles NOT LIKE '%anon%'
    OR anon_check NOT LIKE '%customer_id IS NULL%'
    OR anon_check NOT LIKE '%btrim(session_id)%'
  THEN
    RAISE EXCEPTION 'guest negotiation insert policy is not scoped safely';
  END IF;

  IF authenticated_roles IS NULL
    OR authenticated_check IS NULL
    OR authenticated_roles NOT LIKE '%authenticated%'
    OR authenticated_check NOT LIKE '%auth.uid()%'
    OR authenticated_check NOT LIKE '%btrim(session_id)%'
  THEN
    RAISE EXCEPTION 'authenticated negotiation insert policy is not scoped safely';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.negotiation_requests'::regclass
      AND tgname = 'enforce_negotiation_customer_contact'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'negotiation contact enforcement trigger is missing';
  END IF;
END;
$$;

ALTER TABLE public.negotiation_requests
  DISABLE TRIGGER trigger_new_negotiation;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
VALUES (
  'f42e4d43-0000-4000-8000-000000000102',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'negotiation-contact-owner@example.com',
  'test',
  now(),
  now(),
  now(),
  '{}',
  '{}'
);

SELECT pg_catalog.set_config(
  'app.audit_actor_user_id',
  'f42e4d43-0000-4000-8000-000000000102',
  true
);

INSERT INTO public.merchants (id, user_id, email, business_name, slug)
VALUES (
  'f42e4d43-0000-4000-8000-000000000101',
  'f42e4d43-0000-4000-8000-000000000102',
  'negotiation-contact-owner@example.com',
  'Negotiation Contact Test',
  'negotiation-contact-test'
);

-- Simulate a historical contactless row created before the enforcement trigger.
ALTER TABLE public.negotiation_requests
  DISABLE TRIGGER enforce_negotiation_customer_contact;
INSERT INTO public.negotiation_requests (
  id, merchant_id, customer_id, customer_email, customer_phone,
  session_id, type, offered_price, status
)
VALUES
  (
    'f42e4d43-0000-4000-8000-000000000103',
    'f42e4d43-0000-4000-8000-000000000101',
    NULL,
    NULL,
    NULL,
    'legacy-mobile-session',
    'single',
    9000,
    'pending'
  ),
  (
    'f42e4d43-0000-4000-8000-000000000106',
    'f42e4d43-0000-4000-8000-000000000101',
    NULL,
    'Legacy@Example.COM',
    '2348031234567',
    'legacy-format-session',
    'single',
    9000,
    'pending'
  );
ALTER TABLE public.negotiation_requests
  ENABLE TRIGGER enforce_negotiation_customer_contact;

DO $$
DECLARE
  invalid_contact text;
BEGIN
  -- Status-only updates must keep working for legacy rows.
  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claim.sub',
    'f42e4d43-0000-4000-8000-000000000102',
    true
  );
  UPDATE public.negotiation_requests
  SET status = 'rejected'
  WHERE id = 'f42e4d43-0000-4000-8000-000000000103';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'legacy status-only update was blocked';
  END IF;
  RESET ROLE;

  -- The trigger protects even RLS-bypassing writers.
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE public.negotiation_requests
  SET customer_phone = '2348031234568'
  WHERE id = 'f42e4d43-0000-4000-8000-000000000106';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'legacy unchanged email format blocked a phone correction';
  END IF;

  BEGIN
    INSERT INTO public.negotiation_requests (
      merchant_id, session_id, type, offered_price
    ) VALUES (
      'f42e4d43-0000-4000-8000-000000000101',
      'service-contactless',
      'single',
      9000
    );
    RAISE EXCEPTION 'contactless service-role insert unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN
      IF SQLERRM <> 'negotiation_customer_contact_required' THEN
        RAISE;
      END IF;
  END;

  -- These format and length cases also run as service_role so the assertions
  -- prove trigger enforcement independently of RLS.
  FOREACH invalid_contact IN ARRAY ARRAY[
    '08031234567',
    '+2348031234567',
    ' 2348031234567 '
  ] LOOP
    BEGIN
      INSERT INTO public.negotiation_requests (
        merchant_id, customer_phone, session_id, type, offered_price
      ) VALUES (
        'f42e4d43-0000-4000-8000-000000000101',
        invalid_contact,
        'invalid-phone-' || md5(invalid_contact),
        'single',
        9000
      );
      RAISE EXCEPTION 'invalid phone unexpectedly succeeded: %', invalid_contact;
    EXCEPTION
      WHEN check_violation THEN
        IF SQLERRM <> 'invalid_negotiation_customer_phone' THEN
          RAISE;
        END IF;
    END;
  END LOOP;

  FOREACH invalid_contact IN ARRAY ARRAY[
    'x',
    'buyer@example',
    ' buyer@example.com ',
    'Buyer@Example.COM',
    repeat('a', 243) || '@example.com'
  ] LOOP
    BEGIN
      INSERT INTO public.negotiation_requests (
        merchant_id, customer_email, session_id, type, offered_price
      ) VALUES (
        'f42e4d43-0000-4000-8000-000000000101',
        invalid_contact,
        'invalid-email-' || md5(invalid_contact),
        'single',
        9000
      );
      RAISE EXCEPTION 'invalid email unexpectedly succeeded: %', invalid_contact;
    EXCEPTION
      WHEN check_violation THEN
        IF SQLERRM <> 'invalid_negotiation_customer_email' THEN
          RAISE;
        END IF;
    END;
  END LOOP;

  INSERT INTO public.negotiation_requests (
    merchant_id, customer_email, session_id, type, offered_price
  ) VALUES (
    'f42e4d43-0000-4000-8000-000000000101',
    repeat('a', 242) || '@example.com',
    'valid-email-254',
    'single',
    9000
  );
  RESET ROLE;

  -- A normalized phone is accepted for an anonymous guest.
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO public.negotiation_requests (
    merchant_id, customer_id, customer_phone, session_id, type, offered_price
  ) VALUES (
    'f42e4d43-0000-4000-8000-000000000101',
    NULL,
    '2348031234567',
    'guest-phone',
    'single',
    9000
  );

  -- Guests cannot claim another account ID.
  BEGIN
    INSERT INTO public.negotiation_requests (
      merchant_id, customer_id, customer_phone, session_id, type, offered_price
    ) VALUES (
      'f42e4d43-0000-4000-8000-000000000101',
      'f42e4d43-0000-4000-8000-000000000104',
      '2348031234567',
      'guest-spoof',
      'single',
      9000
    );
    RAISE EXCEPTION 'guest customer_id spoof unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- Authenticated customers may use verified email but may not claim another ID.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claim.sub',
    'f42e4d43-0000-4000-8000-000000000105',
    true
  );
  INSERT INTO public.negotiation_requests (
    merchant_id, customer_id, customer_email, session_id, type, offered_price
  ) VALUES (
    'f42e4d43-0000-4000-8000-000000000101',
    'f42e4d43-0000-4000-8000-000000000105',
    'buyer@example.com',
    'authenticated-email',
    'single',
    9000
  );

  BEGIN
    INSERT INTO public.negotiation_requests (
      merchant_id, customer_id, customer_email, session_id, type, offered_price
    ) VALUES (
      'f42e4d43-0000-4000-8000-000000000101',
      'f42e4d43-0000-4000-8000-000000000106',
      'buyer@example.com',
      'authenticated-spoof',
      'single',
      9000
    );
    RAISE EXCEPTION 'authenticated customer_id spoof unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
END;
$$;

ALTER TABLE public.negotiation_requests
  ENABLE TRIGGER trigger_new_negotiation;

ROLLBACK;
