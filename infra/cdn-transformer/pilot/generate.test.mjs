import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireEncoderLock } from './encoder-lock.mjs';
import { loadGeneration } from './manifest-store.mjs';
import { assertConfinedChild, runPilotGeneration } from './generate.mjs';

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

for (const child of ['claims', 'generations', 'reports']) {
  test(`rejects a symlinked ${child} directory before starting jobs`, async () => {
    const { base, inputRoot, locksDir, outputRoot } = await setup();
    const outside = join(base, 'outside');
    await mkdir(outside);
    await mkdir(outputRoot);
    await symlink(outside, join(outputRoot, child));
    const records = [await addSnapshot(inputRoot, 'tiny-48x48.png', 'tiny-a')];
    const inventoryPath = await writeInventory(inputRoot, records);
    await assert.rejects(runPilotGeneration({ inputRoot, inventoryPath, locksDir, outputRoot }), /symlink|confined/);
    assert.deepEqual(await readdir(outside), []);
  });
}

test('report re-confinement refuses a mid-run reports swap', async () => {
  // The setup check ran a whole generation ago: a reports dir swapped
  // for a symlink (or a file squat) after setup must refuse before the
  // final write instead of publishing outside the output root.
  const { mkdtemp } = await import('node:fs/promises');
  const { realpath } = await import('node:fs/promises');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pilot-reconfine-')));
  for (const child of ['claims', 'generations', 'reports']) {
    await mkdir(join(root, child));
  }
  await assertConfinedChild(root, 'reports');
  const outside = join(root, 'outside');
  await mkdir(outside);
  const link = join(root, 'link');
  await symlink(outside, link);
  await assert.rejects(assertConfinedChild(root, 'link'), /confined directory/);
  const squat = join(root, 'squat');
  await writeFile(squat, 'planted');
  await assert.rejects(assertConfinedChild(root, 'squat'), /confined directory/);
});

test('generates, commits, and reports two jobs end to end', async () => {
  const { inputRoot, locksDir, outputRoot } = await setup();
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
  const summary = await runPilotGeneration({ inputRoot, inventoryPath, locksDir, outputRoot });
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
  assert.equal(report.versions.sharp, '0.35.5');
  assert.ok(report.versions.libvips.length > 0);
  assert.ok(report.versions.node.length > 0);
  assert.equal(report.jobs.length, 2);
  assert.ok(report.jobs.every((job) => job.elapsedMs >= 0));
});

test('reruns reuse validated generations', async () => {
  const { inputRoot, locksDir, outputRoot } = await setup();
  const records = [await addSnapshot(inputRoot, 'tiny-48x48.png', 'tiny-a')];
  const inventoryPath = await writeInventory(inputRoot, records);
  const first = await runPilotGeneration({ inputRoot, inventoryPath, locksDir, outputRoot });
  assert.equal(first.ok, 1);
  const second = await runPilotGeneration({ inputRoot, inventoryPath, locksDir, outputRoot });
  assert.equal(second.ok, 1);
  assert.equal(second.reused, 1);
});

test('a run on a lock-held root fails fast instead of overlapping', async () => {
  const { inputRoot, locksDir, outputRoot } = await setup();
  const records = [await addSnapshot(inputRoot, 'tiny-48x48.png', 'tiny-a')];
  const inventoryPath = await writeInventory(inputRoot, records);
  // Pre-create the confined output layout the run expects, then hold the
  // host lock the way an overlapping generate.mjs invocation would.
  await mkdir(outputRoot, { recursive: true });
  const held = await acquireEncoderLock(outputRoot, { locksDir });
  try {
    await assert.rejects(
      runPilotGeneration({ inputRoot, inventoryPath, locksDir, outputRoot }),
      /encoder lock/
    );
  } finally {
    await held.release();
  }
  // The failed contender leaves the root usable: the next run proceeds.
  const summary = await runPilotGeneration({ inputRoot, inventoryPath, locksDir, outputRoot });
  assert.equal(summary.ok, 1);
});

test('a failing job does not block the batch', async () => {
  const { inputRoot, locksDir, outputRoot } = await setup();
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
  const summary = await runPilotGeneration({ inputRoot, inventoryPath, locksDir, outputRoot });
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
  const { inputRoot, locksDir, outputRoot } = await setup();
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
  await runPilotGeneration({ inputRoot, inventoryPath, locksDir, outputRoot });
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
    // Worker children self-report per op; the combined figure is
    // sampled evidence (never a bare "peak" that silently excludes the
    // encoder) — and never an upper bound, since transient peaks
    // between samples are missed.
    assert.ok(
      Number.isInteger(job.peakWorkerRssBytes) && job.peakWorkerRssBytes >= 0,
      `job ${job.assetId} reports worker RSS`
    );
    assert.equal(
      job.peakCombinedSampledBytes,
      job.sampledParentRssBytes + job.peakWorkerRssBytes,
      `job ${job.assetId} combined sample sums both peaks`
    );
    assert.ok(!('peakRssBytes' in job), `job ${job.assetId} has no bare peak`);
  }
  const goodJob = report.jobs.find((job) => job.assetId === 'tiny-good');
  assert.ok(goodJob.peakWorkerRssBytes > 0, 'encoded job saw worker memory');
});
