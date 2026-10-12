import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runPilotGeneration } from './generate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', name);
const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

async function setup() {
  const base = await mkdtemp(join(tmpdir(), 'pilot-report-write-'));
  const inputRoot = join(base, 'input');
  const outputRoot = join(base, 'output');
  const locksDir = join(base, 'locks');
  await mkdir(inputRoot, { recursive: true });
  await mkdir(locksDir, { recursive: true });
  return { base, inputRoot, locksDir, outputRoot };
}

async function addSnapshot(inputRoot, fixtureName, assetId) {
  const target = join(inputRoot, `${assetId}.png`);
  await copyFile(fixture(fixtureName), target);
  const bytes = await readFile(target);
  return {
    assetId,
    capturedAt: '2026-10-01T20:00:00.000Z',
    contentType: 'image/png',
    height: 48,
    merchantId: MERCHANT,
    role: 'logo',
    schemaVersion: 1,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    slot: 'header-logo',
    sourcePath: `${assetId}.png`,
    url: `https://example.com/${assetId}.png`,
    width: 48,
  };
}

test('report publication refuses a reports swap won at the final write', async () => {
  const { base, inputRoot, locksDir, outputRoot } = await setup();
  const records = [await addSnapshot(inputRoot, 'tiny-48x48.png', 'tiny-a')];
  const inventoryPath = join(inputRoot, 'inventory.json');
  await writeFile(inventoryPath, JSON.stringify(records, null, 2));
  const outside = join(base, 'outside');
  await mkdir(outside);
  // The swap wins the race deterministically: reports is a real
  // directory through setup and every job, and becomes a symlink to an
  // outside directory immediately before the report write. A pathname
  // write would follow it; the confined-descriptor publish refuses.
  let fired = false;
  await assert.rejects(
    runPilotGeneration({
      hooks: {
        beforeReportWrite: async () => {
          fired = true;
          await rename(
            join(outputRoot, 'reports'),
            join(base, 'reports-stashed')
          );
          await symlink(outside, join(outputRoot, 'reports'));
        },
      },
      inputRoot,
      inventoryPath,
      locksDir,
      outputRoot,
    }),
    /confined/
  );
  assert.equal(fired, true);
  assert.deepEqual(await readdir(outside), []);
});
