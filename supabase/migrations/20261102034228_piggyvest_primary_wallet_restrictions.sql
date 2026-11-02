-- PiggyVest primary-wallet restrictions (Freeze and Lien): the tables.
--
-- restriction-created.success and restriction-lifted.success both carry the
-- restriction id (eventData.id, the same in both events per the public
-- webhook docs), its property (Freeze or Lien), the lien amount and the
-- wallet's available and ledger balances; only the lift carries a provider
-- time (eventData.lifted_at). Money rules R1/R2: while any restriction on a
-- wallet is active, that wallet must not spend or transfer.
--
-- * wallet_restrictions: one row per provider restriction on a provider
--   wallet id, keyed by (provider_wallet_id, provider_restriction_id), owned
--   by the integration whose evidence login recorded it. A row is active
--   while no lift is recorded, or while its placement time (when the
--   provider supplies one) is later than the latest recorded lift.
-- * wallet_restriction_events: every creation or lift event the writers
--   accepted, kept for good (creations absorbed as duplicates and stale or
--   superseded lifts included), so an event id names one event even after
--   the row stops naming it.
--
-- The writers and the spend-gate read are added by the next migration
-- (..._piggyvest_primary_wallet_restriction_functions.sql); nothing calls
-- them yet. Both tables are deny-all: RLS, a restrictive false policy, and no
-- table privilege for PUBLIC, the API roles (service_role included) or the
-- PiggyVest roles.
BEGIN;

CREATE TABLE piggyvest_primary.wallet_restrictions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  integration_id uuid NOT NULL
    CONSTRAINT wallet_restrictions_integration_fkey
    REFERENCES piggyvest_primary.integrations(id),
  provider_wallet_id text NOT NULL
    CONSTRAINT wallet_restrictions_provider_wallet_id_check
    CHECK (octet_length(provider_wallet_id) BETWEEN 1 AND 512),
  provider_restriction_id text NULL
    CONSTRAINT wallet_restrictions_provider_restriction_id_check
    CHECK (provider_restriction_id IS NULL OR octet_length(provider_restriction_id) BETWEEN 1 AND 512),
  -- The first creation event; NULL while only the lift has arrived.
  provider_event_id text NULL
    CONSTRAINT wallet_restrictions_provider_event_id_check
    CHECK (provider_event_id IS NULL OR octet_length(provider_event_id) BETWEEN 1 AND 512),
  kind text NOT NULL
    CONSTRAINT wallet_restrictions_kind_check
    CHECK (kind IN ('freeze', 'lien', 'unknown')),
  -- The provider's property text as sent (bounded), kept as evidence.
  provider_kind text NULL
    CONSTRAINT wallet_restrictions_provider_kind_check
    CHECK (provider_kind IS NULL OR char_length(provider_kind) <= 100),
  amount_kobo bigint NULL,
  available_balance_kobo bigint NULL,
  ledger_balance_kobo bigint NULL,
  -- Provider placement time, when the provider supplies one.
  occurred_at timestamptz NULL,
  -- The latest lift by provider time.
  lift_event_id text NULL
    CONSTRAINT wallet_restrictions_lift_event_id_check
    CHECK (lift_event_id IS NULL OR octet_length(lift_event_id) BETWEEN 1 AND 512),
  lifted_at timestamptz NULL,
  is_active boolean GENERATED ALWAYS AS (
    lifted_at IS NULL OR (occurred_at IS NOT NULL AND occurred_at > lifted_at)
  ) STORED,
  recorded_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT wallet_restrictions_lift_pair_check
    CHECK ((lift_event_id IS NULL) = (lifted_at IS NULL)),
  CONSTRAINT wallet_restrictions_event_check
    CHECK (provider_event_id IS NOT NULL OR lift_event_id IS NOT NULL),
  CONSTRAINT wallet_restrictions_liftable_check
    CHECK (lift_event_id IS NULL OR provider_restriction_id IS NOT NULL),
  CONSTRAINT wallet_restrictions_provider_event_id_key UNIQUE (provider_event_id),
  CONSTRAINT wallet_restrictions_lift_event_id_key UNIQUE (lift_event_id),
  CONSTRAINT wallet_restrictions_restriction_key
    UNIQUE (provider_wallet_id, provider_restriction_id)
);

-- The spend gate reads only the active restrictions of one wallet.
CREATE INDEX wallet_restrictions_active_wallet_idx
  ON piggyvest_primary.wallet_restrictions (provider_wallet_id)
  WHERE is_active;
CREATE INDEX wallet_restrictions_integration_idx
  ON piggyvest_primary.wallet_restrictions (integration_id);

CREATE TABLE piggyvest_primary.wallet_restriction_events (
  event_id text PRIMARY KEY
    CONSTRAINT wallet_restriction_events_event_id_check
    CHECK (octet_length(event_id) BETWEEN 1 AND 512),
  event_role text NOT NULL
    CONSTRAINT wallet_restriction_events_role_check
    CHECK (event_role IN ('created', 'lifted')),
  restriction_id uuid NOT NULL
    CONSTRAINT wallet_restriction_events_restriction_fkey
    REFERENCES piggyvest_primary.wallet_restrictions(id),
  -- The facts a redelivery must repeat to be a duplicate.
  provider_kind text NULL
    CONSTRAINT wallet_restriction_events_provider_kind_check
    CHECK (provider_kind IS NULL OR char_length(provider_kind) <= 100),
  amount_kobo bigint NULL,
  available_balance_kobo bigint NULL,
  ledger_balance_kobo bigint NULL,
  occurred_at timestamptz NULL,
  lifted_at timestamptz NULL,
  recorded_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT wallet_restriction_events_facts_check CHECK (
    (event_role = 'created' AND lifted_at IS NULL)
    OR (event_role = 'lifted' AND lifted_at IS NOT NULL AND amount_kobo IS NULL
      AND available_balance_kobo IS NULL AND ledger_balance_kobo IS NULL AND occurred_at IS NULL))
);

CREATE INDEX wallet_restriction_events_restriction_idx
  ON piggyvest_primary.wallet_restriction_events (restriction_id);

ALTER TABLE piggyvest_primary.wallet_restrictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_restrictions_deny_all ON piggyvest_primary.wallet_restrictions
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
ALTER TABLE piggyvest_primary.wallet_restriction_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_restriction_events_deny_all ON piggyvest_primary.wallet_restriction_events
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE
  piggyvest_primary.wallet_restrictions,
  piggyvest_primary.wallet_restriction_events
  FROM PUBLIC, anon, authenticated, service_role,
    piggyvest_primary_evidence, piggyvest_primary_authorizer;

COMMENT ON TABLE piggyvest_primary.wallet_restrictions IS
  'PiggyVest Freeze/Lien restrictions on provider wallets, owned by the integration that recorded them. An active row blocks spends and transfers from its wallet, whatever its kind. Reachable only through record/lift_wallet_restriction and wallet_restriction_state.';
COMMENT ON TABLE piggyvest_primary.wallet_restriction_events IS
  'Every restriction creation or lift event accepted by record/lift_wallet_restriction, kept for good so a reused event id is a duplicate (same role and facts) or a conflict. Deny-all; written only by those functions.';
COMMIT;
