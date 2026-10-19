import assert from 'node:assert/strict';
import test from 'node:test';
import { createDisposablePostgres } from './postgres.mjs';

test('disposable SQL is socket-only, ignores inherited PG targets and survives restart', () => {
  const database = createDisposablePostgres();
  try {
    assert.equal(database.sql('SHOW listen_addresses'), '');
    assert.equal(database.sql('SELECT current_user'), 'supabase_admin');
    database.sql(
      'CREATE TABLE synthetic_restart (amount integer); INSERT INTO synthetic_restart VALUES (733);'
    );
    database.restart();
    assert.equal(database.sql('SELECT amount FROM synthetic_restart'), '733');
    assert.throws(
      () => database.sql('SELECT confidential_missing_function()'),
      /^Error: Disposable PostgreSQL psql failed; output withheld$/
    );
  } finally {
    database.close();
  }
});
