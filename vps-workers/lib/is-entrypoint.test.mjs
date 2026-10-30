import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isEntrypoint } from './is-entrypoint.mjs';

const workerRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test('treats a module invoked through a symlinked directory as the entrypoint', () => {
  const real = mkdtempSync(join(tmpdir(), 'baci-entry-real-'));
  const linked = join(mkdtempSync(join(tmpdir(), 'baci-entry-link-')), 'jobs');
  symlinkSync(real, linked);
  const file = join(real, 'job.mjs');
  writeFileSync(file, '');

  assert.equal(
    isEntrypoint(pathToFileURL(file).href, join(linked, 'job.mjs')),
    true
  );
  assert.equal(
    isEntrypoint(pathToFileURL(file).href, join(real, 'other.mjs')),
    false
  );
  assert.equal(isEntrypoint(pathToFileURL(file).href, undefined), false);
});

test('bugfix: a worker job launched through the release symlink still runs its main', () => {
  const linkedRoot = join(
    mkdtempSync(join(tmpdir(), 'baci-workers-')),
    'baci-workers'
  );
  symlinkSync(workerRoot, linkedRoot);

  // Without arguments run-web-cron prints its usage and fails; before the fix
  // the symlinked launch skipped main and exited 0 silently.
  const result = spawnSync(
    process.execPath,
    [join(linkedRoot, 'jobs/run-web-cron.mjs')],
    {
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    }
  );

  assert.notEqual(result.status, 0);
  assert.notEqual(`${result.stdout}${result.stderr}`.trim(), '');
});
