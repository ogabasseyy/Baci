import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

test('GIGL worker chain and its probes select the worker CI suite', () => {
  const filters = parse(
    readFileSync(
      new URL('../../.github/filters/ci.yml', import.meta.url),
      'utf8'
    )
  );
  for (const path of [
    'tools/test/gigl-flock-linux-probe.py',
    'tools/test/gigl-lock-exec.test.py',
    'tools/test/gigl-worker-launch-linux-probe.py',
    'apps/web/src/lib/shipping/providers/gigl-cache-lock-verification.ts',
    'apps/web/src/lib/shipping/providers/gigl-tracking-token-cache.ts',
    'apps/web/src/lib/shipping/providers/gigl-tracking-cache-crypto.ts',
    'apps/web/src/lib/shipping/providers/gigl-tracking-cache-runner.ts',
    'apps/web/src/schemas/gigl-tracking-token-cache.ts',
    'apps/web/src/scripts/process-gigl-tracking.ts',
  ])
    assert.ok(
      filters.deploy_scripts.includes(path),
      `${path} must select worker CI`
    );
});
