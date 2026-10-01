import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const repoRoot = join(import.meta.dirname, '..', '..');
const deployScript = readFileSync(
  join(repoRoot, 'vps-workers', 'deploy.sh'),
  'utf8'
);
const releaseHelper = readFileSync(
  join(repoRoot, 'vps-workers', 'lib', 'prepare-worker-release.sh'),
  'utf8'
);

describe('GIGL direct worker cost contract', () => {
  it('does not schedule GIGL tracking through Vercel Cron', () => {
    const config = JSON.parse(
      readFileSync(join(repoRoot, 'vercel.json'), 'utf8')
    );
    const paths = config.crons.map((cron) => cron.path);

    assert.ok(!paths.includes('/api/cron/gigl-tracking'));
    assert.ok(paths.includes('/api/cron/gigl-tracking-notifications'));
  });

  it('treats Vercel configuration as a production deployment input', () => {
    const deployFilter = readFileSync(
      join(repoRoot, '.github', 'filters', 'deploy.yml'),
      'utf8'
    );

    assert.match(deployFilter, /^\s+- 'vercel\.json'\s*$/m);
  });

  it('treats Vercel configuration as a CI web input', () => {
    const ciFilter = readFileSync(
      join(repoRoot, '.github', 'filters', 'ci.yml'),
      'utf8'
    );

    assert.match(ciFilter, /^\s+- 'vercel\.json'\s*$/m);
  });

  it('schedules tracking directly every five minutes', () => {
    const cronLine = deployScript
      .split('\n')
      .find((line) => line.includes('gigl-tracking.lock'));

    assert.ok(cronLine);
    assert.match(
      cronLine,
      /^\*\/5 \*\s+\* \* \* flock -n \$REMOTE_DIR\/locks\/gigl-tracking\.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=gigl-tracking && cd \$REMOTE_DIR && timeout --signal=TERM --kill-after=30s 2m \$REMOTE_DIR\/bin\/process-gigl-tracking\.sh' >> \$REMOTE_DIR\/logs\/gigl-tracking\.log 2>&1$/
    );
    assert.doesNotMatch(cronLine, /run-web-cron|\/api\/cron\/gigl-tracking/);
  });

  it('keeps the privileged notification graph off the VPS', () => {
    const cronLine = deployScript
      .split('\n')
      .find((line) => line.includes('gigl-tracking-notifications.lock'));

    assert.equal(cronLine, undefined);
  });

  it('requires the direct scripts and wrappers in the exact-SHA release', () => {
    assert.match(
      releaseHelper,
      /apps\/web\/src\/scripts\/process-gigl-tracking\.ts/
    );
    assert.match(
      releaseHelper,
      /"\$remote_dir\/bin\/process-gigl-tracking\.sh"/
    );
    assert.match(
      releaseHelper,
      /verify-gigl-tracking-worker-capability\.sh/
    );
  });
});
