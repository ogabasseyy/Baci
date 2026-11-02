import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkRun,
  loadRawConfig,
  passingChecks,
} from './money-pr-assurance.test-support.mjs';
import { evaluateRequiredChecks } from './money-pr-assurance-checks.mjs';
import { parseAssuranceConfig } from './money-pr-assurance-config.mjs';

const { requiredChecks } = parseAssuranceConfig(loadRawConfig());
const codeOnly = ['apps/web/src/lib/piggyvest/transfer.ts'];
const withMigration = [
  ...codeOnly,
  'supabase/migrations/20261101000000_piggyvest_engine.sql',
];

function run(checkRuns, changedPaths = withMigration) {
  return evaluateRequiredChecks({ checkRuns, requiredChecks, changedPaths });
}

test('all required checks green passes', () => {
  assert.deepEqual(run(passingChecks()), { failures: [], pending: [] });
});

test('a failed, cancelled or timed-out required check fails', () => {
  for (const conclusion of [
    'failure',
    'cancelled',
    'timed_out',
    'action_required',
    'stale',
  ]) {
    const result = run([
      checkRun('Quality Gate', 'success', 1),
      checkRun('Quality Gate - DB Replay', conclusion, 2),
      checkRun('Quality Gate - Disposable SQL Suites', 'success', 3),
    ]);
    assert.equal(result.failures.length, 1, conclusion);
    assert.match(result.failures[0], new RegExp(`DB Replay.*${conclusion}`));
  }
});

test('a missing or running required check is pending, not passed', () => {
  const result = run([checkRun('Quality Gate', null, 1)]);
  assert.deepEqual(result.failures, []);
  assert.equal(result.pending.length, 3);
});

test('skipped DB suites pass only when no database file changed', () => {
  const skipped = [
    checkRun('Quality Gate', 'success', 1),
    checkRun('Quality Gate - DB Replay', 'skipped', 2),
    checkRun('Quality Gate - Disposable SQL Suites', 'skipped', 3),
  ];
  assert.deepEqual(run(skipped, codeOnly), { failures: [], pending: [] });
  const result = run(skipped, withMigration);
  assert.equal(result.failures.length, 2);
  assert.match(result.failures[0], /skipped although database files changed/);
  // The aggregate quality gate can never be skipped.
  const gateSkipped = run(
    [checkRun('Quality Gate', 'skipped', 1), ...skipped.slice(1)],
    codeOnly
  );
  assert.equal(gateSkipped.failures.length, 1);
});

test('the newest run of a re-run check decides', () => {
  const rerun = [
    checkRun('Quality Gate', 'failure', 1),
    checkRun('Quality Gate', 'success', 9),
    checkRun('Quality Gate - DB Replay', 'success', 2),
    checkRun('Quality Gate - Disposable SQL Suites', 'success', 3),
  ];
  assert.deepEqual(run(rerun), { failures: [], pending: [] });
  const regressed = [rerun[1], { ...rerun[0], id: 10 }, rerun[2], rerun[3]];
  assert.equal(run(regressed).failures.length, 1);
});
