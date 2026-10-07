import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compilePublicLauncher } from './public-launcher.mjs';

test('packaged launcher carries its PostgreSQL dependencies outside the traced Next directory', async () => {
  const compiled = await compilePublicLauncher();
  assert.doesNotMatch(compiled, /require\(["']pg["']\)/);
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'baci-launcher-test-')
  );
  try {
    const filename = path.join(directory, 'launch-public.cjs');
    await writeFile(filename, compiled);
    const result = spawnSync(process.execPath, [filename, '--invalid'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(
      result.stderr,
      '{"status":"first-card-launch-refused","redacted":true}\n'
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
