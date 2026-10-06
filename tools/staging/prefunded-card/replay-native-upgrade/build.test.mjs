import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildReplayNativeUpgrade } from './build.mjs';
import { authority } from './constants.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
test('draft, missing review and wrong inventory pin cannot start compilation or create output', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'replay-build-gate-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const outputDirectory = path.join(directory, 'not-created');
  const frozen = await readFile(authority.frozenInventory);
  for (const overrides of [{ status: 'draft' }, { baselineProvenance: 'changed after review' }]) {
    const inventoryBytes = Buffer.from(JSON.stringify({ ...JSON.parse(frozen), ...overrides }));
    await assert.rejects(buildReplayNativeUpgrade({ inventoryBytes,
      reviewedInventorySha256: digest(inventoryBytes), outputDirectory }), /inventory/);
  }
  await assert.rejects(buildReplayNativeUpgrade({ inventoryBytes: frozen,
    reviewedInventorySha256: '0'.repeat(64), outputDirectory }), /inventory/);
  await assert.rejects(stat(outputDirectory), { code: 'ENOENT' });
});
