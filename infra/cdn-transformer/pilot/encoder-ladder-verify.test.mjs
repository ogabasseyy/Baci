import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createStagingBudget } from './disk-guards.mjs';
import { applyDeliveryGuard } from './delivery.mjs';
import {
  encodeRoleLadder,
  encodeVariant,
  enqueuePilotOp,
  verifyVariant,
} from './encoder.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', name);

async function shaOf(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function staging() {
  return mkdtemp(join(tmpdir(), 'pilot-enc-'));
}

async function errorCode(promise) {
  try {
    await promise;
  } catch (error) {
    return error.code;
  }
  return null;
}

test('enqueuePilotOp never overlaps executions', async () => {
  let active = 0;
  let maxActive = 0;
  const task = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return 'done';
  };
  const results = await Promise.all([
    enqueuePilotOp(task),
    enqueuePilotOp(task),
    enqueuePilotOp(task),
  ]);
  assert.deepEqual(results, ['done', 'done', 'done']);
  assert.equal(maxActive, 1);
});

test('verifyVariant checks decoded format and geometry', async () => {
  const dir = await staging();
  const input = fixture('wide-2000x500.png');
  const encoded = await encodeVariant({
    budgetBytes: 500_000,
    deadlineMs: Date.now() + 60_000,
    expectedSha256: await shaOf(input),
    fileStem: 'wide',
    format: 'webp',
    quality: 70,
    snapshotPath: input,
    stagingBudget: createStagingBudget(),
    stagingDir: dir,
    width: 384,
  });
  const facts = await verifyVariant({
    deadlineMs: Date.now() + 60_000,
    expectedFormat: 'webp',
    expectedHeight: 96,
    expectedWidth: 384,
    path: encoded.output.path,
  });
  assert.equal(facts.width, 384);
  assert.equal(
    await errorCode(
      verifyVariant({
        deadlineMs: Date.now() + 60_000,
        expectedFormat: 'avif',
        expectedHeight: 96,
        expectedWidth: 384,
        path: encoded.output.path,
      })
    ),
    'verify-failed'
  );
});

test('encodeRoleLadder descends quality and deduplicates small sources', async () => {
  const dir = await staging();
  const input = fixture('text-800x600.png');
  const ladder = await encodeRoleLadder({
    deadlineMs: Date.now() + 120_000,
    expectedSha256: await shaOf(input),
    role: 'logo',
    snapshotPath: input,
    stagingBudget: createStagingBudget(),
    stagingDir: dir,
  });
  assert.equal(ladder.source.orientedWidth, 800);
  assert.equal(ladder.source.orientedHeight, 600);
  assert.equal(ladder.tiers.length, 6);
  for (const tier of ladder.tiers) {
    assert.equal(tier.width, tier.actualWidth);
    assert.ok([70, 65, 60, 55].includes(tier.quality), String(tier.quality));
    assert.equal(tier.height, Math.round(600 * (tier.actualWidth / 800)));
  }

  const tinyDir = await staging();
  const tinyInput = fixture('tiny-48x48.png');
  const tiny = await encodeRoleLadder({
    deadlineMs: Date.now() + 120_000,
    expectedSha256: await shaOf(tinyInput),
    role: 'logo',
    snapshotPath: tinyInput,
    stagingBudget: createStagingBudget(),
    stagingDir: tinyDir,
  });
  for (const tier of tiny.tiers) {
    assert.equal(tier.actualWidth, 48);
  }
  const webpPaths = new Set(
    tiny.tiers.filter((tier) => tier.format === 'webp').map((tier) => tier.path)
  );
  assert.equal(webpPaths.size, 1);

  const floorDir = await staging();
  assert.equal(
    await errorCode(
      encodeRoleLadder({
        budgets: { logo: { 96: { avif: 10, webp: 10 } } },
        deadlineMs: Date.now() + 120_000,
        expectedSha256: await shaOf(input),
        role: 'logo',
        snapshotPath: input,
        stagingBudget: createStagingBudget(),
        stagingDir: floorDir,
      })
    ),
    'budget-floor-exceeded'
  );
});

test('encodeVariant fails the job when an over-budget output cannot be removed', async () => {
  const input = fixture('photo-1254x1254.jpg');
  const attempt = async (stagingDir, unlinkFile) =>
    encodeVariant({
      budgetBytes: 100,
      deadlineMs: Date.now() + 60_000,
      deps: { unlinkFile },
      expectedSha256: await shaOf(input),
      fileStem: 'photo-stuck',
      format: 'webp',
      quality: 70,
      snapshotPath: input,
      stagingBudget: createStagingBudget(),
      stagingDir,
      width: 384,
    });
  // A stuck file keeps unaccounted bytes on disk: continuing with lower
  // qualities could stack several such files past the staging cap.
  const busy = async () => {
    throw Object.assign(new Error('device busy'), { code: 'EBUSY' });
  };
  assert.equal(await errorCode(attempt(await staging(), busy)), 'staging-cleanup-failed');
  // ENOENT means nothing was retained: still a plain over-budget refusal.
  // (The injected removal is a stub, so no on-disk assertion applies.)
  const gone = async () => {
    throw Object.assign(new Error('already gone'), { code: 'ENOENT' });
  };
  const over = await attempt(await staging(), gone);
  assert.equal(over.status, 'over-budget');
  assert.ok(over.bytes > 100);
});

test('encodeVariant revalidates the encoder lock before encoding', async () => {
  const dir = await staging();
  const input = fixture('photo-1254x1254.jpg');
  const evicted = Object.assign(new Error('changed owner mid-run'), {
    code: 'encoder-lock-evicted',
  });
  const expectedSha256 = await shaOf(input);
  await assert.rejects(
    () =>
      encodeVariant({
        assertEncoderHeld: async () => {
          throw evicted;
        },
        budgetBytes: 500_000,
        deadlineMs: Date.now() + 60_000,
        expectedSha256,
        fileStem: 'photo',
        format: 'webp',
        quality: 70,
        snapshotPath: input,
        stagingBudget: createStagingBudget(),
        stagingDir: dir,
        width: 384,
      }),
    /changed owner mid-run/
  );
  // Refused before any encode: no output staged.
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(dir), []);
});

test('encodeRoleLadder rescues a branch-compatible source smaller than the floor', async () => {
  // A heavily-compressed 256px webp source with an infeasible webp
  // ceiling at the 384 tier: the floor attempt exceeds the ceiling,
  // but the source itself is a smaller, branch-compatible delivery —
  // the rung carries the floor bytes so the guard routes it to
  // original-passthrough instead of aborting the ladder.
  const input = join(await staging(), 'tiny-source.webp');
  await writeFile(
    input,
    await sharp(fixture('photo-1254x1254.jpg'))
      .resize(256, 256)
      .webp({ quality: 1 })
      .toBuffer()
  );
  const sourceBytes = (await readFile(input)).length;
  const expectedSha256 = await shaOf(input);
  const floor = await encodeVariant({
    budgetBytes: 5_000_000,
    deadlineMs: Date.now() + 60_000,
    expectedSha256,
    fileStem: 'tiny-floor',
    format: 'webp',
    quality: 55,
    snapshotPath: input,
    stagingBudget: createStagingBudget(),
    stagingDir: await staging(),
    width: 256,
  });
  assert.equal(floor.status, 'ok');
  // Test assumption, measured not hard-coded: the rescue applies only
  // when the source is strictly smaller than the cheapest encode.
  assert.ok(
    sourceBytes < floor.output.bytes,
    `expected source ${sourceBytes}B < floor ${floor.output.bytes}B`
  );
  const budgets = {
    logo: {
      96: { avif: 50_000, webp: 50_000 },
      192: { avif: 100_000, webp: 100_000 },
      384: { avif: 100_000, webp: 10 },
    },
  };
  const ladder = await encodeRoleLadder({
    budgets,
    deadlineMs: Date.now() + 120_000,
    expectedSha256,
    role: 'logo',
    snapshotPath: input,
    sourceBytes,
    stagingBudget: createStagingBudget(),
    stagingDir: await staging(),
  });
  const rescued = ladder.tiers.find(
    (tier) => tier.requestedWidth === 384 && tier.format === 'webp'
  );
  assert.equal(rescued.actualWidth, 256);
  assert.equal(rescued.quality, null);
  assert.equal(rescued.bytes, floor.output.bytes);
  const decided = applyDeliveryGuard({
    source: {
      bytes: sourceBytes,
      format: 'webp',
      orientedHeight: 256,
      orientedWidth: 256,
      sha256: expectedSha256,
    },
    tiers: ladder.tiers,
  });
  const routed = decided.find(
    (tier) => tier.requestedWidth === 384 && tier.format === 'webp'
  );
  assert.equal(routed.delivery, 'original-passthrough');
  assert.equal(routed.bytes, sourceBytes);
  // Without the verified source size the rescue cannot apply: the
  // budget floor stays fatal, as before.
  assert.equal(
    await errorCode(
      encodeRoleLadder({
        budgets,
        deadlineMs: Date.now() + 120_000,
        expectedSha256,
        role: 'logo',
        snapshotPath: input,
        stagingBudget: createStagingBudget(),
        stagingDir: await staging(),
      })
    ),
    'budget-floor-exceeded'
  );
});

test('encodeRoleLadder keeps the fatal for branch-incompatible rungs', async () => {
  // The avif source cannot save a webp rung: an infeasible webp
  // ceiling still aborts the ladder even with the source size known.
  const input = fixture('still-256x256.avif');
  assert.equal(
    await errorCode(
      encodeRoleLadder({
        budgets: {
          logo: {
            96: { avif: 50_000, webp: 50_000 },
            192: { avif: 100_000, webp: 100_000 },
            384: { avif: 100_000, webp: 10 },
          },
        },
        deadlineMs: Date.now() + 120_000,
        expectedSha256: await shaOf(input),
        role: 'logo',
        snapshotPath: input,
        sourceBytes: (await readFile(input)).length,
        stagingBudget: createStagingBudget(),
        stagingDir: await staging(),
      })
    ),
    'budget-floor-exceeded'
  );
});
