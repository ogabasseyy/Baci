import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workers = join(dirname(fileURLToPath(import.meta.url)), '..');
const release = readFileSync(
  join(workers, 'release/worker-release.sh'),
  'utf8'
);
const render = release.match(/render_crontab\(\) \{[\s\S]*?\n\}/)?.[0];
const remediationJobs = release.match(/^REMEDIATION_JOBS='([^']+)'$/m)?.[1];
assert.ok(render, 'the production render_crontab function must exist');
assert.ok(remediationJobs, 'use the production remediation filter');

test('actual release renderer accepts the checked-in drain schedule without executing it', () => {
  const root = mkdtempSync(join(tmpdir(), 'capture-cron-render-'));
  try {
    const target = join(root, 'proof/workers');
    mkdirSync(target, { recursive: true });
    const deploy = join(target, 'deploy.sh');
    copyFileSync(join(workers, 'deploy.sh'), deploy);
    const script = join(root, 'render.sh');
    writeFileSync(
      script,
      `set -euo pipefail\n${render}\nrender_crontab proof\n`,
      { mode: 0o600 }
    );
    const run = () =>
      spawnSync('bash', [script], {
        encoding: 'utf8',
        timeout: 5000,
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          RELEASES: root,
          WORKERS: '/srv/qa-workers',
          NODE_BIN: '/usr/bin/node',
          CRON_BLOCK_START: '# BEGIN BACI WORKERS',
          CRON_BLOCK_END: '# END BACI WORKERS',
          REMEDIATION_JOBS: remediationJobs,
        },
      });
    const valid = run();
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(
      valid.stdout,
      /flock -n \/srv\/qa-workers\/locks\/piggyvest-webhook-capture-drain\.lock/
    );
    assert.match(
      valid.stdout,
      /timeout --verbose --signal=TERM --kill-after=10s 50s \/srv\/qa-workers\/bin\/process-piggyvest-webhook-capture-drain\.sh --once/
    );
    assert.doesNotMatch(valid.stdout, /\$[A-Z{]/);
    // Reproduce the rejected command-substitution regression in a fixture;
    // the renderer must reject it, never evaluate shell from the template.
    writeFileSync(
      deploy,
      readFileSync(deploy, 'utf8').replace(
        /^\* \* \* \* \*.*piggyvest-webhook-capture-drain.*$/m,
        '$(bash "$WORKER_ROOT/lib/untrusted.sh" "$REMOTE_DIR")'
      )
    );
    const invalid = run();
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /unresolved variables/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
