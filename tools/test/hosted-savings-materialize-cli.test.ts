import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('CLI refuses execution and external destinations', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      createRequire(import.meta.url).resolve('tsx'),
      fileURLToPath(
        new URL('./hosted-savings-materialize-cli.ts', import.meta.url)
      ),
      '--materialize-only',
      'postgres://remote/db',
    ],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /no SQL executed/);
});
