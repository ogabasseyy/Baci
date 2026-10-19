-- Isolated staging-only Paystack test top-ups. The singleton allowlist is
-- provisioned separately by the database owner after synthetic-row review.
DO $preflight$
DECLARE
  v_system_identifier text;
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'wallet test payments refuses non-target database';
  END IF;
  SELECT system_identifier::text INTO v_system_identifier FROM pg_catalog.pg_control_system();
  IF v_system_identifier IS DISTINCT FROM '7685292944002592802' OR
    pg_catalog.date_part('epoch', pg_catalog.clock_timestamp())::bigint >= 1790697550 THEN
    RAISE EXCEPTION 'wallet test payments cluster or fixed lease rejected';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'staging_wallet_payments') THEN
    RAISE EXCEPTION 'pre-existing wallet test payments schema requires explicit owner review';
  END IF;
END;
$preflight$;

DO $role$
DECLARE
  v_role_oid oid;
BEGIN
  SELECT oid INTO v_role_oid FROM pg_catalog.pg_roles WHERE rolname = 'baci_staging_test_payments';
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid = v_role_oid AND
      (NOT r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreaterole OR
        r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)) THEN
      RAISE EXCEPTION 'pre-existing staging wallet role has unsafe attributes';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.roleid = v_role_oid OR m.member = v_role_oid) OR
      EXISTS (SELECT 1 FROM pg_catalog.pg_shdepend d WHERE d.refclassid = 'pg_catalog.pg_authid'::regclass
        AND d.refobjid = v_role_oid AND d.deptype = 'o') THEN
      RAISE EXCEPTION 'pre-existing staging wallet role has memberships or owned objects';
    END IF;
    RAISE EXCEPTION 'pre-existing staging wallet role requires explicit owner review';
  END IF;
  CREATE ROLE baci_staging_test_payments LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
END;
$role$;

CREATE SCHEMA staging_wallet_payments;
REVOKE ALL ON SCHEMA staging_wallet_payments FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA staging_wallet_payments TO baci_staging_test_payments;

CREATE TABLE staging_wallet_payments.config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id), configured_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT staging_wallet_config_customer_unique UNIQUE (customer_id),
  CONSTRAINT staging_wallet_config_pair_unique UNIQUE (merchant_id, customer_id)
);
ALTER TABLE staging_wallet_payments.config ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging_wallet_payments.config FORCE ROW LEVEL SECURITY;
REVOKE ALL ON staging_wallet_payments.config FROM PUBLIC, anon, authenticated, service_role, baci_staging_test_payments;

CREATE TABLE staging_wallet_payments.pending_topups (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(), merchant_id uuid NOT NULL, customer_id uuid NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo BETWEEN 10000 AND 50000000), reference text NOT NULL CHECK (reference ~ '^[A-Za-z0-9_-]{8,100}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'settled')), created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  settled_at timestamptz, wallet_transaction_id uuid, wallet_balance_naira numeric(12,2),
  CONSTRAINT pending_topups_config_fk FOREIGN KEY (merchant_id, customer_id)
    REFERENCES staging_wallet_payments.config (merchant_id, customer_id) ON DELETE RESTRICT,
  CONSTRAINT pending_topups_merchant_reference_unique UNIQUE (merchant_id, reference),
  CONSTRAINT pending_topups_settlement_shape CHECK (
    (status = 'pending' AND settled_at IS NULL AND wallet_transaction_id IS NULL AND wallet_balance_naira IS NULL)
    OR (status = 'settled' AND settled_at IS NOT NULL AND wallet_transaction_id IS NOT NULL AND wallet_balance_naira IS NOT NULL)
  )
);
ALTER TABLE staging_wallet_payments.pending_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging_wallet_payments.pending_topups FORCE ROW LEVEL SECURITY;
REVOKE ALL ON staging_wallet_payments.pending_topups FROM PUBLIC, anon, authenticated, service_role, baci_staging_test_payments;
CREATE INDEX pending_topups_customer_merchant_fk_idx
  ON staging_wallet_payments.pending_topups (customer_id, merchant_id);

CREATE OR REPLACE FUNCTION staging_wallet_payments._guard() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_system_identifier text;
BEGIN
  IF session_user <> 'baci_staging_test_payments' OR current_user <> 'postgres'
    OR current_database() <> 'postgres'
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = session_user
        AND r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper AND NOT r.rolcreaterole
        AND NOT r.rolcreatedb AND NOT r.rolreplication AND NOT r.rolbypassrls
    ) THEN
    RAISE EXCEPTION 'staging wallet payment caller/database rejected' USING ERRCODE = '42501';
  END IF;
  SELECT system_identifier::text INTO v_system_identifier FROM pg_catalog.pg_control_system();
  IF v_system_identifier IS DISTINCT FROM '7685292944002592802'
    OR pg_catalog.date_part('epoch', pg_catalog.clock_timestamp())::bigint >= 1790697550 THEN
    RAISE EXCEPTION 'staging wallet payment cluster lease rejected' USING ERRCODE = '55000';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION staging_wallet_payments.assert_identity() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  PERFORM staging_wallet_payments._guard();
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION staging_wallet_payments.assert_configuration(p_merchant uuid, p_customer_ids uuid[])
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_config_count bigint;
  v_match_count bigint;
BEGIN
  PERFORM staging_wallet_payments._guard();
  IF p_merchant IS NULL OR p_customer_ids IS NULL
    OR pg_catalog.array_ndims(p_customer_ids) <> 1
    OR pg_catalog.cardinality(p_customer_ids) <> 1
    OR p_customer_ids[1] IS NULL THEN
    RAISE EXCEPTION 'staging wallet configuration arguments rejected' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_config_count FROM staging_wallet_payments.config;
  IF v_config_count <> 1 THEN
    RAISE EXCEPTION 'staging wallet configuration must contain exactly one row' USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_match_count
  FROM staging_wallet_payments.config cfg
  JOIN public.customers c ON c.id = cfg.customer_id
  WHERE cfg.singleton
    AND cfg.merchant_id = p_merchant
    AND cfg.customer_id = p_customer_ids[1]
    AND c.merchant_id = p_merchant
    AND c.user_id IS NOT NULL
    AND c.deleted_at IS NULL;
  IF v_match_count <> 1 THEN
    RAISE EXCEPTION 'staging wallet configuration does not match allowlisted customer' USING ERRCODE = '42501';
  END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION staging_wallet_payments._customer(p_auth_user uuid, p_merchant uuid)
RETURNS TABLE(customer_id uuid, customer_email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  PERFORM staging_wallet_payments._guard();
  RETURN QUERY
  SELECT c.id, pg_catalog.lower(pg_catalog.btrim(c.email))
  FROM staging_wallet_payments.config cfg
  JOIN public.customers c ON c.id = cfg.customer_id
  WHERE cfg.singleton
    AND cfg.merchant_id = p_merchant
    AND c.merchant_id = cfg.merchant_id
    AND c.user_id = p_auth_user
    AND c.deleted_at IS NULL
    AND c.email IS NOT NULL
    AND pg_catalog.strpos(c.email, '@') > 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staging wallet customer is not allowlisted' USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION staging_wallet_payments.begin_top_up(p_auth_user uuid, p_merchant uuid, p_amount_kobo bigint, p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_customer uuid;
  v_email text;
  v_entry staging_wallet_payments.pending_topups%ROWTYPE;
BEGIN
  PERFORM staging_wallet_payments._guard();
  IF p_amount_kobo IS NULL OR p_amount_kobo NOT BETWEEN 10000 AND 50000000
    OR p_reference IS NULL OR p_reference !~ '^[A-Za-z0-9_-]{8,100}$' THEN
    RAISE EXCEPTION 'invalid staging wallet top-up request' USING ERRCODE = '22023';
  END IF;
  SELECT customer_id, customer_email INTO STRICT v_customer, v_email
  FROM staging_wallet_payments._customer(p_auth_user, p_merchant);
  INSERT INTO staging_wallet_payments.pending_topups (merchant_id, customer_id, amount_kobo, reference)
  VALUES (p_merchant, v_customer, p_amount_kobo, p_reference)
  ON CONFLICT (merchant_id, reference) DO NOTHING;
  SELECT * INTO STRICT v_entry FROM staging_wallet_payments.pending_topups
  WHERE merchant_id = p_merchant AND reference = p_reference FOR UPDATE;
  IF v_entry.customer_id <> v_customer OR v_entry.amount_kobo <> p_amount_kobo THEN
    RAISE EXCEPTION 'staging wallet reference already bound to different request' USING ERRCODE = '23505';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'id', v_entry.id, 'customer_id', v_customer, 'email', v_email,
    'amount_kobo', v_entry.amount_kobo, 'reference', v_entry.reference
  );
END;
$function$;

CREATE OR REPLACE FUNCTION staging_wallet_payments.read_top_up(p_auth_user uuid, p_merchant uuid, p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_customer uuid;
  v_email text;
  v_entry staging_wallet_payments.pending_topups%ROWTYPE;
BEGIN
  PERFORM staging_wallet_payments._guard();
  IF p_reference IS NULL OR p_reference !~ '^[A-Za-z0-9_-]{8,100}$' THEN
    RAISE EXCEPTION 'invalid staging wallet reference' USING ERRCODE = '22023';
  END IF;
  SELECT customer_id, customer_email INTO STRICT v_customer, v_email
  FROM staging_wallet_payments._customer(p_auth_user, p_merchant);
  SELECT * INTO v_entry FROM staging_wallet_payments.pending_topups
  WHERE merchant_id = p_merchant AND customer_id = v_customer AND reference = p_reference;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('found', false);
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'found', true, 'id', v_entry.id, 'customer_id', v_customer, 'email', v_email,
    'amount_kobo', v_entry.amount_kobo, 'reference', v_entry.reference, 'status', v_entry.status
  );
END;
$function$;

CREATE OR REPLACE FUNCTION staging_wallet_payments.settle_top_up(p_auth_user uuid, p_merchant uuid, p_reference text,
  p_verified_amount_kobo bigint, p_verified_currency text, p_verified_domain text, p_verified_reference text, p_verified_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_customer uuid;
  v_email text;
  v_entry staging_wallet_payments.pending_topups%ROWTYPE;
  v_success boolean;
  v_balance numeric;
  v_transaction uuid;
BEGIN
  PERFORM staging_wallet_payments._guard();
  IF p_reference IS NULL OR p_reference !~ '^[A-Za-z0-9_-]{8,100}$'
    OR p_verified_amount_kobo IS NULL OR p_verified_currency IS DISTINCT FROM 'NGN'
    OR p_verified_domain IS DISTINCT FROM 'test'
    OR p_verified_reference IS DISTINCT FROM p_reference THEN
    RAISE EXCEPTION 'verified Paystack test payment does not match' USING ERRCODE = '22023';
  END IF;
  SELECT customer_id, customer_email INTO STRICT v_customer, v_email
  FROM staging_wallet_payments._customer(p_auth_user, p_merchant);
  IF pg_catalog.lower(pg_catalog.btrim(p_verified_email)) IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'verified Paystack test email does not match' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO STRICT v_entry FROM staging_wallet_payments.pending_topups
  WHERE merchant_id = p_merchant AND customer_id = v_customer AND reference = p_reference FOR UPDATE;
  IF v_entry.amount_kobo <> p_verified_amount_kobo THEN
    RAISE EXCEPTION 'verified Paystack test amount does not match' USING ERRCODE = '22023';
  END IF;
  IF v_entry.status = 'settled' THEN
    RETURN pg_catalog.jsonb_build_object(
      'balance', v_entry.wallet_balance_naira, 'first_credit', false
    );
  END IF;
  IF pg_catalog.to_regprocedure('public.credit_customer_wallet(uuid,uuid,numeric,text,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'canonical wallet credit function is unavailable' USING ERRCODE = '55000';
  END IF;
  SELECT success, new_balance, transaction_id INTO STRICT v_success, v_balance, v_transaction
  FROM public.credit_customer_wallet(v_customer, p_merchant, v_entry.amount_kobo::numeric / 100,
    'wallet_topup', v_entry.id, 'Staging Paystack test top-up');
  IF v_success IS DISTINCT FROM true OR v_transaction IS NULL THEN
    RAISE EXCEPTION 'canonical wallet credit did not complete' USING ERRCODE = '55000';
  END IF;
  UPDATE staging_wallet_payments.pending_topups SET status = 'settled',
    settled_at = pg_catalog.clock_timestamp(), wallet_transaction_id = v_transaction,
    wallet_balance_naira = v_balance
  WHERE id = v_entry.id;
  RETURN pg_catalog.jsonb_build_object(
    'balance', v_balance, 'first_credit', true
  );
END;
$function$;

ALTER FUNCTION staging_wallet_payments._guard() OWNER TO postgres;
ALTER FUNCTION staging_wallet_payments.assert_identity() OWNER TO postgres;
ALTER FUNCTION staging_wallet_payments.assert_configuration(uuid, uuid[]) OWNER TO postgres;
ALTER FUNCTION staging_wallet_payments._customer(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION staging_wallet_payments.begin_top_up(uuid, uuid, bigint, text) OWNER TO postgres;
ALTER FUNCTION staging_wallet_payments.read_top_up(uuid, uuid, text) OWNER TO postgres;
ALTER FUNCTION staging_wallet_payments.settle_top_up(uuid, uuid, text, bigint, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA staging_wallet_payments
  FROM PUBLIC, anon, authenticated, service_role, baci_staging_test_payments;
GRANT EXECUTE ON FUNCTION staging_wallet_payments.begin_top_up(uuid, uuid, bigint, text),
  staging_wallet_payments.read_top_up(uuid, uuid, text),
  staging_wallet_payments.settle_top_up(uuid, uuid, text, bigint, text, text, text, text),
  staging_wallet_payments.assert_identity(),
  staging_wallet_payments.assert_configuration(uuid, uuid[])
  TO baci_staging_test_payments;
REVOKE ALL ON FUNCTION staging_wallet_payments._guard(), staging_wallet_payments._customer(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, baci_staging_test_payments;
REVOKE ALL ON ALL TABLES IN SCHEMA staging_wallet_payments FROM PUBLIC, anon, authenticated, service_role, baci_staging_test_payments;
