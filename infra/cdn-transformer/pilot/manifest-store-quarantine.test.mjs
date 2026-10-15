import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { commitGeneration, loadGeneration } from './manifest-store.mjs';
import { commitFixture } from './manifest-store-fixtures.mjs';

test('commitGeneration quarantines when unpublish removal fails', async () => {
  const fixture = await commitFixture('pilot-r1-quarantine');
  // Post-rename fsync fails AND the unpublish rm fails (read-only
  // directory): the rejected generation must move out of the
  // generations namespace so reuse can never validate it, and the
  // cleanup failure must surface instead of being swallowed.
  await assert.rejects(
    () =>
      commitGeneration({
        deps: {
          fsyncDir: (path) => {
            if (path.endsWith('generations')) {
              return Promise.reject(
                Object.assign(new Error('io error'), { code: 'EIO' })
              );
            }
            return Promise.resolve();
          },
          rm: () =>
            Promise.reject(
              Object.assign(new Error('denied'), { code: 'EACCES' })
            ),
        },
        files: fixture.files,
        generationId: fixture.generationId,
        job: fixture.job,
        manifest: fixture.manifest,
        outputRoot: fixture.root,
        stagingDir: fixture.stagingDir,
      }),
    (error) =>
      error.code === 'sync-failed' &&
      /removal failed \(EACCES\)/.test(error.message) &&
      /quarantined at/.test(error.message)
  );
  await assert.rejects(
    () => loadGeneration(fixture.root, fixture.generationId),
    /not published/
  );
  const entries = await readdir(fixture.root);
  assert.match(
    entries.join(','),
    new RegExp(`\\.quarantined-${fixture.generationId}-`)
  );
});

test('commitGeneration stays loud when quarantine also fails', async () => {
  const fixture = await commitFixture('pilot-r1-quarantine-fail');
  const { rename: fsRename } = await import('node:fs/promises');
  // Disk-level failure of rm, then of the quarantine rename: nothing
  // can move the rejected directory, so the error must name both
  // failures plus the visible path and its operator fix.
  await assert.rejects(
    () =>
      commitGeneration({
        deps: {
          fsyncDir: (path) => {
            if (path.endsWith('generations')) {
              return Promise.reject(
                Object.assign(new Error('io error'), { code: 'EIO' })
              );
            }
            return Promise.resolve();
          },
          rename: (from, to) => {
            if (String(to).includes('.quarantined-')) {
              return Promise.reject(
                Object.assign(new Error('no parent write'), {
                  code: 'EACCES',
                })
              );
            }
            return fsRename(from, to);
          },
          rm: () =>
            Promise.reject(
              Object.assign(new Error('denied'), { code: 'EACCES' })
            ),
        },
        files: fixture.files,
        generationId: fixture.generationId,
        job: fixture.job,
        manifest: fixture.manifest,
        outputRoot: fixture.root,
        stagingDir: fixture.stagingDir,
      }),
    (error) =>
      error.code === 'sync-failed' &&
      /removal failed \(EACCES\)/.test(error.message) &&
      /quarantine failed \(EACCES\)/.test(error.message) &&
      /remove it before retrying/.test(error.message)
  );
});

