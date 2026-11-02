-- PiggyVest primary-wallet restrictions (Freeze and Lien): the two writers over
-- the store of the preceding *_piggyvest_primary_wallet_restrictions migration.
-- Nothing calls them yet.
--
-- * Bound to one integration. Both writers take the integration and its
--   environment first and raise 42501, storing nothing, unless the
--   integration is enabled in that environment and its enabled evidence
--   authority (inflow_authorities) is this session's login, like every other
--   evidence writer. A row belongs to the integration that wrote it; another
--   integration naming it, or reusing one of its event ids, gets 'conflict'.
-- * Idempotent by event id, for good (wallet_restriction_events). The same
--   role with the same facts is 'duplicate'; other facts or the other role is
--   'conflict'. Neither changes anything; the caller sends a conflict to review.
-- * Provider time decides, never arrival order. A lift delivered before its
--   creation is kept, so the creation arrives already lifted; the latest lift
--   by provider time is kept; a creation dated after the kept lift places the
--   restriction again. A lifted restriction's new creation event without
--   such a time cannot be told from a redelivery, so it is a conflict.
-- * A lift and the restriction it names must agree on the kind (Freeze, Lien
--   or unknown); otherwise the event is a conflict and releases nothing.
-- * Fail closed. Any property other than Freeze or Lien, or none, is kind
--   'unknown' and blocks. A creation without a provider restriction id is
--   recorded under its event id and blocks until ops resolve it. Snapshot
--   amounts are stored as sent and never decide blocking.
--
-- Only piggyvest_primary_evidence may record or lift.
BEGIN;

CREATE FUNCTION piggyvest_primary.record_wallet_restriction(
  p_integration_id uuid,
  p_environment text,
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
  v_event piggyvest_primary.wallet_restriction_events%ROWTYPE;
  v_row piggyvest_primary.wallet_restrictions%ROWTYPE;
  v_active boolean;
  v_result text;
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

  PERFORM binding.id FROM piggyvest_primary.integrations AS binding
    JOIN piggyvest_primary.inflow_authorities AS authority ON authority.integration_id = binding.id
    WHERE binding.id = p_integration_id AND binding.environment = p_environment
      AND binding.enabled AND authority.enabled AND authority.executor_login = SESSION_USER
    FOR SHARE OF binding, authority;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restriction authority unavailable' USING ERRCODE = '42501';
  END IF;

  -- Serialise writes for this event and this restriction (always in this
  -- order, in both writers).
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'piggyvest-primary-restriction-event:' || p_provider_event_id, 0));
  IF p_provider_restriction_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'piggyvest-primary-restriction:' || p_provider_wallet_id || ':' || p_provider_restriction_id, 0));
  END IF;

  -- An accepted event id names one event for good.
  SELECT e.* INTO v_event FROM piggyvest_primary.wallet_restriction_events AS e
    WHERE e.event_id = p_provider_event_id;
  IF FOUND THEN
    SELECT r.* INTO v_row FROM piggyvest_primary.wallet_restrictions AS r
      WHERE r.id = v_event.restriction_id;
    IF v_event.event_role = 'created'
      AND v_row.integration_id = p_integration_id
      AND v_row.provider_wallet_id = p_provider_wallet_id
      AND v_row.provider_restriction_id IS NOT DISTINCT FROM p_provider_restriction_id
      AND v_event.provider_kind IS NOT DISTINCT FROM v_provider_kind
      AND v_event.amount_kobo IS NOT DISTINCT FROM p_amount_kobo
      AND v_event.available_balance_kobo IS NOT DISTINCT FROM p_available_balance_kobo
      AND v_event.ledger_balance_kobo IS NOT DISTINCT FROM p_ledger_balance_kobo
      AND v_event.occurred_at IS NOT DISTINCT FROM p_occurred_at
    THEN
      RETURN 'duplicate';
    END IF;
    RETURN 'conflict';
  END IF;

  IF p_provider_restriction_id IS NOT NULL THEN
    SELECT r.* INTO v_row FROM piggyvest_primary.wallet_restrictions AS r
      WHERE r.provider_wallet_id = p_provider_wallet_id
        AND r.provider_restriction_id = p_provider_restriction_id
      FOR UPDATE;
  END IF;

  IF v_row.id IS NULL THEN
    INSERT INTO piggyvest_primary.wallet_restrictions AS r (
      integration_id, provider_wallet_id, provider_restriction_id, provider_event_id, kind,
      provider_kind, amount_kobo, available_balance_kobo, ledger_balance_kobo, occurred_at)
    VALUES (
      p_integration_id, p_provider_wallet_id, p_provider_restriction_id, p_provider_event_id, v_kind,
      v_provider_kind, p_amount_kobo, p_available_balance_kobo, p_ledger_balance_kobo, p_occurred_at)
    RETURNING r.* INTO v_row;
    v_result := 'recorded';
  ELSIF v_row.integration_id <> p_integration_id THEN
    -- Another integration's restriction is never matched or completed here.
    RETURN 'conflict';
  ELSIF v_row.provider_event_id IS NOT NULL
    AND (v_row.is_active OR p_occurred_at IS NULL OR p_occurred_at <= v_row.lifted_at)
  THEN
    -- Another creation event for a placed restriction. While it is active the
    -- same facts are a duplicate (the id is kept, so it stays taken). Once
    -- lifted, a creation not dated after the kept lift could be a redelivery
    -- or a re-placement, so it is a conflict for review.
    IF NOT v_row.is_active
      OR v_row.provider_kind IS DISTINCT FROM v_provider_kind
      OR v_row.amount_kobo IS DISTINCT FROM p_amount_kobo
      OR v_row.available_balance_kobo IS DISTINCT FROM p_available_balance_kobo
      OR v_row.ledger_balance_kobo IS DISTINCT FROM p_ledger_balance_kobo
      OR v_row.occurred_at IS DISTINCT FROM p_occurred_at
    THEN
      RETURN 'conflict';
    END IF;
    v_result := 'duplicate';
  ELSIF v_row.kind <> v_kind
    AND (p_occurred_at IS NULL OR p_occurred_at <= v_row.lifted_at)
  THEN
    -- The early lift names another kind and would end this placement.
    RETURN 'conflict';
  ELSE
    -- Only the lift had arrived, or this creation is dated after the kept
    -- lift (a re-placement): it becomes the placement, and provider time
    -- decides whether the kept lift ends it.
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
    v_result := CASE WHEN v_active THEN 'recorded' ELSE 'already_lifted' END;
  END IF;

  INSERT INTO piggyvest_primary.wallet_restriction_events (
    event_id, event_role, restriction_id, provider_kind, amount_kobo,
    available_balance_kobo, ledger_balance_kobo, occurred_at)
  VALUES (
    p_provider_event_id, 'created', v_row.id, v_provider_kind, p_amount_kobo,
    p_available_balance_kobo, p_ledger_balance_kobo, p_occurred_at);
  RETURN v_result;
END $$;

CREATE FUNCTION piggyvest_primary.lift_wallet_restriction(
  p_integration_id uuid,
  p_environment text,
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
  v_provider_kind text := pg_catalog.left(p_provider_kind, 100);
  v_event piggyvest_primary.wallet_restriction_events%ROWTYPE;
  v_row piggyvest_primary.wallet_restrictions%ROWTYPE;
  v_active boolean;
  v_result text;
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

  PERFORM binding.id FROM piggyvest_primary.integrations AS binding
    JOIN piggyvest_primary.inflow_authorities AS authority ON authority.integration_id = binding.id
    WHERE binding.id = p_integration_id AND binding.environment = p_environment
      AND binding.enabled AND authority.enabled AND authority.executor_login = SESSION_USER
    FOR SHARE OF binding, authority;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restriction authority unavailable' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'piggyvest-primary-restriction-event:' || p_lift_event_id, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'piggyvest-primary-restriction:' || p_provider_wallet_id || ':' || p_provider_restriction_id, 0));

  -- An accepted event id names one event for good, superseded lifts included.
  SELECT e.* INTO v_event FROM piggyvest_primary.wallet_restriction_events AS e
    WHERE e.event_id = p_lift_event_id;
  IF FOUND THEN
    SELECT r.* INTO v_row FROM piggyvest_primary.wallet_restrictions AS r
      WHERE r.id = v_event.restriction_id;
    IF v_event.event_role = 'lifted'
      AND v_row.integration_id = p_integration_id
      AND v_row.provider_wallet_id = p_provider_wallet_id
      AND v_row.provider_restriction_id = p_provider_restriction_id
      AND v_event.provider_kind IS NOT DISTINCT FROM v_provider_kind
      AND v_event.lifted_at = p_lifted_at
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
    INSERT INTO piggyvest_primary.wallet_restrictions AS r (
      integration_id, provider_wallet_id, provider_restriction_id, kind, provider_kind,
      lift_event_id, lifted_at)
    VALUES (
      p_integration_id, p_provider_wallet_id, p_provider_restriction_id, v_kind, v_provider_kind,
      p_lift_event_id, p_lifted_at)
    RETURNING r.* INTO v_row;
    v_result := 'lifted';
  ELSIF v_row.integration_id <> p_integration_id OR v_row.kind <> v_kind THEN
    -- Another integration's restriction, or a lift naming another kind, is
    -- never applied here.
    RETURN 'conflict';
  ELSE
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
    v_result := CASE WHEN v_active THEN 'stale' ELSE 'lifted' END;
  END IF;

  INSERT INTO piggyvest_primary.wallet_restriction_events (
    event_id, event_role, restriction_id, provider_kind, lifted_at)
  VALUES (p_lift_event_id, 'lifted', v_row.id, v_provider_kind, p_lifted_at);
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION
  piggyvest_primary.record_wallet_restriction(uuid, text, text, text, text, text, bigint, bigint, bigint, timestamptz),
  piggyvest_primary.lift_wallet_restriction(uuid, text, text, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  piggyvest_primary.record_wallet_restriction(uuid, text, text, text, text, text, bigint, bigint, bigint, timestamptz),
  piggyvest_primary.lift_wallet_restriction(uuid, text, text, text, text, text, timestamptz)
  TO piggyvest_primary_evidence;

COMMENT ON FUNCTION piggyvest_primary.record_wallet_restriction(uuid, text, text, text, text, text, bigint, bigint, bigint, timestamptz) IS
  'Evidence-only, bound to the integration whose evidence authority is the session login (else 42501). Records restriction-created for a provider wallet. Returns recorded | already_lifted | duplicate | conflict. Unknown properties are kind unknown and block; invalid identities raise 22023.';
COMMENT ON FUNCTION piggyvest_primary.lift_wallet_restriction(uuid, text, text, text, text, text, timestamptz) IS
  'Evidence-only, bound to the integration whose evidence authority is the session login (else 42501). Records restriction-lifted (provider lifted_at) for the restriction it names on the wallet it names. Returns lifted | stale | duplicate | conflict; invalid input raises 22023.';
COMMIT;
