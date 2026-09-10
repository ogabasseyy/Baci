import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const settingsGradle = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'settings.gradle'),
  'utf8'
);

test('settings.gradle includes reactNative composite build exactly once', () => {
  const matches = settingsGradle.match(
    /includeBuild\(expoAutolinking\.reactNative\)/g
  );
  assert.equal(matches?.length, 1);
});
