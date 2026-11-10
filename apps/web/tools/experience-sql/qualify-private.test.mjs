import assert from 'node:assert/strict';
import test from 'node:test';
import { privateQualificationCommands } from './commands.mjs';
import { qualifyPrivateExperience } from './qualify-private.mjs';

test('importing qualification does not provision infrastructure and the plan always includes OS browser tests', () => {
  assert.equal(typeof qualifyPrivateExperience, 'function');
  assert.ok(
    privateQualificationCommands().some(([, args]) =>
      args.includes('playwright')
    )
  );
});
