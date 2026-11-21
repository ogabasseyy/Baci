import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));

describe('prepare worker release checkout identity', () => {
  it('records the exact application SHA in the promoted worker release', () => {
    const script = readFileSync(
      join(directory, 'prepare-worker-release.sh'),
      'utf8'
    );

    assert.match(
      script,
      /printf '%s' '\$APP_SHA' > '\$STAGING_DIR\/app-checkout\.sha'/
    );
  });

  it('preserves the capability-smoke latch across worker promotes', () => {
    const script = readFileSync(
      join(directory, 'prepare-worker-release.sh'),
      'utf8'
    );

    assert.match(script, /--exclude='\.gigl-capability-smoke-ok'/);
  });
  it('preserves the token cache across worker promotions', () => {
    const script = readFileSync(
      join(directory, 'prepare-worker-release.sh'),
      'utf8'
    );
    const command = script.split('\n').find((line) => line.startsWith('rsync -a --delete --exclude='));
    assert.ok(command);
    const exclusions = [...command.matchAll(/--exclude='([^']+)'/g)].map((match) => `--exclude=${match[1]}`);
    const root = mkdtempSync(join(tmpdir(), 'baci-worker-promote-'));
    try {
      const staging = join(root, 'staging');
      const live = join(root, 'live');
      mkdirSync(staging);
      mkdirSync(join(live, 'gigl-tracking-token-cache'), { recursive: true });
      writeFileSync(join(live, 'gigl-tracking-token-cache', 'token.json'), 'synthetic');
      writeFileSync(join(live, 'obsolete'), 'remove');
      const result = spawnSync('rsync', ['-a', '--delete', ...exclusions, `${staging}/`, `${live}/`], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(existsSync(join(live, 'gigl-tracking-token-cache', 'token.json')));
      assert.equal(existsSync(join(live, 'obsolete')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
