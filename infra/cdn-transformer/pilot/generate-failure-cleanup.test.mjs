import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_FREE_BYTES } from './constants.mjs';
import { removeOwnedStaging as realRemoveOwnedStaging } from './disk-guards.mjs';
import { runJob } from './generate-job.mjs';
import { readInventoryJobs } from './job-schema.mjs';
import { parseMinFreeBytes, runPilotGeneration } from './generate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', name);
const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

async function setup() {
  const base = join(tmpdir(), `pilot-gen-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

async function writeInventory(inputRoot, records) {
  const path = join(inputRoot, 'inventory.json');
  await writeFile(path, JSON.stringify(records, null, 2));
  return path;
}

test('source hash mismatch fails the job without encoding', async () => {
  const { inputRoot, locksDir, outputRoot } = await setup();
  const record = await addSnapshot(inputRoot, 'tiny-48x48.png', 'tiny-a');
  record.sha256 = 'f'.repeat(64);
  const inventoryPath = await writeInventory(inputRoot, [record]);
  const summary = await runPilotGeneration({ inputRoot, inventoryPath, locksDir, outputRoot });
  assert.equal(summary.failed, 1);
  const reports = await readdir(join(outputRoot, 'reports'));
  const report = JSON.parse(
    await readFile(join(outputRoot, 'reports', reports[0]), 'utf8')
  );
  assert.equal(report.jobs[0].code, 'source-mismatch');
});

test('parseMinFreeBytes rejects fail-open floor values', () => {
  assert.equal(parseMinFreeBytes(undefined), undefined);
  assert.equal(parseMinFreeBytes(MIN_FREE_BYTES), MIN_FREE_BYTES);
  assert.equal(parseMinFreeBytes(String(MIN_FREE_BYTES + 1)), MIN_FREE_BYTES + 1);
  // Below-floor CLI overrides would disable the disk safety checks.
  for (const value of ['0', 0, 1024, String(MIN_FREE_BYTES - 1)]) {
    assert.throws(() => parseMinFreeBytes(value), /at least/, String(value));
  }
  for (const value of ['abc', '', '-1', '-5', '1.5', 'NaN', 'Infinity']) {
    assert.throws(() => parseMinFreeBytes(value), /non-negative integer/, String(value));
  }
});

test('over-cap inventories and exhausted disks fail fast', async () => {
  const { inputRoot, locksDir, outputRoot } = await setup();
  const records = [];
  for (let index = 0; index < 21; index += 1) {
    const record = await addSnapshot(inputRoot, 'tiny-48x48.png', `asset-${index}`);
    records.push(record);
  }
  const inventoryPath = await writeInventory(inputRoot, records);
  await assert.rejects(
    () => runPilotGeneration({ inputRoot, inventoryPath, locksDir, outputRoot }),
    /at most 20/
  );

  const single = await setup();
  const one = await addSnapshot(single.inputRoot, 'tiny-48x48.png', 'tiny-a');
  const singleInventory = await writeInventory(single.inputRoot, [one]);
  const summary = await runPilotGeneration({
    inputRoot: single.inputRoot,
    inventoryPath: singleInventory,
    locksDir: single.locksDir,
    minFreeBytes: Number.MAX_SAFE_INTEGER,
    outputRoot: single.outputRoot,
  });
  assert.equal(summary.failed, 1);
});

test('empty inventories are rejected instead of reporting green', async () => {
  const { inputRoot, locksDir, outputRoot } = await setup();
  const inventoryPath = await writeInventory(inputRoot, []);
  await assert.rejects(
    () => runPilotGeneration({ inputRoot, inventoryPath, locksDir, outputRoot }),
    (error) => {
      assert.equal(error.code, 'inventory-empty');
      assert.match(error.message, /no jobs/);
      return true;
    }
  );
});

test('a post-commit claim-release failure still reports the published job ok', async () => {
  const { inputRoot, locksDir, outputRoot } = await setup();
  const records = [await addSnapshot(inputRoot, 'tiny-48x48.png', 'tiny-a')];
  const inventoryPath = await writeInventory(inputRoot, records);
  const [job] = await readInventoryJobs(inventoryPath);
  await mkdir(outputRoot, { recursive: true });
  const result = await runJob({
    deps: {
      releaseClaim: async () => {
        throw Object.assign(new Error('claims unreadable'), {
          code: 'EACCES',
        });
      },
    },
    inputRoot,
    job,
    minFreeBytes: 0,
    outputRoot,
  });
  assert.equal(result.status, 'ok');
  assert.match(result.cleanupWarning, /post-commit cleanup failed/);
  assert.match(result.cleanupWarning, /published and reusable/);
  // The generation really is durable: exactly one committed directory.
  assert.equal((await readdir(join(outputRoot, 'generations'))).length, 1);
});

test('a transient reuse-path cleanup failure retries without stranding staging', async () => {
  const { inputRoot, locksDir, outputRoot } = await setup();
  const records = [await addSnapshot(inputRoot, 'tiny-48x48.png', 'tiny-a')];
  const inventoryPath = await writeInventory(inputRoot, records);
  const [job] = await readInventoryJobs(inventoryPath);
  await mkdir(outputRoot, { recursive: true });
  let calls = 0;
  const flakyRemove = async (...args) => {
    calls += 1;
    // Call 1 is the fresh-path removal (must succeed); call 2 is the
    // reuse-path attempt inside commitGeneration (fails transiently);
    // call 3 is the job-level retry (reclaims).
    if (calls === 2) {
      throw Object.assign(new Error('staging busy'), { code: 'EBUSY' });
    }
    return realRemoveOwnedStaging(...args);
  };
  const first = await runJob({
    deps: { removeOwnedStaging: flakyRemove },
    inputRoot,
    job,
    minFreeBytes: 0,
    outputRoot,
  });
  assert.equal(first.status, 'ok');
  assert.equal(first.reused, false);
  const second = await runJob({
    deps: { removeOwnedStaging: flakyRemove },
    inputRoot,
    job,
    minFreeBytes: 0,
    outputRoot,
  });
  assert.equal(second.status, 'ok');
  assert.equal(second.reused, true);
  assert.equal(second.cleanupWarning, undefined);
  assert.equal(calls, 3);
});

test('a persistent reuse-path cleanup failure warns instead of stranding silently', async () => {
  const { inputRoot, locksDir, outputRoot } = await setup();
  const records = [await addSnapshot(inputRoot, 'tiny-48x48.png', 'tiny-a')];
  const inventoryPath = await writeInventory(inputRoot, records);
  const [job] = await readInventoryJobs(inventoryPath);
  await mkdir(outputRoot, { recursive: true });
  const first = await runJob({ inputRoot, job, minFreeBytes: 0, outputRoot });
  assert.equal(first.status, 'ok');
  const second = await runJob({
    deps: {
      removeOwnedStaging: async () => {
        throw Object.assign(new Error('staging busy'), { code: 'EBUSY' });
      },
    },
    inputRoot,
    job,
    minFreeBytes: 0,
    outputRoot,
  });
  assert.equal(second.status, 'ok');
  assert.equal(second.reused, true);
  assert.match(second.cleanupWarning, /reuse-path staging cleanup failed/);
  assert.match(second.cleanupWarning, /post-commit cleanup failed/);
});
