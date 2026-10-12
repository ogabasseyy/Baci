import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('CLI rejects remote destination arguments without starting replay', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      createRequire(import.meta.url).resolve('tsx'),
      fileURLToPath(
        new URL('./hosted-savings-bootstrap-cli.ts', import.meta.url)
      ),
      '--fresh-disposable-local',
      '--database-url=postgres://remote/db',
    ],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Bootstrap rejected or failed/);
  assert.equal(result.stdout, '');
});
