-- Contract test: the PiggyVest primary-wallet restriction store remembers
-- every event id it has accepted (piggyvest_primary.wallet_restriction_events),
-- not only the ids a restriction row currently holds. Proves, against live
-- PostgreSQL, that an event id names one event for good:
--   * a redelivered lift that was superseded, older than the kept lift or
--     stale is a duplicate;
--   * any of those lift ids reused with different facts is a conflict, and
--     the restriction it names stays exactly as it was (still blocking);
--   * a creation id absorbed as a duplicate (same restriction, new event id)
--     is remembered, so reusing it as a lift is a conflict;
--   * a superseded lift id reused as a creation is a conflict;
--   * conflicts add nothing to the event ledger.
-- The calls run as the session role, bound to the fixture's integration A.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_primary_wallet_restriction_events.sql

BEGIN;

\ir piggyvest_primary_wallet_restrictions_fixture.inc.sql

CREATE FUNCTION pg_temp.snapshot(p_wallet text, p_restriction text) RETURNS text
LANGUAGE sql AS $$
  SELECT concat_ws('|', r.provider_event_id, r.lift_event_id, r.lifted_at, r.is_active, r.updated_at)
  FROM piggyvest_primary.wallet_restrictions AS r
  WHERE r.provider_wallet_id = p_wallet AND r.provider_restriction_id = p_restriction
$$;

-- A stale lift id reused with different facts (the lift that the row no
-- longer names) is a conflict and keeps the restriction active.
DO $$
DECLARE v_before text;
BEGIN
  PERFORM pg_temp.check(
    pg_temp.lift('ev-a', 'evt-a-lift-1', 'rst-a', 'Lien', '2026-10-01T12:00:00Z') = 'lifted',
    'an early lift is not stored');
  PERFORM pg_temp.check(
    pg_temp.rec('ev-a', 'evt-a-create', 'rst-a', 'Lien', '2026-10-01T13:00:00Z') = 'recorded',
    'a placement after the early lift is not active');
  PERFORM pg_temp.check(
    pg_temp.lift('ev-a', 'evt-a-lift-0', 'rst-a', 'Lien', '2026-10-01T12:30:00Z') = 'stale',
    'a lift before the placement is not stale');
  v_before := pg_temp.snapshot('ev-a', 'rst-a');
  PERFORM pg_temp.check(
    pg_temp.lift('ev-a', 'evt-a-lift-1', 'rst-a', 'Lien', '2026-10-01T15:00:00Z') = 'conflict',
    'a superseded lift id reused with a later time is not a conflict');
  PERFORM pg_temp.check(pg_temp.blocked('ev-a'), 'a reused lift id unblocked the wallet');
  PERFORM pg_temp.check(pg_temp.snapshot('ev-a', 'rst-a') = v_before,
    'a reused lift id changed the restriction');
  PERFORM pg_temp.check(
    pg_temp.lift('ev-a', 'evt-a-lift-0', 'rst-a', 'Lien', '2026-10-01T12:30:00Z') = 'duplicate',
    'a redelivered stale lift is not a duplicate');
  PERFORM pg_temp.check(
    pg_temp.lift('ev-a', 'evt-a-lift-1', 'rst-a', 'Lien', '2026-10-01T12:00:00Z') = 'duplicate',
    'a redelivered superseded lift is not a duplicate');
  PERFORM pg_temp.check(
    pg_temp.lift('ev-a', 'evt-a-lift-1', 'rst-a', 'Freeze', '2026-10-01T12:00:00Z') = 'conflict',
    'a lift id reused with another property is not a conflict');
  PERFORM pg_temp.check(pg_temp.blocked('ev-a') AND pg_temp.snapshot('ev-a', 'rst-a') = v_before,
    'a redelivery changed the restriction');
  PERFORM pg_temp.check(pg_temp.events('ev-a') = 3,
    'the ledger must hold the creation and both lifts, and nothing for conflicts');
END $$;

-- A lift older than the kept one, and a lift overwritten by a newer one, are
-- remembered: reusing either id for another restriction is a conflict.
DO $$
DECLARE v_before text;
BEGIN
  PERFORM pg_temp.rec('ev-b', 'evt-b-create-1', 'rst-b1', 'Lien');
  PERFORM pg_temp.check(
    pg_temp.lift('ev-b', 'evt-b-lift-2', 'rst-b1', 'Lien', '2026-10-01T12:00:00Z') = 'lifted',
    'the first lift did not lift');
  PERFORM pg_temp.check(
    pg_temp.lift('ev-b', 'evt-b-lift-1', 'rst-b1', 'Lien', '2026-10-01T11:00:00Z') = 'lifted',
    'an older lift of a lifted restriction is not reported lifted');
  PERFORM pg_temp.check(
    pg_temp.lift('ev-b', 'evt-b-lift-3', 'rst-b1', 'Lien', '2026-10-01T14:00:00Z') = 'lifted',
    'a newer lift did not replace the kept one');
  PERFORM pg_temp.check(
    pg_temp.rec('ev-b', 'evt-b-create-2', 'rst-b2', 'Freeze') = 'recorded',
    'a second restriction is not recorded');
  PERFORM pg_temp.check(pg_temp.blocked('ev-b'), 'the second restriction does not block');
  v_before := pg_temp.snapshot('ev-b', 'rst-b2');

  PERFORM pg_temp.check(
    pg_temp.lift('ev-b', 'evt-b-lift-1', 'rst-b2', 'Freeze', '2026-10-01T15:00:00Z') = 'conflict',
    'an older lift id reused for another restriction is not a conflict');
  PERFORM pg_temp.check(
    pg_temp.lift('ev-b', 'evt-b-lift-2', 'rst-b2', 'Freeze', '2026-10-01T15:00:00Z') = 'conflict',
    'an overwritten lift id reused for another restriction is not a conflict');
  PERFORM pg_temp.check(pg_temp.blocked('ev-b') AND pg_temp.snapshot('ev-b', 'rst-b2') = v_before,
    'a reused lift id lifted another restriction');

  PERFORM pg_temp.check(
    pg_temp.rec('ev-b', 'evt-b-lift-2', 'rst-b3', 'Lien') = 'conflict',
    'an overwritten lift id reused as a creation is not a conflict');
  PERFORM pg_temp.check(
    pg_temp.rec('ev-b', 'evt-b-lift-1', NULL, 'Lien') = 'conflict',
    'an older lift id reused as a creation without a restriction id is not a conflict');
  PERFORM pg_temp.check(pg_temp.rows('ev-b') = 2 AND pg_temp.active('ev-b') = 1,
    'a lift id reused as a creation added a restriction');
  PERFORM pg_temp.check(
    pg_temp.lift('ev-b', 'evt-b-lift-1', 'rst-b1', 'Lien', '2026-10-01T11:00:00Z') = 'duplicate',
    'a redelivered older lift is not a duplicate');
  PERFORM pg_temp.check(pg_temp.events('ev-b') = 5,
    'the ledger must hold both creations and all three lifts');
END $$;

-- A creation id absorbed as a duplicate is remembered.
DO $$
DECLARE v_before text;
BEGIN
  PERFORM pg_temp.check(pg_temp.rec('ev-c', 'evt-c-create-1', 'rst-c', 'Lien') = 'recorded',
    'the creation is not recorded');
  PERFORM pg_temp.check(pg_temp.rec('ev-c', 'evt-c-create-2', 'rst-c', 'Lien') = 'duplicate',
    'the same restriction under a new event id is not a duplicate');
  v_before := pg_temp.snapshot('ev-c', 'rst-c');
  PERFORM pg_temp.check(
    pg_temp.lift('ev-c', 'evt-c-create-2', 'rst-c', 'Lien', '2026-10-01T12:00:00Z') = 'conflict',
    'an absorbed creation id reused as a lift is not a conflict');
  PERFORM pg_temp.check(
    pg_temp.lift('ev-c', 'evt-c-create-1', 'rst-c', 'Lien', '2026-10-01T12:00:00Z') = 'conflict',
    'the stored creation id reused as a lift is not a conflict');
  PERFORM pg_temp.check(pg_temp.blocked('ev-c') AND pg_temp.snapshot('ev-c', 'rst-c') = v_before,
    'a creation id reused as a lift changed the restriction');
  PERFORM pg_temp.check(pg_temp.rec('ev-c', 'evt-c-create-2', 'rst-c', 'Lien') = 'duplicate',
    'a redelivered absorbed creation is not a duplicate');
  PERFORM pg_temp.check(
    pg_temp.rec('ev-c', 'evt-c-create-2', 'rst-c', 'Lien', NULL, 7) = 'conflict',
    'an absorbed creation id reused with another amount is not a conflict');
  PERFORM pg_temp.check(
    pg_temp.rec('ev-c', 'evt-c-create-2', 'rst-c-other', 'Lien') = 'conflict',
    'an absorbed creation id reused for another restriction is not a conflict');
  PERFORM pg_temp.check(pg_temp.rows('ev-c') = 1 AND pg_temp.events('ev-c') = 2,
    'conflicts must add no restriction and no ledger entry');
END $$;

-- A lift id reused as a creation of the same restriction with no snapshot
-- facts (nothing to tell them apart but the role) is a conflict.
DO $$ BEGIN
  PERFORM pg_temp.check(
    pg_temp.lift('ev-e', 'evt-e-lift', 'rst-e', 'Lien', '2026-10-01T12:00:00Z') = 'lifted',
    'an early lift is not stored');
  PERFORM pg_temp.check(
    piggyvest_primary.record_wallet_restriction(pg_temp.integration_a(), 'staging',
      'ev-e', 'evt-e-lift', 'rst-e', 'Lien', NULL, NULL, NULL, NULL) = 'conflict',
    'a lift id reused as a bare creation of the same restriction is not a conflict');
  PERFORM pg_temp.check(
    (SELECT provider_event_id IS NULL FROM piggyvest_primary.wallet_restrictions
     WHERE provider_wallet_id = 'ev-e') AND pg_temp.events('ev-e') = 1,
    'a lift id reused as a creation completed the restriction');
END $$;

-- An event id is global: reusing one on another wallet is a conflict.
DO $$ BEGIN
  PERFORM pg_temp.check(
    pg_temp.lift('ev-d', 'evt-a-lift-0', 'rst-a', 'Lien', '2026-10-01T12:30:00Z') = 'conflict',
    'a lift id reused on another wallet is not a conflict');
  PERFORM pg_temp.check(pg_temp.rec('ev-d', 'evt-c-create-2', 'rst-c', 'Lien') = 'conflict',
    'a creation id reused on another wallet is not a conflict');
  PERFORM pg_temp.check(pg_temp.rows('ev-d') = 0, 'a reused event id stored a row on another wallet');
END $$;

ROLLBACK;
