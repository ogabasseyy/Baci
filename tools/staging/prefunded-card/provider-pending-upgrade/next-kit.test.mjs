import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { prepareNextKit } from './next-kit.mjs';

test('prepares source and pinned packaging tooling without claiming an installable release', async () => {
  const destination = `/private/tmp/provider-next-kit-test-${randomUUID()}`;
  try {
    const report = await prepareNextKit(destination);
    assert.equal(report.buildExecuted, false);
    assert.equal(report.installableNextArchiveProduced, false);
    assert.equal(report.predecessorSourceMustBeFetchedByParent, true);
    for (const [name, expected] of Object.entries(report.files)) {
      const bytes = await readFile(path.join(destination, name));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
    }
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

test('refuses a repository or nested output location', async () => {
  await assert.rejects(prepareNextKit('.'), /private temporary/);
  await assert.rejects(
    prepareNextKit('/private/tmp/parent/child'),
    /private temporary/
  );
});
