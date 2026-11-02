-- PiggyVest primary-wallet restrictions (Freeze and Lien): the writers and
-- the spend-gate read, over the tables of
-- 20261102034228_piggyvest_primary_wallet_restrictions.sql. Nothing calls
-- them yet.
--
-- * Bound to one integration. Both writers take the integration and its
--   environment first. Unless the integration is enabled in that
--   environment and its enabled evidence authority (inflow_authorities) is
--   this session's login, they raise 42501 and store nothing: the check every
--   other evidence writer makes, so disabling either stops every write. A row
--   belongs to the integration that wrote it; another integration naming it,
--   or reusing one of its event ids, gets 'conflict'.
-- * Idempotent by event id, for good. Every accepted event is kept in
--   wallet_restriction_events. A redelivery in the same role with the same
--   facts returns 'duplicate'; the same id with other facts, or in the other
--   role, returns 'conflict'. Neither changes anything; the caller sends a
--   conflict to review.
-- * Out of order. A lift delivered before its creation is stored on its own
--   row, so the creation arrives already lifted. Provider time decides, never
--   arrival order; the latest lift by provider time is the one kept.
-- * Fail closed. Any property other than Freeze or Lien, including none, is
--   recorded as kind 'unknown' and blocks like the others. A creation without
--   a provider restriction id is recorded under its event id and blocks until
--   ops resolve it, because no lift can name it. The snapshot amounts are
--   stored exactly as sent and never decide whether a wallet is blocked.
--   wallet_restriction_state counts every active restriction of the wallet,
--   whichever integration recorded it.
--
-- Only piggyvest_primary_evidence may record/lift; wallet_restriction_state
-- is also open to piggyvest_primary_authorizer (the spend gate).
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
  ELSIF v_row.provider_event_id IS NOT NULL THEN
    -- Another creation event for the same restriction: the same facts are a
    -- duplicate (its id is kept, so it stays taken), anything else a conflict.
    IF v_row.provider_kind IS DISTINCT FROM v_provider_kind
      OR v_row.amount_kobo IS DISTINCT FROM p_amount_kobo
      OR v_row.available_balance_kobo IS DISTINCT FROM p_available_balance_kobo
      OR v_row.ledger_balance_kobo IS DISTINCT FROM p_ledger_balance_kobo
      OR v_row.occurred_at IS DISTINCT FROM p_occurred_at
    THEN
      RETURN 'conflict';
    END IF;
    v_result := 'duplicate';
  ELSE
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
  ELSIF v_row.integration_id <> p_integration_id THEN
    -- Another integration's restriction is never lifted here.
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

CREATE FUNCTION piggyvest_primary.wallet_restriction_state(p_provider_wallet_id text)
RETURNS TABLE (blocked boolean, active_count integer, active_kinds text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_provider_wallet_id IS NULL
    OR pg_catalog.octet_length(p_provider_wallet_id) NOT BETWEEN 1 AND 512
  THEN
    RAISE EXCEPTION 'invalid wallet restriction identity' USING ERRCODE = '22023';
  END IF;
  -- Every active restriction blocks, whatever its kind (unknown included)
  -- and whichever integration recorded it.
  RETURN QUERY
    SELECT pg_catalog.count(*) > 0,
      pg_catalog.count(*)::integer,
      COALESCE(pg_catalog.array_agg(DISTINCT r.kind ORDER BY r.kind), ARRAY[]::text[])
    FROM piggyvest_primary.wallet_restrictions AS r
    WHERE r.provider_wallet_id = p_provider_wallet_id AND r.is_active;
END $$;

REVOKE ALL ON FUNCTION
  piggyvest_primary.record_wallet_restriction(uuid, text, text, text, text, text, bigint, bigint, bigint, timestamptz),
  piggyvest_primary.lift_wallet_restriction(uuid, text, text, text, text, text, timestamptz),
  piggyvest_primary.wallet_restriction_state(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  piggyvest_primary.record_wallet_restriction(uuid, text, text, text, text, text, bigint, bigint, bigint, timestamptz),
  piggyvest_primary.lift_wallet_restriction(uuid, text, text, text, text, text, timestamptz)
  TO piggyvest_primary_evidence;
GRANT EXECUTE ON FUNCTION piggyvest_primary.wallet_restriction_state(text)
  TO piggyvest_primary_evidence, piggyvest_primary_authorizer;

COMMENT ON FUNCTION piggyvest_primary.record_wallet_restriction(uuid, text, text, text, text, text, bigint, bigint, bigint, timestamptz) IS
  'Evidence-only, bound to the integration whose evidence authority is the session login (else 42501). Records restriction-created for a provider wallet. Returns recorded | already_lifted | duplicate | conflict. Unknown properties are kind unknown and block; invalid identities raise 22023.';
COMMENT ON FUNCTION piggyvest_primary.lift_wallet_restriction(uuid, text, text, text, text, text, timestamptz) IS
  'Evidence-only, bound to the integration whose evidence authority is the session login (else 42501). Records restriction-lifted (provider lifted_at) for the restriction it names on the wallet it names. Returns lifted | stale | duplicate | conflict; invalid input raises 22023.';
COMMENT ON FUNCTION piggyvest_primary.wallet_restriction_state(text) IS
  'Evidence and authorizer. One row: blocked (any active restriction of any kind, from any integration), active_count, active_kinds. Invalid wallet ids raise 22023.';
COMMIT;
