import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('checked-in Android build preserves the Sentry source-map hook', () => {
  const gradle = readFileSync(
    new URL('../android/app/build.gradle', import.meta.url),
    'utf8'
  );
  assert.match(
    gradle,
    /require\.resolve\('@sentry\/react-native\/package\.json'\)/
  );
  assert.match(gradle, /"sentry\.gradle\.kts"/);
});
