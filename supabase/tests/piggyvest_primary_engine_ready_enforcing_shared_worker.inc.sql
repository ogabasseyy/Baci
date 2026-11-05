-- Part of piggyvest_primary_engine_ready_enforcing.sql (\ir): the bank worker
-- login shared by several integrations. Runs inside the entry file's
-- transaction; not a standalone suite.

-- 3b. Two integrations share the one worker login. The login's verdict must
-- hold for every binding it serves, so a healthy integration B can never make
-- the worker look ready while integration A's chain is broken (the worker
-- would claim deposits it cannot process).
SAVEPOINT bank_shared_login;
INSERT INTO piggyvest_primary.integrations(id, merchant_id, business_id, environment, executor_login, enabled)
VALUES (pg_temp.id(13), pg_temp.id(1), 'engine-ready-bank-b', 'staging', 'pv_er_bank_integration_b', true);
INSERT INTO piggyvest_primary.inflow_authorities(integration_id, executor_login, enabled)
VALUES (pg_temp.id(13), 'pv_er_bank_inflow_b', true);
INSERT INTO piggyvest_primary.bank_inbox_authorities(integration_id, merchant_id, business_id,
  environment, intake_login, worker_login, enabled, expires_at)
VALUES (pg_temp.id(13), pg_temp.id(1), 'engine-ready-bank-b', 'staging',
  'baci_primary_bank_intake', 'baci_primary_bank_worker', true, now() + interval '1 day');
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = '',
  'two fully bound integrations sharing the worker must be ready, got: '
  || pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker'));

SAVEPOINT shared_a_inflow_disabled;
UPDATE piggyvest_primary.inflow_authorities SET enabled = false WHERE integration_id = pg_temp.id(12);
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = 'inflow_authority_not_enabled',
  'integration B enabled must not make the worker ready while A has no enabled inflow authority');
ROLLBACK TO SAVEPOINT shared_a_inflow_disabled;

SAVEPOINT shared_a_inflow_absent;
DELETE FROM piggyvest_primary.inflow_authorities WHERE integration_id = pg_temp.id(12);
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = 'inflow_authority_not_enabled',
  'integration B enabled must not make the worker ready while A has no inflow authority');
ROLLBACK TO SAVEPOINT shared_a_inflow_absent;

SAVEPOINT shared_a_authority_disabled;
UPDATE piggyvest_primary.bank_inbox_authorities SET enabled = false WHERE integration_id = pg_temp.id(12);
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = 'bank_authority_not_enabled',
  'integration B enabled must not make the worker ready while A bank authority is disabled');
ROLLBACK TO SAVEPOINT shared_a_authority_disabled;

SAVEPOINT shared_a_integration_disabled;
UPDATE piggyvest_primary.integrations SET enabled = false WHERE id = pg_temp.id(12);
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = 'integration_not_enabled',
  'integration B enabled must not make the worker ready while A is disabled');
ROLLBACK TO SAVEPOINT shared_a_integration_disabled;

SAVEPOINT shared_a_mismatch;
UPDATE piggyvest_primary.bank_inbox_authorities SET business_id = 'engine-ready-other'
  WHERE integration_id = pg_temp.id(12);
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = 'bank_binding_mismatch',
  'integration B enabled must not make the worker ready while A binding disagrees');
ROLLBACK TO SAVEPOINT shared_a_mismatch;
-- Integration B failing while A stays healthy must also be not ready: every
-- binding of the shared login has to pass.
SAVEPOINT shared_b_inflow_disabled;
UPDATE piggyvest_primary.inflow_authorities SET enabled = false WHERE integration_id = pg_temp.id(13);
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = 'inflow_authority_not_enabled',
  'integration A enabled must not make the worker ready while B has no enabled inflow authority');
ROLLBACK TO SAVEPOINT shared_b_inflow_disabled;

SAVEPOINT shared_b_authority_disabled;
UPDATE piggyvest_primary.bank_inbox_authorities SET enabled = false WHERE integration_id = pg_temp.id(13);
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = 'bank_authority_not_enabled',
  'integration A enabled must not make the worker ready while B bank authority is disabled');
ROLLBACK TO SAVEPOINT shared_b_authority_disabled;

SAVEPOINT shared_b_integration_disabled;
UPDATE piggyvest_primary.integrations SET enabled = false WHERE id = pg_temp.id(13);
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = 'integration_not_enabled',
  'integration A enabled must not make the worker ready while B is disabled');
ROLLBACK TO SAVEPOINT shared_b_integration_disabled;
ROLLBACK TO SAVEPOINT bank_shared_login;
