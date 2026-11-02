-- piggyvest-engine-owner: P5-engine-schema
-- PiggyVest transfer engine, part 1 of 6: roles, the house-wallet registry,
-- the transfer-kind matrix, authorities, limits and bank destinations.
--
-- The engine is declared up front so no later change has to alter its
-- tables: parts 2-6 add wallet_transfers, its attempts and holds, the B
-- writer (B = the spendable customer_wallets balance) and the no-op hooks
-- that later owners fill in. Everything ships dark: every table starts
-- empty, house wallets and bank destinations are registered only by the
-- owner's runbook SQL, and no login holds an engine role yet.
--
-- Access: every table has RLS with a restrictive deny-all policy and no
-- grant to PUBLIC, anon, authenticated, service_role or the engine roles.
-- The only door is SECURITY DEFINER functions with a pinned search_path;
-- here that is read_house_wallets, granted to the three engine roles.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'piggyvest_primary_transfer_enqueuer') THEN
    CREATE ROLE piggyvest_primary_transfer_enqueuer NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'piggyvest_primary_transfer_worker') THEN
    CREATE ROLE piggyvest_primary_transfer_worker NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'piggyvest_primary_transfer_ops') THEN
    CREATE ROLE piggyvest_primary_transfer_ops NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

-- Ogabassey's own wallets under the integration's PiggyVest business. They
-- hold Ogabassey money and are never a customer wallet.
CREATE TABLE piggyvest_primary.house_wallets (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  role text NOT NULL CHECK (role IN ('collection', 'interest', 'fee')),
  provider_wallet_id text NOT NULL UNIQUE CHECK (octet_length(provider_wallet_id) BETWEEN 1 AND 512),
  business_id text NOT NULL CHECK (octet_length(business_id) BETWEEN 1 AND 512),
  -- The wallet's currency as the owner confirmed it in the PiggyVest
  -- dashboard. The provider transfer reader binds NGN from the registered
  -- wallets when a transfer record names no currency.
  currency text NOT NULL CHECK (currency = 'NGN'),
  enabled boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (integration_id, role),
  CHECK (NOT enabled OR verified_at IS NOT NULL)
);

-- Bank accounts the engine may pay: Ogabassey's treasury account, or a
-- customer's own account for a support-only payout.
CREATE TABLE piggyvest_primary.bank_destinations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  purpose text NOT NULL CHECK (purpose IN ('treasury', 'support_payout')),
  -- Account deletion detaches a customer's account (money evidence is kept).
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  bank_code text NOT NULL CHECK (bank_code ~ '^[0-9]{3,6}$'),
  account_number text NOT NULL CHECK (account_number ~ '^[0-9]{10}$'),
  account_name text NOT NULL CHECK (octet_length(account_name) BETWEEN 1 AND 200),
  enabled boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (purpose <> 'treasury' OR customer_id IS NULL),
  CHECK (NOT enabled OR verified_at IS NOT NULL)
);
-- One row per account and owner; detached accounts of deleted customers are
-- kept as evidence and never collide.
CREATE UNIQUE INDEX piggyvest_primary_bank_destinations_account_idx
  ON piggyvest_primary.bank_destinations(integration_id, purpose, customer_id, bank_code, account_number)
  NULLS NOT DISTINCT WHERE purpose = 'treasury' OR customer_id IS NOT NULL;
CREATE INDEX piggyvest_primary_bank_destinations_integration_idx ON piggyvest_primary.bank_destinations(integration_id);
CREATE INDEX piggyvest_primary_bank_destinations_customer_idx ON piggyvest_primary.bank_destinations(customer_id);

-- Before verification a row may be corrected or removed; once verified only
-- the operational enabled switch may change. Switching a wallet off always
-- succeeds (it is the kill switch); registering or switching one on re-runs
-- the registration checks.
CREATE FUNCTION piggyvest_primary.house_wallets_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_business text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.verified_at IS NOT NULL THEN
    IF TG_OP = 'DELETE' OR (pg_catalog.to_jsonb(NEW) - 'enabled') <> (pg_catalog.to_jsonb(OLD) - 'enabled') THEN
      RAISE EXCEPTION 'a verified house wallet is immutable' USING ERRCODE = '42501';
    END IF;
    IF NOT NEW.enabled THEN RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT integration.business_id INTO v_business FROM piggyvest_primary.integrations integration
    WHERE integration.id = NEW.integration_id;
  IF v_business IS DISTINCT FROM NEW.business_id THEN
    RAISE EXCEPTION 'house wallet business must be the integration business' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM piggyvest_primary.onboarding_intents WHERE provider_wallet_id = NEW.provider_wallet_id)
    OR EXISTS (SELECT 1 FROM piggyvest_primary.goal_wallet_intents WHERE provider_wallet_id = NEW.provider_wallet_id)
    OR EXISTS (SELECT 1 FROM piggyvest_primary.savings_destinations WHERE provider_wallet_id = NEW.provider_wallet_id)
  THEN
    RAISE EXCEPTION 'a customer wallet cannot be registered as a house wallet' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER house_wallets_guard BEFORE INSERT OR UPDATE OR DELETE ON piggyvest_primary.house_wallets
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.house_wallets_guard();

-- The same rule for bank destinations, except that deleting the customer
-- detaches (and disables) their support payout account.
CREATE FUNCTION piggyvest_primary.bank_destinations_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.verified_at IS NOT NULL THEN
    IF TG_OP = 'DELETE' OR (pg_catalog.to_jsonb(NEW) - ARRAY['enabled', 'customer_id'])
        <> (pg_catalog.to_jsonb(OLD) - ARRAY['enabled', 'customer_id'])
      OR (NEW.customer_id IS DISTINCT FROM OLD.customer_id AND NEW.customer_id IS NOT NULL) THEN
      RAISE EXCEPTION 'a verified bank destination is immutable' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND NEW.customer_id IS NULL AND OLD.customer_id IS NOT NULL THEN
    NEW.enabled := false;
    RETURN NEW;
  END IF;
  IF NEW.purpose = 'support_payout' AND NOT EXISTS (SELECT 1 FROM piggyvest_primary.integrations integration
    JOIN public.customers customer ON customer.merchant_id = integration.merchant_id
    WHERE integration.id = NEW.integration_id AND customer.id = NEW.customer_id) THEN
    RAISE EXCEPTION 'a support payout account belongs to a customer of this integration' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_destinations_guard BEFORE INSERT OR UPDATE OR DELETE ON piggyvest_primary.bank_destinations
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.bank_destinations_guard();

-- The transfer-kind matrix. Roles: main and goal are customer wallets,
-- collection/interest/fee are house wallets, bank is a bank_destinations row.
-- b_on_open, b_on_confirm and b_on_bound_failure name the B effect at each
-- point; b_effects lists every effect request_b_effect accepts for the kind.
CREATE TABLE piggyvest_primary.transfer_kinds (
  kind text PRIMARY KEY CHECK (kind ~ '^[a-z_]{1,40}$'),
  source_role text NOT NULL CHECK (source_role IN ('main', 'goal', 'collection', 'interest', 'fee')),
  destination_role text NOT NULL CHECK (destination_role IN ('main', 'goal', 'collection', 'interest', 'fee', 'bank')),
  purposes text[] NOT NULL CHECK (cardinality(purposes) >= 1),
  delivery_modes text[] NOT NULL CHECK (cardinality(delivery_modes) >= 1),
  requires_exit_claim boolean NOT NULL,
  holdable boolean NOT NULL,
  approval_only boolean NOT NULL,
  b_on_open text NOT NULL CHECK (b_on_open IN ('none', 'hold_debit', 'payout_freeze_debit')),
  b_on_confirm text NOT NULL CHECK (b_on_confirm IN ('none', 'confirm_credit')),
  b_on_bound_failure text NOT NULL CHECK (b_on_bound_failure IN ('none', 'unpaid_restore', 'payout_failed_restore')),
  b_effects text[] NOT NULL,
  r1_class text NOT NULL CHECK (r1_class IN ('collect', 'disbursement', 'legacy_migration', 'interest_sweep', 'none')),
  hook_owner text NOT NULL CHECK (octet_length(hook_owner) BETWEEN 1 AND 200),
  UNIQUE (kind, source_role, destination_role),
  CHECK (source_role <> destination_role)
);
INSERT INTO piggyvest_primary.transfer_kinds VALUES
  ('collect', 'main', 'collection', ARRAY['vtu', 'imei', 'checkout'],
    ARRAY['deliver_before_collect', 'deliver_after_confirm'], false, true, false,
    'hold_debit', 'none', 'unpaid_restore', ARRAY['hold_debit', 'release_credit', 'unpaid_restore'], 'collect',
    'checkout: P6-checkout-collect-outcome; vtu, imei: none'),
  ('disbursement', 'collection', 'main', ARRAY['refund', 'obligation'], ARRAY['credit_main'], false, false, false,
    'none', 'confirm_credit', 'none', ARRAY['confirm_credit', 'refund_netted'], 'disbursement',
    'obligation: P5-obligation-disbursement; refund: P6-checkout-refund-records'),
  -- The audited legacy balance is already in B: settling only relabels it.
  ('legacy_migration', 'collection', 'main', ARRAY['legacy_balance'], ARRAY['credit_main'], false, false, false,
    'none', 'none', 'none', ARRAY[]::text[], 'legacy_migration', 'P5-transfer-settle; P5-transfer-fail-attempts'),
  ('legacy_goal_migration', 'collection', 'goal', ARRAY['legacy_goal_balance'], ARRAY['credit_goal'], false, false, false,
    'none', 'none', 'none', ARRAY[]::text[], 'none', 'P8-legacy-goal-move'),
  ('goal_purchase', 'goal', 'collection', ARRAY['checkout'], ARRAY['deliver_after_confirm'], true, true, false,
    'none', 'none', 'none', ARRAY[]::text[], 'none', 'settled: P7-goal-purchase-settle; failed: P7-goal-tender-hold'),
  ('goal_refund', 'goal', 'main', ARRAY['cancel'], ARRAY['credit_main'], true, false, false,
    'none', 'confirm_credit', 'none', ARRAY['confirm_credit'], 'disbursement', 'P7-goal-refund-settle'),
  ('goal_leftover', 'goal', 'main', ARRAY['leftover'], ARRAY['credit_main'], true, false, false,
    'none', 'confirm_credit', 'none', ARRAY['confirm_credit'], 'disbursement', 'P7-goal-purchase-settle'),
  ('goal_sweep', 'goal', 'main', ARRAY['retire_sweep'], ARRAY['credit_main'], true, false, false,
    'none', 'confirm_credit', 'none', ARRAY['confirm_credit'], 'disbursement', 'P7-goal-retire-sweep'),
  ('goal_forfeit', 'goal', 'interest', ARRAY['cancel_interest', 'post_exit_interest'], ARRAY['credit_house'],
    true, false, false, 'none', 'none', 'none', ARRAY[]::text[], 'none',
    'cancel_interest: P7-goal-refund-settle; post_exit_interest: P7-goal-post-exit-interest'),
  ('support_payout', 'main', 'bank', ARRAY['support_payout'], ARRAY['bank_payout'], false, false, false,
    'payout_freeze_debit', 'none', 'payout_failed_restore', ARRAY['payout_freeze_debit', 'payout_failed_restore'],
    'collect', 'P5-support-payout-command'),
  ('treasury_sweep', 'collection', 'bank', ARRAY['treasury'], ARRAY['bank_payout'], false, false, false,
    'none', 'none', 'none', ARRAY[]::text[], 'none', 'P5-treasury-approvals-sweep'),
  ('interest_sweep', 'main', 'interest', ARRAY['misrouted_interest'], ARRAY['credit_house'], false, false, true,
    'none', 'none', 'none', ARRAY[]::text[], 'interest_sweep', 'P5-misrouted-interest-resolve');

CREATE FUNCTION piggyvest_primary.transfer_kinds_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'the transfer-kind matrix is fixed by its migration' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER transfer_kinds_guard BEFORE INSERT OR UPDATE OR DELETE ON piggyvest_primary.transfer_kinds
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.transfer_kinds_guard();
CREATE TRIGGER transfer_kinds_truncate_guard BEFORE TRUNCATE ON piggyvest_primary.transfer_kinds
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_primary.transfer_kinds_guard();

-- Dedicated database logins per integration and capability. The logins
-- themselves are created by the owner's runbook, never by a migration.
CREATE TABLE piggyvest_primary.transfer_authorities (
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  capability text NOT NULL CHECK (capability IN ('enqueue', 'worker', 'ops')),
  executor_login name NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  PRIMARY KEY (integration_id, capability)
);

-- Per-customer limits per kind. No row means the kind is not allowed.
CREATE TABLE piggyvest_primary.transfer_limits (
  integration_id uuid NOT NULL REFERENCES piggyvest_primary.integrations(id),
  kind text NOT NULL REFERENCES piggyvest_primary.transfer_kinds(kind),
  max_single_kobo bigint NOT NULL CHECK (max_single_kobo BETWEEN 1 AND 9999999999),
  max_open_count integer NOT NULL CHECK (max_open_count BETWEEN 1 AND 1000),
  max_open_kobo bigint NOT NULL CHECK (max_open_kobo BETWEEN 1 AND 9999999999),
  daily_kobo bigint NOT NULL CHECK (daily_kobo BETWEEN 1 AND 9999999999),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (integration_id, kind),
  CHECK (max_single_kobo <= max_open_kobo)
);
CREATE INDEX piggyvest_primary_transfer_limits_kind_idx ON piggyvest_primary.transfer_limits(kind);

ALTER TABLE piggyvest_primary.house_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary.bank_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary.transfer_kinds ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary.transfer_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE piggyvest_primary.transfer_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_house_wallets_deny ON piggyvest_primary.house_wallets
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY primary_bank_destinations_deny ON piggyvest_primary.bank_destinations
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY primary_transfer_kinds_deny ON piggyvest_primary.transfer_kinds
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY primary_transfer_authorities_deny ON piggyvest_primary.transfer_authorities
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
CREATE POLICY primary_transfer_limits_deny ON piggyvest_primary.transfer_limits
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.house_wallets, piggyvest_primary.bank_destinations, piggyvest_primary.transfer_kinds,
  piggyvest_primary.transfer_authorities, piggyvest_primary.transfer_limits
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_transfer_enqueuer,
    piggyvest_primary_transfer_worker, piggyvest_primary_transfer_ops;

-- The one read helper: every registered house wallet of an integration with
-- its readiness. Callers treat anything but enabled and verified as absent.
CREATE FUNCTION piggyvest_primary.read_house_wallets(p_integration_id uuid)
RETURNS TABLE (role text, provider_wallet_id text, business_id text, currency text, enabled boolean, verified boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT wallet.role, wallet.provider_wallet_id, wallet.business_id, wallet.currency, wallet.enabled,
    wallet.verified_at IS NOT NULL
  FROM piggyvest_primary.house_wallets wallet
  WHERE wallet.integration_id = p_integration_id
  ORDER BY wallet.role
$$;

REVOKE ALL ON FUNCTION piggyvest_primary.house_wallets_guard(), piggyvest_primary.bank_destinations_guard(),
  piggyvest_primary.transfer_kinds_guard(),
  piggyvest_primary.read_house_wallets(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA piggyvest_primary TO piggyvest_primary_transfer_enqueuer, piggyvest_primary_transfer_worker,
  piggyvest_primary_transfer_ops;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_house_wallets(uuid) TO piggyvest_primary_transfer_enqueuer,
  piggyvest_primary_transfer_worker, piggyvest_primary_transfer_ops;
COMMIT;
