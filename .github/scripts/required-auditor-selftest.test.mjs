import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the required quality gate depends on the complete auditor selftest workflow', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const selftest = readFileSync(
    '.github/workflows/muse-review-selftest.yml',
    'utf8'
  );
  assert.match(selftest, /\n  workflow_call:\s*\n/);
  assert.match(
    selftest,
    /shard: \[muse-review, filter, hard-1, hard-2, hard-3, hard-4, static\]/
  );
  const selftestJob = selftest.slice(
    selftest.indexOf('\n  selftest:\n'),
    selftest.indexOf('\n  pin-freshness:\n')
  );
  assert.doesNotMatch(selftestJob, /^    if:/m);
  assert.match(
    ci,
    /quality-auditor-selftest:\s*\n\s+uses: \.\/\.github\/workflows\/muse-review-selftest\.yml/
  );
  const quality = ci.slice(
    ci.indexOf('\n  quality:\n'),
    ci.indexOf('\n  mobile-quality:\n')
  );
  assert.match(quality, /needs: \[[^\n]*quality-auditor-selftest/);
  assert.match(
    quality,
    /AUDITOR_SELFTEST_RESULT: \$\{\{ needs\['quality-auditor-selftest'\]\.result \}\}/
  );
  assert.match(quality, /\[\[ "\$AUDITOR_SELFTEST_RESULT" != "success" \]\]/);
});

test('the aggregator fails closed when the auditor is skipped, cancelled, or fails', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const match = ci.match(
    /if \[\[ "\$AUDITOR_SELFTEST_RESULT" != "success" \]\]; then\n([\s\S]*?)\n\s*fi/
  );
  assert.ok(match, 'auditor guard must be present');
  for (const status of ['failure', 'cancelled', 'skipped', '']) {
    const result = spawnSync('bash', ['-c', match[0]], {
      env: { ...process.env, AUDITOR_SELFTEST_RESULT: status },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, status);
  }
  assert.equal(
    spawnSync('bash', ['-c', match[0]], {
      env: { ...process.env, AUDITOR_SELFTEST_RESULT: 'success' },
    }).status,
    0
  );
});
