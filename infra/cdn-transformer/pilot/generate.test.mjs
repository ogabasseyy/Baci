import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_FREE_BYTES } from './constants.mjs';
import { loadGeneration } from './manifest-store.mjs';
import { parseMinFreeBytes, runPilotGeneration } from './generate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', name);
const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

async function setup() {
  const base = join(tmpdir(), `pilot-gen-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const inputRoot = join(base, 'input');
  const outputRoot = join(base, 'output');
  await mkdir(inputRoot, { recursive: true });
  return { base, inputRoot, outputRoot };
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

test('generates, commits, and reports two jobs end to end', async () => {
  const { inputRoot, outputRoot } = await setup();
  const records = [
    await addSnapshot(inputRoot, 'tiny-48x48.png', 'tiny-a'),
    {
      ...(await addSnapshot(inputRoot, 'tiny-48x48.png', 'tiny-b')),
      // Distinct slot: the route rejects merchant/slot collisions, so the
      // isolation fixture must not encode one.
      slot: 'product-card',
    },
  ];
  const inventoryPath = await writeInventory(inputRoot, records);
  const summary = await runPilotGeneration({ inputRoot, inventoryPath, outputRoot });
  assert.equal(summary.ok, 2);
  assert.equal(summary.failed, 0);
  assert.equal(summary.reused, 0);

  const generations = await readdir(join(outputRoot, 'generations'));
  assert.equal(generations.length, 2);
  // Identical source bytes under different asset ids stay isolated.
  assert.notEqual(generations[0], generations[1]);
  for (const generationId of generations) {
    const loaded = await loadGeneration(outputRoot, generationId);
    assert.equal(loaded.manifest.tiers.length, 6);
  }
  const reports = await readdir(join(outputRoot, 'reports'));
  assert.equal(reports.length, 1);
  const report = JSON.parse(
    await readFile(join(outputRoot, 'reports', reports[0]), 'utf8')
  );
  assert.equal(report.versions.sharp, '0.35.4');
  assert.ok(report.versions.libvips.length > 0);
  assert.ok(report.versions.node.length > 0);
  assert.equal(report.jobs.length, 2);
  assert.ok(report.jobs.every((job) => job.elapsedMs >= 0));
});

test('reruns reuse validated generations', async () => {
  const { inputRoot, outputRoot } = await setup();
  const records = [await addSnapshot(inputRoot, 'tiny-48x48.png', 'tiny-a')];
  const inventoryPath = await writeInventory(inputRoot, records);
  const first = await runPilotGeneration({ inputRoot, inventoryPath, outputRoot });
  assert.equal(first.ok, 1);
  const second = await runPilotGeneration({ inputRoot, inventoryPath, outputRoot });
  assert.equal(second.ok, 1);
  assert.equal(second.reused, 1);
});

test('a failing job does not block the batch', async () => {
  const { inputRoot, outputRoot } = await setup();
  const good = await addSnapshot(inputRoot, 'tiny-48x48.png', 'tiny-good');
  const animatedTarget = join(inputRoot, 'anim-bad.png');
  await copyFile(fixture('anim-2frame.webp'), animatedTarget);
  const animatedBytes = await readFile(animatedTarget);
  const bad = {
    ...good,
    assetId: 'anim-bad',
    sha256: createHash('sha256').update(animatedBytes).digest('hex'),
    size: animatedBytes.length,
    slot: 'card',
    sourcePath: 'anim-bad.png',
    url: 'https://example.com/anim-bad.png',
  };
  const inventoryPath = await writeInventory(inputRoot, [bad, good]);
  const summary = await runPilotGeneration({ inputRoot, inventoryPath, outputRoot });
  assert.equal(summary.ok, 1);
  assert.equal(summary.failed, 1);
  const reports = await readdir(join(outputRoot, 'reports'));
  const report = JSON.parse(
    await readFile(join(outputRoot, 'reports', reports[0]), 'utf8')
  );
  const failed = report.jobs.find((job) => job.assetId === 'anim-bad');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.code, 'animated-input');
});

test('memory evidence combines sampled parent RSS with worker peaks', async () => {
  const { inputRoot, outputRoot } = await setup();
  const good = await addSnapshot(inputRoot, 'tiny-48x48.png', 'tiny-good');
  const animatedTarget = join(inputRoot, 'anim-bad.png');
  await copyFile(fixture('anim-2frame.webp'), animatedTarget);
  const animatedBytes = await readFile(animatedTarget);
  const bad = {
    ...good,
    assetId: 'anim-bad',
    sha256: createHash('sha256').update(animatedBytes).digest('hex'),
    size: animatedBytes.length,
    slot: 'card',
    sourcePath: 'anim-bad.png',
    url: 'https://example.com/anim-bad.png',
  };
  const inventoryPath = await writeInventory(inputRoot, [bad, good]);
  await runPilotGeneration({ inputRoot, inventoryPath, outputRoot });
  const reports = await readdir(join(outputRoot, 'reports'));
  const report = JSON.parse(
    await readFile(join(outputRoot, 'reports', reports[0]), 'utf8')
  );
  assert.equal(report.jobs.length, 2);
  for (const job of report.jobs) {
    assert.ok(
      Number.isFinite(job.sampledParentRssBytes) && job.sampledParentRssBytes > 0,
      `job ${job.assetId} reports sampled parent RSS`
    );
    // Worker children self-report per op; the combined figure is a
    // conservative upper bound safe to size capacity (never a bare
    // "peak" that silently excludes the encoder).
    assert.ok(
      Number.isInteger(job.peakWorkerRssBytes) && job.peakWorkerRssBytes >= 0,
      `job ${job.assetId} reports worker RSS`
    );
    assert.equal(
      job.peakCombinedUpperBoundBytes,
      job.sampledParentRssBytes + job.peakWorkerRssBytes,
      `job ${job.assetId} combined bound sums both peaks`
    );
    assert.ok(!('peakRssBytes' in job), `job ${job.assetId} has no bare peak`);
  }
  const goodJob = report.jobs.find((job) => job.assetId === 'tiny-good');
  assert.ok(goodJob.peakWorkerRssBytes > 0, 'encoded job saw worker memory');
});

test('source hash mismatch fails the job without encoding', async () => {
  const { inputRoot, outputRoot } = await setup();
  const record = await addSnapshot(inputRoot, 'tiny-48x48.png', 'tiny-a');
  record.sha256 = 'f'.repeat(64);
  const inventoryPath = await writeInventory(inputRoot, [record]);
  const summary = await runPilotGeneration({ inputRoot, inventoryPath, outputRoot });
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
  const { inputRoot, outputRoot } = await setup();
  const records = [];
  for (let index = 0; index < 21; index += 1) {
    const record = await addSnapshot(inputRoot, 'tiny-48x48.png', `asset-${index}`);
    records.push(record);
  }
  const inventoryPath = await writeInventory(inputRoot, records);
  await assert.rejects(
    () => runPilotGeneration({ inputRoot, inventoryPath, outputRoot }),
    /at most 20/
  );

  const single = await setup();
  const one = await addSnapshot(single.inputRoot, 'tiny-48x48.png', 'tiny-a');
  const singleInventory = await writeInventory(single.inputRoot, [one]);
  const summary = await runPilotGeneration({
    inputRoot: single.inputRoot,
    inventoryPath: singleInventory,
    minFreeBytes: Number.MAX_SAFE_INTEGER,
    outputRoot: single.outputRoot,
  });
  assert.equal(summary.failed, 1);
});

test('empty inventories are rejected instead of reporting green', async () => {
  const { inputRoot, outputRoot } = await setup();
  const inventoryPath = await writeInventory(inputRoot, []);
  await assert.rejects(
    () => runPilotGeneration({ inputRoot, inventoryPath, outputRoot }),
    (error) => {
      assert.equal(error.code, 'inventory-empty');
      assert.match(error.message, /no jobs/);
      return true;
    }
  );
});

