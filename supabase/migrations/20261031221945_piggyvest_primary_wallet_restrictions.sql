-- PiggyVest primary-wallet restrictions (Freeze and Lien).
--
-- restriction-created.success and restriction-lifted.success both carry the
-- restriction id (eventData.id, the same in both events per the public
-- webhook docs), its property (Freeze or Lien), the lien amount and the
-- wallet's available and ledger balances; only the lift carries a provider
-- time (eventData.lifted_at). Money rules R1/R2: while any restriction on a
-- wallet is active, that wallet must not spend or transfer. This adds the
-- store and its functions only; nothing calls them yet.
--
-- * One row per provider restriction on a provider wallet id, keyed by
--   (provider_wallet_id, provider_restriction_id): a lift only ever ends the
--   restriction it names on the wallet it names.
-- * Idempotent by event id. A redelivered creation or lift returns
--   'duplicate'. The same event id with different facts returns 'conflict'
--   and changes nothing; the caller sends that delivery to review.
-- * Out of order. A lift delivered before its creation is stored on its own
--   row, so the creation arrives already lifted. Provider time decides, never
--   arrival order: a restriction is active while no lift is recorded, or
--   while its placement time (when the provider supplies one) is later than
--   the latest recorded lift.
-- * Fail closed. Any property other than Freeze or Lien, including none, is
--   recorded as kind 'unknown' and blocks like the others. A creation without
--   a provider restriction id is recorded under its event id and blocks until
--   ops resolve it, because no lift can name it. The snapshot amounts are
--   stored exactly as sent and never decide whether a wallet is blocked.
--
-- Access: the table is deny-all (RLS, a restrictive false policy, no table
-- privilege for PUBLIC, API roles incl. service_role, or PiggyVest roles).
-- Only piggyvest_primary_evidence may record/lift; wallet_restriction_state
-- is also open to piggyvest_primary_authorizer (the spend gate).
BEGIN;

CREATE TABLE piggyvest_primary.wallet_restrictions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  provider_wallet_id text NOT NULL
    CONSTRAINT wallet_restrictions_provider_wallet_id_check
    CHECK (octet_length(provider_wallet_id) BETWEEN 1 AND 512),
  provider_restriction_id text NULL
    CONSTRAINT wallet_restrictions_provider_restriction_id_check
    CHECK (provider_restriction_id IS NULL OR octet_length(provider_restriction_id) BETWEEN 1 AND 512),
  -- The creation event; NULL while only the lift has arrived.
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

ALTER TABLE piggyvest_primary.wallet_restrictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_restrictions_deny_all ON piggyvest_primary.wallet_restrictions
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE piggyvest_primary.wallet_restrictions
  FROM PUBLIC, anon, authenticated, service_role,
    piggyvest_primary_evidence, piggyvest_primary_authorizer;

COMMENT ON TABLE piggyvest_primary.wallet_restrictions IS
  'PiggyVest Freeze/Lien restrictions on provider wallets. An active row blocks spends and transfers from its wallet, whatever its kind. Reachable only through record/lift_wallet_restriction and wallet_restriction_state.';

CREATE FUNCTION piggyvest_primary.record_wallet_restriction(
  p_provider_wallet_id text,
  p_provider_event_id text,
  p_provider_restriction_id text,
  p_provider_kind text,
  p_amount_kobo bigint,
  p_available_balance_kobo bigint,
  p_ledger_balance_kobo bigint,
  p_occurred_at timestamptz
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_kind text := CASE pg_catalog.lower(pg_catalog.btrim(p_provider_kind))
    WHEN 'freeze' THEN 'freeze' WHEN 'lien' THEN 'lien' ELSE 'unknown' END;
  v_provider_kind text := pg_catalog.left(p_provider_kind, 100);
  v_row piggyvest_primary.wallet_restrictions%ROWTYPE;
  v_active boolean;
BEGIN
  IF p_provider_wallet_id IS NULL
    OR pg_catalog.octet_length(p_provider_wallet_id) NOT BETWEEN 1 AND 512
    OR p_provider_event_id IS NULL
    OR pg_catalog.octet_length(p_provider_event_id) NOT BETWEEN 1 AND 512
    OR (p_provider_restriction_id IS NOT NULL
      AND pg_catalog.octet_length(p_provider_restriction_id) NOT BETWEEN 1 AND 512)
  THEN
    RAISE EXCEPTION 'invalid wallet restriction identity' USING ERRCODE = '22023';
  END IF;

  -- Serialise writes for this event and this restriction (always in this
  -- order, in both writers).
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'piggyvest-primary-restriction-event:' || p_provider_event_id, 0));
  IF p_provider_restriction_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'piggyvest-primary-restriction:' || p_provider_wallet_id || ':' || p_provider_restriction_id, 0));
  END IF;

  -- An event id names one event, never a creation and a lift.
  IF EXISTS (SELECT 1 FROM piggyvest_primary.wallet_restrictions AS r
             WHERE r.lift_event_id = p_provider_event_id) THEN
    RETURN 'conflict';
  END IF;

  SELECT r.* INTO v_row FROM piggyvest_primary.wallet_restrictions AS r
    WHERE r.provider_event_id = p_provider_event_id FOR UPDATE;
  IF NOT FOUND AND p_provider_restriction_id IS NOT NULL THEN
    SELECT r.* INTO v_row FROM piggyvest_primary.wallet_restrictions AS r
      WHERE r.provider_wallet_id = p_provider_wallet_id
        AND r.provider_restriction_id = p_provider_restriction_id
      FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    INSERT INTO piggyvest_primary.wallet_restrictions (
      provider_wallet_id, provider_restriction_id, provider_event_id, kind, provider_kind,
      amount_kobo, available_balance_kobo, ledger_balance_kobo, occurred_at)
    VALUES (
      p_provider_wallet_id, p_provider_restriction_id, p_provider_event_id, v_kind, v_provider_kind,
      p_amount_kobo, p_available_balance_kobo, p_ledger_balance_kobo, p_occurred_at);
    RETURN 'recorded';
  END IF;

  IF v_row.provider_event_id IS NOT NULL THEN
    -- This creation event, or another creation event for the same
    -- restriction: the same facts are a duplicate, anything else a conflict.
    IF v_row.provider_wallet_id = p_provider_wallet_id
      AND v_row.provider_restriction_id IS NOT DISTINCT FROM p_provider_restriction_id
      AND v_row.provider_kind IS NOT DISTINCT FROM v_provider_kind
      AND v_row.amount_kobo IS NOT DISTINCT FROM p_amount_kobo
      AND v_row.available_balance_kobo IS NOT DISTINCT FROM p_available_balance_kobo
      AND v_row.ledger_balance_kobo IS NOT DISTINCT FROM p_ledger_balance_kobo
      AND v_row.occurred_at IS NOT DISTINCT FROM p_occurred_at
    THEN
      RETURN 'duplicate';
    END IF;
    RETURN 'conflict';
  END IF;

  -- Only the lift had arrived: complete the row. Provider time decides
  -- whether the earlier-delivered lift ends this placement.
  UPDATE piggyvest_primary.wallet_restrictions AS r
    SET provider_event_id = p_provider_event_id,
        kind = v_kind,
        provider_kind = v_provider_kind,
        amount_kobo = p_amount_kobo,
        available_balance_kobo = p_available_balance_kobo,
        ledger_balance_kobo = p_ledger_balance_kobo,
        occurred_at = p_occurred_at,
        updated_at = pg_catalog.clock_timestamp()
    WHERE r.id = v_row.id
    RETURNING r.is_active INTO v_active;
  RETURN CASE WHEN v_active THEN 'recorded' ELSE 'already_lifted' END;
END $$;

CREATE FUNCTION piggyvest_primary.lift_wallet_restriction(
  p_provider_wallet_id text,
  p_lift_event_id text,
  p_provider_restriction_id text,
  p_provider_kind text,
  p_lifted_at timestamptz
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_kind text := CASE pg_catalog.lower(pg_catalog.btrim(p_provider_kind))
    WHEN 'freeze' THEN 'freeze' WHEN 'lien' THEN 'lien' ELSE 'unknown' END;
  v_row piggyvest_primary.wallet_restrictions%ROWTYPE;
  v_active boolean;
BEGIN
  IF p_provider_wallet_id IS NULL
    OR pg_catalog.octet_length(p_provider_wallet_id) NOT BETWEEN 1 AND 512
    OR p_lift_event_id IS NULL
    OR pg_catalog.octet_length(p_lift_event_id) NOT BETWEEN 1 AND 512
    OR p_provider_restriction_id IS NULL
    OR pg_catalog.octet_length(p_provider_restriction_id) NOT BETWEEN 1 AND 512
    OR p_lifted_at IS NULL
  THEN
    RAISE EXCEPTION 'invalid wallet restriction lift' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'piggyvest-primary-restriction-event:' || p_lift_event_id, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'piggyvest-primary-restriction:' || p_provider_wallet_id || ':' || p_provider_restriction_id, 0));

  IF EXISTS (SELECT 1 FROM piggyvest_primary.wallet_restrictions AS r
             WHERE r.provider_event_id = p_lift_event_id) THEN
    RETURN 'conflict';
  END IF;

  SELECT r.* INTO v_row FROM piggyvest_primary.wallet_restrictions AS r
    WHERE r.lift_event_id = p_lift_event_id FOR UPDATE;
  IF FOUND THEN
    IF v_row.provider_wallet_id = p_provider_wallet_id
      AND v_row.provider_restriction_id = p_provider_restriction_id
      AND v_row.lifted_at = p_lifted_at
    THEN
      RETURN 'duplicate';
    END IF;
    RETURN 'conflict';
  END IF;

  SELECT r.* INTO v_row FROM piggyvest_primary.wallet_restrictions AS r
    WHERE r.provider_wallet_id = p_provider_wallet_id
      AND r.provider_restriction_id = p_provider_restriction_id
    FOR UPDATE;
  IF NOT FOUND THEN
    -- Delivered before its creation: kept so the creation arrives lifted.
    INSERT INTO piggyvest_primary.wallet_restrictions (
      provider_wallet_id, provider_restriction_id, kind, provider_kind, lift_event_id, lifted_at)
    VALUES (
      p_provider_wallet_id, p_provider_restriction_id, v_kind,
      pg_catalog.left(p_provider_kind, 100), p_lift_event_id, p_lifted_at);
    RETURN 'lifted';
  END IF;

  -- Keep the latest lift by provider time; an older one changes nothing.
  v_active := v_row.is_active;
  IF v_row.lifted_at IS NULL OR p_lifted_at > v_row.lifted_at THEN
    UPDATE piggyvest_primary.wallet_restrictions AS r
      SET lift_event_id = p_lift_event_id,
          lifted_at = p_lifted_at,
          updated_at = pg_catalog.clock_timestamp()
      WHERE r.id = v_row.id
      RETURNING r.is_active INTO v_active;
  END IF;
  -- 'stale': the lift predates the placement, which stays active.
  RETURN CASE WHEN v_active THEN 'stale' ELSE 'lifted' END;
END $$;

CREATE FUNCTION piggyvest_primary.wallet_restriction_state(p_provider_wallet_id text)
RETURNS TABLE (blocked boolean, active_count integer, active_kinds text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_provider_wallet_id IS NULL
    OR pg_catalog.octet_length(p_provider_wallet_id) NOT BETWEEN 1 AND 512
  THEN
    RAISE EXCEPTION 'invalid wallet restriction identity' USING ERRCODE = '22023';
  END IF;
  -- Every active restriction blocks, whatever its kind (unknown included).
  RETURN QUERY
    SELECT pg_catalog.count(*) > 0,
      pg_catalog.count(*)::integer,
      COALESCE(pg_catalog.array_agg(DISTINCT r.kind ORDER BY r.kind), ARRAY[]::text[])
    FROM piggyvest_primary.wallet_restrictions AS r
    WHERE r.provider_wallet_id = p_provider_wallet_id AND r.is_active;
END $$;

REVOKE ALL ON FUNCTION
  piggyvest_primary.record_wallet_restriction(text, text, text, text, bigint, bigint, bigint, timestamptz),
  piggyvest_primary.lift_wallet_restriction(text, text, text, text, timestamptz),
  piggyvest_primary.wallet_restriction_state(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  piggyvest_primary.record_wallet_restriction(text, text, text, text, bigint, bigint, bigint, timestamptz),
  piggyvest_primary.lift_wallet_restriction(text, text, text, text, timestamptz)
  TO piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.wallet_restriction_state(text)
  TO piggyvest_primary_evidence, piggyvest_primary_authorizer;

COMMENT ON FUNCTION piggyvest_primary.record_wallet_restriction(text, text, text, text, bigint, bigint, bigint, timestamptz) IS
  'Evidence-only. Records restriction-created for a provider wallet. Returns recorded | already_lifted | duplicate | conflict. Unknown properties are kind unknown and block; invalid identities raise 22023.';
COMMENT ON FUNCTION piggyvest_primary.lift_wallet_restriction(text, text, text, text, timestamptz) IS
  'Evidence-only. Records restriction-lifted (provider lifted_at) for the restriction it names on the wallet it names. Returns lifted | stale | duplicate | conflict; invalid input raises 22023.';
COMMENT ON FUNCTION piggyvest_primary.wallet_restriction_state(text) IS
  'Evidence and authorizer. One row: blocked (any active restriction of any kind), active_count, active_kinds. Invalid wallet ids raise 22023.';
COMMIT;
