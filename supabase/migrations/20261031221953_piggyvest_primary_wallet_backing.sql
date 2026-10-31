-- PiggyVest wallet backing state (Ledger decision, 30 Oct 2026): each
-- customer wallet holds one kind of money. 'legacy' is Ogabassey-held Paystack
-- money, 'backed' is PiggyVest-settled money, and 'migrating' locks the wallet
-- while its audited legacy balance moves across. The only transitions are
-- legacy -> migrating -> backed, plus legacy -> backed for an audited zero.
-- Nothing returns to legacy.
--
-- This file adds the state store, its event log, the read helpers and the
-- pre-declared hooks. The transitions are in
-- 20261031221954_piggyvest_primary_wallet_backing_transitions.sql.
--
-- Ships dark: the tables start empty (no row means legacy), no login is a
-- member of the new role, and no existing write path calls these functions
-- yet. Later changes wire assert_wallet_legacy into the legacy writers.
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'piggyvest_primary_ledger_ops') THEN
    CREATE ROLE piggyvest_primary_ledger_ops NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;
GRANT USAGE ON SCHEMA piggyvest_primary TO piggyvest_primary_ledger_ops;

-- One row per customer once anything is recorded for it; no row is legacy.
-- customer_id detaches on account deletion (money evidence is kept, as for
-- onboarding_intents); deleting an onboarded customer already needs the
-- provider account closed first.
CREATE TABLE piggyvest_primary.wallet_backing (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid UNIQUE REFERENCES public.customers(id) ON DELETE SET NULL,
  state text NOT NULL CHECK (state IN ('legacy', 'migrating', 'backed')),
  onboarding_intent_id uuid REFERENCES piggyvest_primary.onboarding_intents(id),
  audited_amount numeric(12,2) CHECK (audited_amount >= 0),
  backed_via text CHECK (backed_via IN ('audited_zero', 'confirmed_move')),
  move_reference text CHECK (move_reference ~ '^[A-Za-z0-9][A-Za-z0-9:_.-]{0,199}$'),
  review_reason text CHECK (review_reason ~ '^[a-z][a-z0-9_]{2,63}$'),
  review_flagged_at timestamptz,
  migrating_at timestamptz,
  backed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK ((review_reason IS NULL) = (review_flagged_at IS NULL)),
  CHECK (
    (state = 'legacy' AND audited_amount IS NULL AND backed_via IS NULL
      AND move_reference IS NULL AND migrating_at IS NULL AND backed_at IS NULL)
    OR (state = 'migrating' AND onboarding_intent_id IS NOT NULL AND audited_amount IS NOT NULL
      AND migrating_at IS NOT NULL AND backed_via IS NULL AND move_reference IS NULL AND backed_at IS NULL)
    OR (state = 'backed' AND onboarding_intent_id IS NOT NULL AND audited_amount IS NOT NULL
      AND backed_at IS NOT NULL AND (
        (backed_via = 'audited_zero' AND audited_amount = 0 AND migrating_at IS NULL AND move_reference IS NULL)
        OR (backed_via = 'confirmed_move' AND migrating_at IS NOT NULL AND move_reference IS NOT NULL))))
);
CREATE INDEX piggyvest_primary_wallet_backing_merchant_idx ON piggyvest_primary.wallet_backing(merchant_id);
CREATE INDEX piggyvest_primary_wallet_backing_intent_idx ON piggyvest_primary.wallet_backing(onboarding_intent_id);
ALTER TABLE piggyvest_primary.wallet_backing ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_backing_deny ON piggyvest_primary.wallet_backing
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.wallet_backing
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_provisioner, piggyvest_primary_ledger_ops;

-- Append-only audit of every transition and review flag. session_login is
-- the login that called the transition (SESSION_USER survives SECURITY
-- DEFINER).
CREATE TABLE piggyvest_primary.wallet_backing_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  backing_id uuid NOT NULL REFERENCES piggyvest_primary.wallet_backing(id),
  event text NOT NULL CHECK (event IN ('migration_begun', 'backed_audited_zero', 'backed_confirmed_move', 'review_flagged')),
  from_state text NOT NULL CHECK (from_state IN ('legacy', 'migrating', 'backed')),
  to_state text NOT NULL CHECK (to_state IN ('legacy', 'migrating', 'backed')),
  amount numeric(12,2) CHECK (amount >= 0),
  reason text CHECK (reason ~ '^[a-z][a-z0-9_]{2,63}$'),
  move_reference text,
  session_login name NOT NULL DEFAULT SESSION_USER,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE INDEX piggyvest_primary_wallet_backing_events_backing_idx
  ON piggyvest_primary.wallet_backing_events(backing_id);
ALTER TABLE piggyvest_primary.wallet_backing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_backing_events_deny ON piggyvest_primary.wallet_backing_events
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.wallet_backing_events
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_provisioner, piggyvest_primary_ledger_ops;

-- Transition guard. Even the table owner cannot move a row backwards, skip
-- migrating for a confirmed move, rewrite migration facts, clear a review flag
-- or delete a row. The only identity change allowed is the customer link
-- detaching to NULL on account deletion.
CREATE FUNCTION piggyvest_primary.guard_wallet_backing()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'wallet_backing_rows_are_permanent' USING ERRCODE = '55000';
  END IF;
  IF NEW.customer_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.customer_id IS NULL) AND NOT EXISTS (
    SELECT 1 FROM public.customers c WHERE c.id = NEW.customer_id AND c.merchant_id = NEW.merchant_id
  ) THEN
    RAISE EXCEPTION 'wallet_backing_scope_mismatch' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state = 'backed' AND NEW.backed_via IS DISTINCT FROM 'audited_zero' THEN
      RAISE EXCEPTION 'wallet_backing_transition_refused' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT (NEW.state = OLD.state
      OR (OLD.state = 'legacy' AND NEW.state = 'migrating')
      OR (OLD.state = 'legacy' AND NEW.state = 'backed' AND NEW.backed_via = 'audited_zero')
      OR (OLD.state = 'migrating' AND NEW.state = 'backed' AND NEW.backed_via = 'confirmed_move')) THEN
    RAISE EXCEPTION 'wallet_backing_transition_refused' USING ERRCODE = '23514';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (NEW.customer_id IS DISTINCT FROM OLD.customer_id AND NEW.customer_id IS NOT NULL)
    OR (OLD.onboarding_intent_id IS NOT NULL AND NEW.onboarding_intent_id IS DISTINCT FROM OLD.onboarding_intent_id)
    OR (OLD.audited_amount IS NOT NULL AND NEW.audited_amount IS DISTINCT FROM OLD.audited_amount)
    OR (OLD.migrating_at IS NOT NULL AND NEW.migrating_at IS DISTINCT FROM OLD.migrating_at)
    OR (OLD.backed_at IS NOT NULL AND (NEW.backed_at, NEW.backed_via, NEW.move_reference)
      IS DISTINCT FROM (OLD.backed_at, OLD.backed_via, OLD.move_reference))
    OR (OLD.review_reason IS NOT NULL AND NEW.review_reason IS NULL) THEN
    RAISE EXCEPTION 'wallet_backing_facts_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wallet_backing_guard
  BEFORE INSERT OR UPDATE OR DELETE ON piggyvest_primary.wallet_backing
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.guard_wallet_backing();
CREATE TRIGGER wallet_backing_truncate_guard
  BEFORE TRUNCATE ON piggyvest_primary.wallet_backing
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_primary.guard_wallet_backing();

CREATE FUNCTION piggyvest_primary.guard_wallet_backing_events()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'wallet_backing_events_are_append_only' USING ERRCODE = '55000';
END $$;
CREATE TRIGGER wallet_backing_events_append_only
  BEFORE UPDATE OR DELETE ON piggyvest_primary.wallet_backing_events
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.guard_wallet_backing_events();
CREATE TRIGGER wallet_backing_events_truncate_guard
  BEFORE TRUNCATE ON piggyvest_primary.wallet_backing_events
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_primary.guard_wallet_backing_events();
REVOKE ALL ON FUNCTION piggyvest_primary.guard_wallet_backing() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_primary.guard_wallet_backing_events() FROM PUBLIC, anon, authenticated, service_role;

-- At most one legacy-out (-X) and one PiggyVest-in (+X) relabel row per
-- backing row, whatever writes them. The index is empty until a wallet flips.
CREATE UNIQUE INDEX customer_wallet_transactions_legacy_migration_once
  ON public.customer_wallet_transactions (source_id, (amount > 0))
  WHERE source_type = 'piggyvest_legacy_migration';

-- Internal read: 'legacy' when nothing is recorded. A row recorded under a
-- different merchant fails closed instead of reading as legacy.
CREATE FUNCTION piggyvest_primary.backing_state(p_customer_id uuid, p_merchant_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_state text;
  v_merchant uuid;
BEGIN
  IF p_customer_id IS NULL OR p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'wallet_backing_scope_required' USING ERRCODE = '22023';
  END IF;
  SELECT b.state, b.merchant_id INTO v_state, v_merchant
  FROM piggyvest_primary.wallet_backing b WHERE b.customer_id = p_customer_id;
  IF NOT FOUND THEN RETURN 'legacy'; END IF;
  IF v_merchant <> p_merchant_id THEN
    RAISE EXCEPTION 'wallet_backing_scope_unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN v_state;
END $$;

CREATE FUNCTION piggyvest_primary.is_backed(p_customer_id uuid, p_merchant_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN piggyvest_primary.backing_state(p_customer_id, p_merchant_id) = 'backed';
END $$;

-- Fence for the legacy wallet writers: call it before locking the wallet row.
-- It shares the per-customer lock that begin_migration and flip_to_backed take
-- exclusively, so a legacy write either commits before a migration audits the
-- balance or sees the wallet already fenced. The message is the contract.
CREATE FUNCTION piggyvest_primary.assert_wallet_legacy(p_customer_id uuid, p_merchant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_state text;
BEGIN
  IF p_customer_id IS NULL OR p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'wallet_backing_scope_required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('piggyvest-wallet-backing:' || p_customer_id::text, 0));
  v_state := piggyvest_primary.backing_state(p_customer_id, p_merchant_id);
  IF v_state <> 'legacy' THEN
    RAISE EXCEPTION 'piggyvest_wallet_fenced' USING ERRCODE = 'P0001', DETAIL = 'wallet is ' || v_state;
  END IF;
END $$;

-- Pre-declared hooks. Later changes replace each body (same signature):
-- deferred inflow credits and pending-credit obligations after a flip, and the
-- legacy move begun from onboarding verification.
CREATE FUNCTION piggyvest_primary.on_backed_flip_credit_deferred(p_backing_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN 'noop';
END $$;

CREATE FUNCTION piggyvest_primary.on_backed_flip_convert_obligations(p_backing_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN 'noop';
END $$;

CREATE FUNCTION piggyvest_primary.on_onboarding_verified(p_intent_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN 'noop';
END $$;

-- False until the onboarding hook really begins legacy moves.
CREATE FUNCTION piggyvest_primary.onboarding_verified_hook_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT false
$$;

-- Customer-scoped read for web and app routes, called with the request's own
-- session. 'none' when the caller has no customer record at this merchant.
CREATE FUNCTION public.get_my_wallet_backing_state(p_merchant_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_customer uuid;
  v_state text;
BEGIN
  IF v_user IS NULL OR p_merchant_id IS NULL THEN RETURN 'none'; END IF;
  SELECT c.id INTO v_customer FROM public.customers c
  WHERE c.merchant_id = p_merchant_id AND c.user_id = v_user;
  IF NOT FOUND THEN RETURN 'none'; END IF;
  SELECT b.state INTO v_state FROM piggyvest_primary.wallet_backing b
  WHERE b.customer_id = v_customer AND b.merchant_id = p_merchant_id;
  RETURN COALESCE(v_state, 'legacy');
END $$;

REVOKE ALL ON FUNCTION piggyvest_primary.backing_state(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_primary.is_backed(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_primary.assert_wallet_legacy(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_primary.on_backed_flip_credit_deferred(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_primary.on_backed_flip_convert_obligations(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_primary.on_onboarding_verified(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_primary.onboarding_verified_hook_ready() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_wallet_backing_state(uuid) FROM PUBLIC, anon, authenticated, service_role;
-- is_backed is for the engine, spend and provisioner roles; the engine and
-- spend roles grant it to themselves when they are created.
GRANT EXECUTE ON FUNCTION piggyvest_primary.is_backed(uuid, uuid) TO piggyvest_primary_provisioner;
GRANT EXECUTE ON FUNCTION public.get_my_wallet_backing_state(uuid) TO authenticated;

COMMIT;
