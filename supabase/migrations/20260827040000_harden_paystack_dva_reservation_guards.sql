-- Close the remaining authenticated Paystack DVA reservation edges.
--
-- The application signer and database verifier use the same Supabase
-- service_role_key Vault entry. Fail closed when it is unavailable.
CREATE OR REPLACE FUNCTION public.paystack_dva_reservation_proof_valid(
  p_proof jsonb,
  p_order_id uuid,
  p_account_number text,
  p_bank_name text,
  p_account_name text,
  p_assigned_at timestamptz,
  p_expires_at timestamptz,
  p_customer_email text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_account_name text := COALESCE(p_proof->>'account_name', '');
  v_account_number text := COALESCE(p_proof->>'account_number', '');
  v_assigned_at_text text := COALESCE(p_proof->>'assigned_at', '');
  v_assigned_at timestamptz;
  v_bank_name text := COALESCE(p_proof->>'bank_name', '');
  v_canonical text;
  v_customer_email text := COALESCE(p_proof->>'customer_email', '');
  v_expires_at_text text := COALESCE(p_proof->>'expires_at', '');
  v_expires_at timestamptz;
  v_issued_at text := COALESCE(p_proof->>'issued_at', '');
  v_issued_at_at timestamptz;
  v_order_id text := COALESCE(p_proof->>'order_id', '');
  v_secret text;
  v_signature text := COALESCE(p_proof->>'signature', '');
  v_expected_signature text;
  v_scope text := COALESCE(p_proof->>'scope', '');
  v_version text := COALESCE(p_proof->>'version', '');
BEGIN
  -- The application signer and database verifier both use the Supabase
  -- service-role key. Fail closed when the Vault entry is unavailable.
  IF pg_catalog.to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
      INTO v_secret
      USING 'service_role_key';
  END IF;

  IF p_proof IS NULL
    OR v_version <> 'paystack-dva-reservation:v1'
    OR v_scope <> 'paystack_dva_reservation'
    OR v_order_id <> COALESCE(p_order_id::text, '')
    OR v_account_number <> COALESCE(pg_catalog.btrim(p_account_number), '')
    OR v_bank_name <> COALESCE(pg_catalog.btrim(p_bank_name), '')
    OR v_account_name <> COALESCE(pg_catalog.btrim(p_account_name), '')
    OR v_customer_email <> lower(COALESCE(pg_catalog.btrim(p_customer_email), ''))
    OR v_signature !~ '^[0-9a-f]{64}$'
    OR v_issued_at = ''
    OR v_assigned_at_text = ''
    OR v_expires_at_text = ''
    OR v_secret IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_issued_at_at := v_issued_at::timestamptz;
    v_assigned_at := v_assigned_at_text::timestamptz;
    v_expires_at := v_expires_at_text::timestamptz;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  IF v_issued_at_at < pg_catalog.now() - INTERVAL '5 minutes'
    OR v_issued_at_at > pg_catalog.now() + INTERVAL '30 seconds'
    OR v_assigned_at IS DISTINCT FROM p_assigned_at
    OR v_expires_at IS DISTINCT FROM p_expires_at
    OR v_expires_at <= v_assigned_at THEN
    RETURN false;
  END IF;

  v_canonical := v_version || E'\n' || v_scope || E'\n' || v_order_id
    || E'\n' || v_customer_email || E'\n' || v_account_number
    || E'\n' || v_bank_name || E'\n' || v_account_name
    || E'\n' || v_assigned_at_text || E'\n' || v_expires_at_text
    || E'\n' || v_issued_at;
  v_expected_signature := pg_catalog.encode(
    extensions.hmac(v_canonical, v_secret, 'sha256'),
    'hex'
  );

  RETURN extensions.digest(v_signature, 'sha256') =
    extensions.digest(v_expected_signature, 'sha256');
END;
$$;

REVOKE ALL ON FUNCTION public.paystack_dva_reservation_proof_valid(
  jsonb, uuid, text, text, text, timestamptz, timestamptz, text
) FROM PUBLIC, anon, authenticated, service_role;

-- A proof-bound reservation is the only authenticated insert path. The
-- baseline table grant and policy otherwise let a merchant fabricate a
-- Paystack alias directly through PostgREST.
DROP POLICY IF EXISTS owners_and_staff_insert_order_payment_accounts
  ON public.order_payment_accounts;
REVOKE INSERT ON TABLE public.order_payment_accounts FROM anon, authenticated;

-- A verified invoice proof is server-generated and binds the explicit invoice
-- expiry. Keep the normal 90-minute limit for every other authenticated write.
CREATE OR REPLACE FUNCTION public.bound_authenticated_paystack_alias_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_internal_verified boolean :=
    pg_catalog.current_setting(
      'baci.paystack_dva_reservation_verified', true
    ) = 'on';
BEGIN
  IF NEW.provider = 'paystack'
    AND COALESCE(auth.role(), '') <> 'service_role' THEN
    IF TG_OP = 'UPDATE' AND OLD.provider = 'paystack_version' THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE'
      AND OLD.provider = 'paystack'
      AND NEW.provider = 'paystack'
      AND NEW.assigned_at IS NOT DISTINCT FROM OLD.assigned_at
      AND NEW.expires_at IS NOT NULL
      AND NEW.expires_at <= COALESCE(
        OLD.expires_at,
        OLD.assigned_at + interval '90 minutes',
        OLD.created_at + interval '90 minutes'
      ) THEN
      RETURN NEW;
    END IF;
    IF NEW.assigned_at IS NULL
      OR NEW.expires_at IS NULL
      OR NEW.assigned_at < now() - interval '5 minutes'
      OR NEW.assigned_at > now() + interval '5 minutes'
      OR NEW.expires_at <= NEW.assigned_at
      OR (
        NOT v_internal_verified
        AND NEW.expires_at > NEW.assigned_at + interval '90 minutes'
      ) THEN
      RAISE EXCEPTION 'invalid authenticated Paystack alias timestamps';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bound_authenticated_paystack_alias_timestamps()
  FROM PUBLIC;

-- Versioning an active alias must expire the source row before its historical
-- version is promoted to provider = 'paystack'. Otherwise the UPDATE trigger
-- sees two active rows for the same order/account and rejects the refresh.
CREATE OR REPLACE FUNCTION public.version_active_paystack_alias_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version_id uuid;
BEGIN
  IF OLD.provider <> 'paystack'
    OR NEW.payable_amount IS NOT DISTINCT FROM OLD.payable_amount
    OR COALESCE(
      OLD.expires_at,
      OLD.assigned_at + interval '90 minutes',
      OLD.created_at + interval '90 minutes'
    ) <= now() THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'paystack_order_account:' || trim(OLD.account_number), 0
    )
  );

  UPDATE public.order_payment_accounts AS source
  SET expires_at = LEAST(COALESCE(source.expires_at, now()), now())
  WHERE source.id = OLD.id
    AND source.provider = 'paystack';

  INSERT INTO public.order_payment_accounts (
    order_id, account_number, bank_name, account_name, provider,
    payable_amount, assigned_at, expires_at, assignment_customer_email,
    assignment_customer_email_source
  ) VALUES (
    OLD.order_id, OLD.account_number, OLD.bank_name, OLD.account_name,
    'paystack_version', NEW.payable_amount, now(), OLD.expires_at,
    OLD.assignment_customer_email, OLD.assignment_customer_email_source
  ) RETURNING id INTO v_version_id;

  UPDATE public.order_payment_accounts
  SET provider = 'paystack'
  WHERE id = v_version_id;

  NEW.payable_amount := OLD.payable_amount;
  NEW.assignment_customer_email := OLD.assignment_customer_email;
  NEW.expires_at := LEAST(COALESCE(NEW.expires_at, now()), now());
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.version_active_paystack_alias_snapshot()
  FROM PUBLIC;
