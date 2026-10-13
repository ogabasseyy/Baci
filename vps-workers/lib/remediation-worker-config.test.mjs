import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  readPositiveInt,
  statePathForMode,
} from './remediation-worker-config.mjs';

it('normalizes positive integers and mode-scoped state paths', () => {
  assert.equal(readPositiveInt('2', 1), 2);
  assert.equal(readPositiveInt('-1', 1), 1);
  assert.equal(
    statePathForMode('/tmp/state.json', 'autofix'),
    '/tmp/state.autofix.json'
  );
});
