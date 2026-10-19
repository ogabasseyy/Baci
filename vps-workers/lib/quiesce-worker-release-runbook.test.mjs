import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Split from quiesce-worker-release.test.mjs (at the 300-line limit):
// emergency-rollback runbook pins live here.
const directory = dirname(fileURLToPath(import.meta.url));

test('emergency rollback aborts when the quiesce helper is absent', () => {
  // Without the helper, unrelated cron ticks and persistent services
  // keep running while the rollback rsyncs replace the shared trees
  // — the mixed-release state the rollback exists to repair. The
  // runbook must abort with a restore directive, never warn and
  // continue with reduced locking.
  const runbook = readFileSync(
    join(directory, '..', 'docs', 'gigl-tracking-cutover-runbook.md'),
    'utf8'
  );
  assert.match(
    runbook,
    /quiesce helper missing; refusing to restore shared trees/
  );
  assert.doesNotMatch(runbook, /continuing with deploy\+GIGL locks only/);
});
