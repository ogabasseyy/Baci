import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const podfile = readFileSync(join(root, 'Podfile'), 'utf8');

/** Mirrors the committed Podfile assignment order for EXPO_USE_PRECOMPILED_MODULES. */
function applyCurrentPrecedence(envValue, propertyValue) {
  const env = { EXPO_USE_PRECOMPILED_MODULES: envValue };
  if (propertyValue === 'false') {
    env.EXPO_USE_PRECOMPILED_MODULES = '0';
  }
  env.EXPO_USE_PRECOMPILED_MODULES ??= '1';
  return env.EXPO_USE_PRECOMPILED_MODULES;
}

/** Previous buggy ordering from this PR's base. */
function applyPreviousPrecedence(envValue, propertyValue) {
  const env = { EXPO_USE_PRECOMPILED_MODULES: envValue };
  if (propertyValue !== 'false') {
    env.EXPO_USE_PRECOMPILED_MODULES ??= '1';
  }
  return env.EXPO_USE_PRECOMPILED_MODULES;
}

test('Podfile forces EXPO_USE_PRECOMPILED_MODULES off before the default', () => {
  const disableIdx = podfile.indexOf(
    "ENV['EXPO_USE_PRECOMPILED_MODULES'] = '0' if podfile_properties['EXPO_USE_PRECOMPILED_MODULES'] == 'false'"
  );
  const defaultIdx = podfile.indexOf(
    "ENV['EXPO_USE_PRECOMPILED_MODULES'] ||= '1'"
  );
  assert.notEqual(disableIdx, -1);
  assert.notEqual(defaultIdx, -1);
  assert.ok(disableIdx < defaultIdx);
});

test('bugfix: property false overrides a pre-set ENV of 1', () => {
  assert.equal(applyPreviousPrecedence('1', 'false'), '1');
  assert.equal(applyCurrentPrecedence('1', 'false'), '0');
});
