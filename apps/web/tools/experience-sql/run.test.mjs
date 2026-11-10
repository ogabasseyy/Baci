import assert from 'node:assert/strict';
import test from 'node:test';
import { runSqlQualification } from './run.mjs';

test('importing the runner cannot start a database; invalid suite fails before spawning', () => {
  assert.equal(typeof runSqlQualification, 'function');
  assert.throws(() => runSqlQualification(['--arbitrary-command']));
});
