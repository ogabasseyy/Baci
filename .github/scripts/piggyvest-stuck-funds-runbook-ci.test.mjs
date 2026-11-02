import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const lane = () =>
  read('../workflows/ci.yml').split('  quality-disposable-sql:')[1]?.split('  quality-misc:')[0] ?? '';
const databaseFilter = () =>
  read('../filters/ci.yml').split(/^quiz_db:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';

test('CI runs the PiggyVest stuck-funds runbook fixture suite on PostgreSQL 15+', () => {
  const text = lane();
  assert.match(text, /postgresql-16/);
  const step = text.split('- name: Test PiggyVest stuck-funds runbook SQL')[1]?.split('\n      - name:')[0] ?? '';
  assert.match(step, /PG_BIN: \/usr\/lib\/postgresql\/16\/bin/);
  assert.match(step, /python3 -I supabase\/tests\/run_piggyvest_stuck_funds_runbook\.py/);
  assert.doesNotMatch(step, /continue-on-error|\|\| true/);
});

test('runbook SQL and fixture changes trigger the database lane', () => {
  const filter = databaseFilter();
  assert.ok(filter.includes("'docs/runbooks/piggyvest-stuck-legacy-funds.sql'"));
  assert.ok(filter.includes("'supabase/tests/**'"));
  assert.ok(filter.includes("'supabase/migrations/**'"));
});

test('the runbook no longer says CI skips the fixture suite', () => {
  const doc = read('../../docs/runbooks/piggyvest-stuck-legacy-funds.md');
  assert.doesNotMatch(doc, /CI does not run it/);
});
