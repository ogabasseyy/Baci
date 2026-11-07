import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(workerRoot, '..');
const wrapper = join(
  workerRoot,
  'bin',
  'process-piggyvest-webhook-capture-drain.sh'
);
const script = 'src/scripts/piggyvest-webhook-capture-drain-cli.ts';

function cronLines() {
  return readFileSync(join(workerRoot, 'deploy.sh'), 'utf8')
    .split('\n')
    .filter((line) => line.includes('piggyvest-webhook-capture-drain'));
}

describe('PiggyVest webhook capture drain schedule', () => {
  it('runs every minute under its own lock, bounded by a timeout, once per tick', () => {
    const lines = cronLines();
    assert.equal(lines.length, 1);
    assert.match(
      lines[0],
      /^\* \* \* \* \* flock -n \$REMOTE_DIR\/locks\/piggyvest-webhook-capture-drain\.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=piggyvest-webhook-capture-drain && cd \$REMOTE_DIR && timeout --verbose --signal=TERM --kill-after=10s 50s \$REMOTE_DIR\/bin\/process-piggyvest-webhook-capture-drain\.sh --once' >> \$REMOTE_DIR\/logs\/piggyvest-webhook-capture-drain\.log 2>&1$/
    );
  });

  it('sits inside the worker schedule block the release renders', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');
    const block = deployScript.slice(
      deployScript.indexOf('$CRON_BLOCK_START\n'),
      deployScript.indexOf('$CRON_BLOCK_END\n')
    );
    assert.ok(
      block.includes('process-piggyvest-webhook-capture-drain.sh --once')
    );
    // The release refuses a schedule with variables it cannot resolve.
    const variables = cronLines()[0].match(/\$\{?[A-Z_]+/g) ?? [];
    assert.deepEqual([...new Set(variables)], ['$REMOTE_DIR']);
  });

  it('never carries a credential, a web cron hop or a URL', () => {
    assert.doesNotMatch(
      cronLines()[0],
      /PASSWORD|SECRET|SERVICE_ROLE|CRON_SECRET|run-web-cron|https?:\/\//
    );
  });
});

describe('process-piggyvest-webhook-capture-drain.sh', () => {
  it('logs a timeout exit explicitly without starting a real worker', () => {
    const root = mkdtempSync(join(tmpdir(), 'capture-wrapper-'));
    try {
      const copy = join(root, 'capture.sh');
      writeFileSync(copy, readFileSync(wrapper, 'utf8'));
      writeFileSync(
        join(root, 'run-web-script.sh'),
        '#!/usr/bin/env bash\nexit 124\n',
        { mode: 0o700 }
      );
      const result = spawnSync('bash', [copy, '--once'], {
        encoding: 'utf8',
        timeout: 5000,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      });
      assert.equal(result.status, 124);
      assert.match(
        result.stderr,
        /pass timed out; any active lease will be reclaimed/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('is an executable wrapper that delegates straight to its web script', () => {
    assert.ok(statSync(wrapper).mode & 0o111, 'wrapper must be executable');
    const source = readFileSync(wrapper, 'utf8');
    assert.match(source, /set -euo pipefail/);
    assert.match(
      source,
      /run-web-script\.sh" piggyvest-webhook-capture-drain src\/scripts\/piggyvest-webhook-capture-drain-cli\.ts/
    );
    assert.match(
      source,
      /BACI_WORKER_PROFILE="\$\{BACI_WORKER_PROFILE:-piggyvest-webhook-capture-drain\}"/
    );
    assert.doesNotMatch(source, /PASSWORD|SECRET|SERVICE_ROLE|https?:\/\//);
    assert.ok(existsSync(join(repoRoot, 'apps', 'web', script)));
  });

  it('rejects anything but one known mode before starting the runtime', () => {
    for (const args of [
      ['--loop'],
      ['--once', '--readiness'],
      ['--plan', 'x'],
    ]) {
      const result = spawnSync('bash', [wrapper, ...args], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      });
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /Usage: process-piggyvest-webhook-capture-drain\.sh/
      );
    }
  });
});
