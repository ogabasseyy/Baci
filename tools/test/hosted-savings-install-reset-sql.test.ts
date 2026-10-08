import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildHostedSavingsResetSql } from './hosted-savings-install-reset-sql';

const baseline = readFileSync(new URL('../../supabase/migrations/20260418000000_baseline.sql', import.meta.url), 'utf8');

test('defaults to rollback and orders protection checks before transaction completion', () => {
  const sql = buildHostedSavingsResetSql(baseline, null);
  assert.match(sql, /^BEGIN;/);
  assert.doesNotMatch(sql, /^COMMIT;/m);
  const phases = ['CREATE TEMP TABLE recovery_before', 'CREATE EVENT TRIGGER hosted_savings_reset_drop_guard', 'DROP TABLE public.orders CASCADE;', 'CREATE TEMP TABLE recovery_after', "ERRCODE='P7233'", 'END $preserve$;', 'ROLLBACK;', 'reset-rehearsed-rolled-back'];
  let previous = -1;
  for (const phase of phases) {
    const position = sql.indexOf(phase);
    assert.ok(position > previous, `Missing or unordered phase: ${phase}`);
    previous = position;
  }
  assert.match(sql, /IS DISTINCT FROM NULL/);
  assert.match(sql, /session_replication_role'\)<>'origin'/);
  assert.equal(sql.match(/Event triggers require review/g)?.length, 2);
});

test('renders commit only by explicit request and escapes comment quotes', () => {
  const sql = buildHostedSavingsResetSql(baseline, "owner's synthetic comment", true);
  assert.match(sql, /IS DISTINCT FROM 'owner''s synthetic comment'/);
  assert.equal(sql.match(/^COMMIT;/gm)?.length, 1);
  assert.doesNotMatch(sql, /^ROLLBACK;/m);
  assert.match(sql, /'reset-committed'/);
});

test('refuses unreviewed baseline before rendering SQL', () => {
  assert.throws(() => buildHostedSavingsResetSql('SELECT 1;', null), /exact reviewed baseline/);
});
