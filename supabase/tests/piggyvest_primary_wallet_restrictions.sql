-- Contract test: the PiggyVest primary-wallet restriction store
-- (piggyvest_primary.wallet_restrictions with record_wallet_restriction,
-- lift_wallet_restriction and wallet_restriction_state). Proves, against live
-- PostgreSQL:
--   * a restriction blocks its wallet until it is lifted, and both the
--     creation and the lift are idempotent by provider event id;
--   * a reused event id with different facts is a conflict and changes
--     nothing;
--   * a lift delivered before its creation leaves the restriction lifted, and
--     provider time (never arrival order) decides whether a lift ends it;
--   * any property other than Freeze or Lien, or none, is recorded as
--     'unknown' and blocks;
--   * a creation without a provider restriction id is recorded and blocks;
--   * a lift only ends the restriction it names on the wallet it names;
--   * malformed identities raise 22023 instead of being stored.
-- Grants are asserted through the catalog in
-- piggyvest_primary_wallet_restrictions_privileges.sql. The calls here run as
-- the session role (the functions' owner), bound to the fixture's
-- integration A. Event-id reuse is covered in
-- piggyvest_primary_wallet_restriction_events.sql and the integration binding
-- in piggyvest_primary_wallet_restriction_authority.sql.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/piggyvest_primary_wallet_restrictions.sql

BEGIN;

-- The fixture (two integrations, the caller's authority) and the helpers.
\ir piggyvest_primary_wallet_restrictions_fixture.inc.sql

-- A wallet with no restriction is not blocked; the state is always one row.
DO $$ BEGIN
  PERFORM pg_temp.check(NOT pg_temp.blocked('wr-clean'), 'a clean wallet is blocked');
  PERFORM pg_temp.check(pg_temp.active('wr-clean') = 0, 'a clean wallet has active restrictions');
  PERFORM pg_temp.check(pg_temp.kinds('wr-clean') = '{}'::text[], 'a clean wallet lists kinds');
  PERFORM pg_temp.check(
    (SELECT count(*) FROM piggyvest_primary.wallet_restriction_state('wr-clean')) = 1,
    'the state must be exactly one row');
END $$;

-- Create, then lift; both idempotent by event id.
DO $$
DECLARE v piggyvest_primary.wallet_restrictions%ROWTYPE;
BEGIN
  PERFORM pg_temp.check(pg_temp.rec('wr-a', 'evt-a-create', 'rst-a', 'Lien') = 'recorded',
    'a new lien is not recorded');
  PERFORM pg_temp.check(pg_temp.blocked('wr-a'), 'an active lien does not block');
  PERFORM pg_temp.check(pg_temp.kinds('wr-a') = '{lien}'::text[], 'the lien kind is not reported');
  PERFORM pg_temp.check(pg_temp.rec('wr-a', 'evt-a-create', 'rst-a', 'Lien') = 'duplicate',
    'a redelivered creation is not a duplicate');
  PERFORM pg_temp.check(pg_temp.rows('wr-a') = 1, 'a redelivered creation added a row');
  PERFORM pg_temp.check(
    pg_temp.rec('wr-a', 'evt-a-create', 'rst-a', 'Lien', NULL, 5) = 'conflict',
    'a reused creation event id with a different amount is not a conflict');
  SELECT * INTO v FROM piggyvest_primary.wallet_restrictions WHERE provider_event_id = 'evt-a-create';
  PERFORM pg_temp.check(v.amount_kobo = 1000000 AND v.available_balance_kobo = 650733
    AND v.ledger_balance_kobo = 1650733 AND v.kind = 'lien' AND v.provider_kind = 'Lien',
    'the recorded creation facts changed');

  PERFORM pg_temp.check(
    pg_temp.lift('wr-a', 'evt-a-lift', 'rst-a', 'Lien', '2026-10-01T12:48:11Z') = 'lifted',
    'the lift did not lift the lien');
  PERFORM pg_temp.check(NOT pg_temp.blocked('wr-a'), 'a lifted lien still blocks');
  PERFORM pg_temp.check(
    pg_temp.lift('wr-a', 'evt-a-lift', 'rst-a', 'Lien', '2026-10-01T12:48:11Z') = 'duplicate',
    'a redelivered lift is not a duplicate');
  PERFORM pg_temp.check(
    pg_temp.lift('wr-a', 'evt-a-lift', 'rst-a', 'Lien', '2026-10-01T13:00:00Z') = 'conflict',
    'a reused lift event id with a different time is not a conflict');
  SELECT * INTO v FROM piggyvest_primary.wallet_restrictions WHERE provider_event_id = 'evt-a-create';
  PERFORM pg_temp.check(v.lift_event_id = 'evt-a-lift' AND v.lifted_at = '2026-10-01T12:48:11Z',
    'the recorded lift changed');
  PERFORM pg_temp.check(pg_temp.rec('wr-a', 'evt-a-create', 'rst-a', 'Lien') = 'duplicate',
    'a creation redelivered after its lift is not a duplicate');
  PERFORM pg_temp.check(NOT pg_temp.blocked('wr-a') AND pg_temp.rows('wr-a') = 1,
    'a creation redelivered after its lift re-blocked the wallet');
  PERFORM pg_temp.check(
    pg_temp.rec('wr-a', 'evt-a-create-again', 'rst-a', 'Lien') = 'conflict',
    'a new creation event for a lifted restriction with no later provider time is not sent to review');
  PERFORM pg_temp.check(
    pg_temp.rec('wr-a', 'evt-a-create-other', 'rst-a', 'Freeze') = 'conflict',
    'the same restriction under a new event id with other facts is not a conflict');
  PERFORM pg_temp.check(NOT pg_temp.blocked('wr-a') AND pg_temp.rows('wr-a') = 1,
    'a second creation event for a lifted restriction changed it');
END $$;

-- Out of order: the lift is delivered before its creation.
DO $$
DECLARE v piggyvest_primary.wallet_restrictions%ROWTYPE;
BEGIN
  PERFORM pg_temp.check(
    pg_temp.lift('wr-b', 'evt-b-lift', 'rst-b', 'Freeze', '2026-10-01T12:43:36Z') = 'lifted',
    'an early lift is not stored as lifted');
  PERFORM pg_temp.check(NOT pg_temp.blocked('wr-b'), 'an early lift blocks the wallet');
  PERFORM pg_temp.check(
    pg_temp.rec('wr-b', 'evt-b-create', 'rst-b', 'Freeze', NULL, 0) = 'already_lifted',
    'a creation arriving after its lift is not already lifted');
  PERFORM pg_temp.check(NOT pg_temp.blocked('wr-b') AND pg_temp.rows('wr-b') = 1,
    'a creation arriving after its lift blocks the wallet');
  SELECT * INTO v FROM piggyvest_primary.wallet_restrictions WHERE provider_wallet_id = 'wr-b';
  PERFORM pg_temp.check(v.provider_event_id = 'evt-b-create' AND v.kind = 'freeze'
    AND v.amount_kobo = 0 AND v.lift_event_id = 'evt-b-lift', 'the late creation was not stored');
  PERFORM pg_temp.check(
    pg_temp.rec('wr-b', 'evt-b-create', 'rst-b', 'Freeze', NULL, 0) = 'duplicate',
    'a redelivered late creation is not a duplicate');

  -- Provider time decides: a placement dated before the lift stays lifted.
  PERFORM pg_temp.lift('wr-c', 'evt-c-lift', 'rst-c', 'Lien', '2026-10-01T12:00:00Z');
  PERFORM pg_temp.check(
    pg_temp.rec('wr-c', 'evt-c-create', 'rst-c', 'Lien', '2026-10-01T11:00:00Z') = 'already_lifted',
    'a placement dated before its lift is not already lifted');
  PERFORM pg_temp.check(NOT pg_temp.blocked('wr-c'), 'a placement dated before its lift blocks');

  -- A placement dated after the only lift is active.
  PERFORM pg_temp.lift('wr-d', 'evt-d-lift-1', 'rst-d', 'Lien', '2026-10-01T12:00:00Z');
  PERFORM pg_temp.check(
    pg_temp.rec('wr-d', 'evt-d-create', 'rst-d', 'Lien', '2026-10-01T13:00:00Z') = 'recorded',
    'a placement dated after the lift is not recorded as active');
  PERFORM pg_temp.check(pg_temp.blocked('wr-d'), 'a placement dated after the lift does not block');
  PERFORM pg_temp.check(
    pg_temp.lift('wr-d', 'evt-d-lift-0', 'rst-d', 'Lien', '2026-10-01T12:30:00Z') = 'stale',
    'a lift dated before the placement is not stale');
  PERFORM pg_temp.check(pg_temp.blocked('wr-d'), 'a lift dated before the placement unblocked it');
  PERFORM pg_temp.check(
    pg_temp.lift('wr-d', 'evt-d-lift-2', 'rst-d', 'Lien', '2026-10-01T14:00:00Z') = 'lifted',
    'a lift dated after the placement did not lift it');
  PERFORM pg_temp.check(NOT pg_temp.blocked('wr-d'), 'a lift dated after the placement still blocks');
  PERFORM pg_temp.check(
    pg_temp.lift('wr-d', 'evt-d-lift-1', 'rst-d', 'Lien', '2026-10-01T12:00:00Z') = 'duplicate',
    'a redelivered superseded lift is not a duplicate');
  SELECT * INTO v FROM piggyvest_primary.wallet_restrictions WHERE provider_wallet_id = 'wr-d';
  PERFORM pg_temp.check(v.lift_event_id = 'evt-d-lift-2' AND v.lifted_at = '2026-10-01T14:00:00Z'
    AND pg_temp.rows('wr-d') = 1, 'the latest lift by provider time is not the one kept');
END $$;

-- Re-placement: a creation dated after the kept lift places a lifted
-- restriction again, so it blocks until a later lift. Without such a time a
-- new creation event cannot be told apart from a redelivery, so it is a
-- conflict for review, never a silent duplicate.
DO $$
DECLARE v piggyvest_primary.wallet_restrictions%ROWTYPE;
BEGIN
  PERFORM pg_temp.rec('wr-r', 'evt-r-create-1', 'rst-r', 'Freeze');
  PERFORM pg_temp.lift('wr-r', 'evt-r-lift-1', 'rst-r', 'Freeze', '2026-10-01T12:00:00Z');
  PERFORM pg_temp.check(
    pg_temp.rec('wr-r', 'evt-r-create-2', 'rst-r', 'Freeze', '2026-10-01T11:00:00Z') = 'conflict',
    'a new creation dated before the kept lift is not a conflict');
  PERFORM pg_temp.check(NOT pg_temp.blocked('wr-r'), 'a creation dated before the lift re-blocked');
  PERFORM pg_temp.check(
    pg_temp.rec('wr-r', 'evt-r-create-3', 'rst-r', 'Freeze', '2026-10-01T13:00:00Z') = 'recorded',
    'a creation dated after the kept lift is not recorded as a new placement');
  PERFORM pg_temp.check(pg_temp.blocked('wr-r') AND pg_temp.rows('wr-r') = 1,
    'a re-placement after a lift does not block');
  SELECT * INTO v FROM piggyvest_primary.wallet_restrictions WHERE provider_wallet_id = 'wr-r';
  PERFORM pg_temp.check(v.provider_event_id = 'evt-r-create-3' AND v.occurred_at = '2026-10-01T13:00:00Z'
    AND v.lift_event_id = 'evt-r-lift-1', 'the re-placement is not the placement kept');
  PERFORM pg_temp.check(
    pg_temp.rec('wr-r', 'evt-r-create-3', 'rst-r', 'Freeze', '2026-10-01T13:00:00Z') = 'duplicate'
    AND pg_temp.rec('wr-r', 'evt-r-create-1', 'rst-r', 'Freeze') = 'duplicate'
    AND pg_temp.lift('wr-r', 'evt-r-lift-1', 'rst-r', 'Freeze', '2026-10-01T12:00:00Z') = 'duplicate',
    'a redelivery after a re-placement is not a duplicate');
  PERFORM pg_temp.check(
    pg_temp.lift('wr-r', 'evt-r-lift-2', 'rst-r', 'Freeze', '2026-10-01T12:30:00Z') = 'stale',
    'a lift dated before the re-placement is not stale');
  PERFORM pg_temp.check(pg_temp.blocked('wr-r'), 'a redelivery or older lift ended the re-placement');
  PERFORM pg_temp.check(
    pg_temp.lift('wr-r', 'evt-r-lift-3', 'rst-r', 'Freeze', '2026-10-01T14:00:00Z') = 'lifted'
    AND NOT pg_temp.blocked('wr-r'), 'a lift dated after the re-placement did not lift it');
  PERFORM pg_temp.check(
    pg_temp.rec('wr-r', 'evt-r-create-4', 'rst-r', 'Lien', '2026-10-01T15:00:00Z') = 'recorded'
    AND pg_temp.kinds('wr-r') = '{lien}'::text[], 'a later re-placement of another kind does not block');
END $$;

-- A lift naming another kind than its restriction is inconsistent provider
-- data: a conflict for review that changes nothing, in either arrival order.
DO $$
DECLARE v_before text;
BEGIN
  PERFORM pg_temp.rec('wr-k', 'evt-k-create', 'rst-k', 'Lien');
  v_before := pg_temp.snapshot('wr-k', 'rst-k');
  PERFORM pg_temp.check(
    pg_temp.lift('wr-k', 'evt-k-lift-1', 'rst-k', 'Freeze', '2026-10-01T12:00:00Z') = 'conflict'
    AND pg_temp.lift('wr-k', 'evt-k-lift-2', 'rst-k', NULL, '2026-10-01T12:00:00Z') = 'conflict',
    'a lift naming another kind is not a conflict');
  PERFORM pg_temp.check(pg_temp.blocked('wr-k') AND pg_temp.snapshot('wr-k', 'rst-k') = v_before
    AND pg_temp.events('wr-k') = 1, 'a lift naming another kind changed the restriction');
  PERFORM pg_temp.check(
    pg_temp.lift('wr-k', 'evt-k-lift-3', 'rst-k', ' LIEN', '2026-10-01T12:00:00Z') = 'lifted'
    AND NOT pg_temp.blocked('wr-k'), 'a lift naming the same kind did not lift');

  PERFORM pg_temp.lift('wr-l', 'evt-l-lift', 'rst-l', 'Freeze', '2026-10-01T12:00:00Z');
  PERFORM pg_temp.check(
    pg_temp.lift('wr-l', 'evt-l-lift-2', 'rst-l', 'Lien', '2026-10-01T13:00:00Z') = 'conflict',
    'a second early lift naming another kind is not a conflict');
  PERFORM pg_temp.check(pg_temp.rec('wr-l', 'evt-l-create', 'rst-l', 'Lien') = 'conflict',
    'a creation of another kind than its early lift is not a conflict');
  PERFORM pg_temp.check(
    (SELECT provider_event_id IS NULL AND lift_event_id = 'evt-l-lift'
     FROM piggyvest_primary.wallet_restrictions WHERE provider_wallet_id = 'wr-l'),
    'a conflicting creation or lift changed the early lift');
  PERFORM pg_temp.check(
    pg_temp.rec('wr-l', 'evt-l-create-2', 'rst-l', 'Lien', '2026-10-01T13:00:00Z') = 'recorded'
    AND pg_temp.blocked('wr-l'), 'a creation dated after an early lift of another kind does not block');
END $$;

-- An unknown kind is recorded and blocks; kinds are matched case-insensitively.
DO $$
DECLARE v piggyvest_primary.wallet_restrictions%ROWTYPE;
BEGIN
  PERFORM pg_temp.check(pg_temp.rec('wr-e', 'evt-e-1', 'rst-e1', 'Garnishee') = 'recorded',
    'an unknown property is not recorded');
  SELECT * INTO v FROM piggyvest_primary.wallet_restrictions WHERE provider_event_id = 'evt-e-1';
  PERFORM pg_temp.check(v.kind = 'unknown' AND v.provider_kind = 'Garnishee',
    'an unknown property is not stored as unknown with its provider text');
  PERFORM pg_temp.check(pg_temp.blocked('wr-e') AND pg_temp.kinds('wr-e') = '{unknown}'::text[],
    'an unknown kind does not block');
  PERFORM pg_temp.check(pg_temp.rec('wr-e', 'evt-e-2', 'rst-e2', NULL) = 'recorded',
    'a missing property is not recorded');
  PERFORM pg_temp.check(
    (SELECT kind = 'unknown' AND provider_kind IS NULL FROM piggyvest_primary.wallet_restrictions
     WHERE provider_event_id = 'evt-e-2'), 'a missing property is not unknown');
  PERFORM pg_temp.check(pg_temp.rec('wr-e', 'evt-e-3', 'rst-e3', '  FREEZE ') = 'recorded',
    'a padded upper-case Freeze is not recorded');
  PERFORM pg_temp.check(pg_temp.kinds('wr-e') = '{freeze,unknown}'::text[]
    AND pg_temp.active('wr-e') = 3, 'kinds are not normalised or counted');
  PERFORM pg_temp.check(pg_temp.rec('wr-e', 'evt-e-4', 'rst-e4', repeat('x', 300)) = 'recorded',
    'an over-long property is not recorded');
  PERFORM pg_temp.check(
    (SELECT kind = 'unknown' AND char_length(provider_kind) = 100
     FROM piggyvest_primary.wallet_restrictions WHERE provider_event_id = 'evt-e-4'),
    'an over-long property is not kept as unknown with bounded provider text');
  PERFORM pg_temp.check(
    pg_temp.lift('wr-e', 'evt-e-lift-1', 'rst-e1', 'Garnishee', '2026-10-01T12:00:00Z') = 'lifted',
    'an unknown-kind restriction cannot be lifted by its own id');
  PERFORM pg_temp.check(pg_temp.blocked('wr-e') AND pg_temp.active('wr-e') = 3,
    'lifting one restriction ended the others');
END $$;

-- A creation without a provider restriction id is recorded and blocks.
DO $$ BEGIN
  PERFORM pg_temp.check(pg_temp.rec('wr-f', 'evt-f-1', NULL, 'Lien') = 'recorded',
    'a creation without a restriction id is not recorded');
  PERFORM pg_temp.check(pg_temp.rec('wr-f', 'evt-f-1', NULL, 'Lien') = 'duplicate',
    'a redelivered creation without a restriction id is not a duplicate');
  PERFORM pg_temp.check(pg_temp.rec('wr-f', 'evt-f-2', NULL, 'Lien') = 'recorded',
    'a second creation without a restriction id is not its own row');
  PERFORM pg_temp.check(pg_temp.blocked('wr-f') AND pg_temp.active('wr-f') = 2
    AND pg_temp.rows('wr-f') = 2, 'creations without a restriction id do not block');
END $$;

-- A lift is scoped to its wallet, and event ids never switch role.
DO $$ BEGIN
  PERFORM pg_temp.rec('wr-g', 'evt-g-create', 'rst-g', 'Lien');
  PERFORM pg_temp.check(
    pg_temp.lift('wr-h', 'evt-h-lift', 'rst-g', 'Lien', '2026-10-01T12:00:00Z') = 'lifted',
    'a lift for another wallet is not stored on that wallet');
  PERFORM pg_temp.check(pg_temp.blocked('wr-g'), 'a lift for another wallet unblocked this one');
  PERFORM pg_temp.check(NOT pg_temp.blocked('wr-h') AND pg_temp.rows('wr-h') = 1,
    'a lift-only row blocks its wallet');
  PERFORM pg_temp.check(
    pg_temp.lift('wr-g', 'evt-g-create', 'rst-g', 'Lien', '2026-10-01T12:00:00Z') = 'conflict',
    'a creation event id reused as a lift is not a conflict');
  PERFORM pg_temp.check(pg_temp.rec('wr-g', 'evt-h-lift', 'rst-g2', 'Lien') = 'conflict',
    'a lift event id reused as a creation is not a conflict');
  PERFORM pg_temp.check(pg_temp.blocked('wr-g') AND pg_temp.rows('wr-g') = 1,
    'a conflicting event changed the wallet');
END $$;

-- Malformed identities are refused, never stored.
DO $$ BEGIN
  PERFORM pg_temp.rejects($sql$SELECT pg_temp.rec(NULL, 'evt-x', 'rst-x', 'Lien')$sql$, 'a NULL wallet');
  PERFORM pg_temp.rejects($sql$SELECT pg_temp.rec('', 'evt-x', 'rst-x', 'Lien')$sql$, 'an empty wallet');
  PERFORM pg_temp.rejects($sql$SELECT pg_temp.rec(repeat('w', 513), 'evt-x', 'rst-x', 'Lien')$sql$,
    'an over-long wallet');
  PERFORM pg_temp.rejects($sql$SELECT pg_temp.rec('wr-x', NULL, 'rst-x', 'Lien')$sql$, 'a NULL creation event');
  PERFORM pg_temp.rejects($sql$SELECT pg_temp.rec('wr-x', 'evt-x', '', 'Lien')$sql$, 'an empty restriction id');
  PERFORM pg_temp.rejects($sql$SELECT pg_temp.lift('wr-x', NULL, 'rst-x', 'Lien', '2026-10-01T12:00:00Z')$sql$,
    'a NULL lift event');
  PERFORM pg_temp.rejects($sql$SELECT pg_temp.lift('wr-x', 'evt-x', NULL, 'Lien', '2026-10-01T12:00:00Z')$sql$,
    'a lift without a restriction id');
  PERFORM pg_temp.rejects($sql$SELECT pg_temp.lift('wr-x', 'evt-x', 'rst-x', 'Lien', NULL)$sql$,
    'a lift without a provider time');
  PERFORM pg_temp.rejects($sql$SELECT * FROM piggyvest_primary.wallet_restriction_state(NULL)$sql$,
    'a state read without a wallet');
  PERFORM pg_temp.check(pg_temp.rows('wr-x') = 0 AND pg_temp.rows('') = 0,
    'a refused call stored a row');
END $$;

ROLLBACK;
