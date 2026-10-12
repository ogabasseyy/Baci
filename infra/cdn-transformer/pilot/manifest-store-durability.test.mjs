import assert from 'node:assert/strict';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { commitGeneration, loadGeneration } from './manifest-store.mjs';
import { commitFixture } from './manifest-store-fixtures.mjs';

test('commitGeneration aborts on genuine pre-commit fsync errors', async () => {
  const fixture = await commitFixture('pilot-r1-syncfail');
  // ENOSPC surfacing at fsync time is a storage failure, not an
  // unsupported filesystem: refuse to publish.
  await assert.rejects(
    () =>
      commitGeneration({
        deps: {
          fsyncFile: () =>
            Promise.reject(
              Object.assign(new Error('no space'), { code: 'ENOSPC' })
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
      error.code === 'sync-failed' && /refusing to publish/.test(error.message)
  );
  await assert.rejects(
    () => loadGeneration(fixture.root, fixture.generationId),
    /not published/
  );
});

test('commitGeneration unpublishes on post-commit directory fsync errors', async () => {
  const fixture = await commitFixture('pilot-r1-syncfaildir');
  // Only the post-rename generations-dir fsync fails: the rename is
  // already visible, so the commit must remove it before reporting
  // failed — never failed-but-published.
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
        },
        files: fixture.files,
        generationId: fixture.generationId,
        job: fixture.job,
        manifest: fixture.manifest,
        outputRoot: fixture.root,
        stagingDir: fixture.stagingDir,
      }),
    (error) => error.code === 'sync-failed' && /unpublished/.test(error.message)
  );
  await assert.rejects(
    () => loadGeneration(fixture.root, fixture.generationId),
    /not published/
  );
});

test('commitGeneration rejects a swapped-in giant staged tier on size', async () => {
  const fixture = await commitFixture('pilot-r1-giant-tier');
  // The staged file dwarfs its manifest claim: the commit must reject
  // on the claim+1 truncation probe instead of loading the whole file
  // ahead of the length comparison.
  await writeFile(fixture.files[0].from, Buffer.alloc(2 * 1024 * 1024, 9));
  await assert.rejects(
    () =>
      commitGeneration({
        files: fixture.files,
        generationId: fixture.generationId,
        job: fixture.job,
        manifest: fixture.manifest,
        outputRoot: fixture.root,
        stagingDir: fixture.stagingDir,
      }),
    (error) =>
      error.code === 'staged-file-mismatch' &&
      /staged bytes differ/.test(error.message)
  );
  await assert.rejects(
    () => loadGeneration(fixture.root, fixture.generationId),
    /not published/
  );
});

test('commitGeneration re-verifies tiers inside commitDir before publishing', async () => {
  const fixture = await commitFixture('pilot-r1-commit-recheck');
  const { rename: realRename } = await import('node:fs/promises');
  // A staged tier replaced AFTER the pre-move hash check: the injected
  // rename plants same-length foreign bytes at the commit destination,
  // proving the pre-publish recheck compares hashes, not just lengths.
  const commitDir = join(fixture.stagingDir, 'commit');
  let tampered = false;
  const swappingRename = async (from, to) => {
    await realRename(from, to);
    if (from !== commitDir && !tampered) {
      tampered = true;
      const size = (await stat(to)).size;
      await writeFile(to, Buffer.alloc(size, 7));
    }
  };
  await assert.rejects(
    () =>
      commitGeneration({
        deps: { rename: swappingRename },
        files: fixture.files,
        generationId: fixture.generationId,
        job: fixture.job,
        manifest: fixture.manifest,
        outputRoot: fixture.root,
        stagingDir: fixture.stagingDir,
      }),
    (error) =>
      error.code === 'commit-bytes-mismatch' &&
      /commit bytes differ/.test(error.message)
  );
  assert.equal(tampered, true);
  await assert.rejects(
    () => loadGeneration(fixture.root, fixture.generationId),
    /not published/
  );
});

