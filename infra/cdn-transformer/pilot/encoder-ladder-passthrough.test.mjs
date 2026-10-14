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
import { encodeRoleLadder, encodeVariant } from './encoder.mjs';

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
  // when the source is no larger than the cheapest encode.
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

test('encodeRoleLadder rescues an equal-sized branch-compatible source', async () => {
  // Equality boundary: a branch-compatible source at exactly the
  // floor's byte count satisfies the never-larger contract, so the
  // rung rescues instead of throwing budget-floor-exceeded. Exact
  // equality is arranged by reporting the measured floor size as the
  // verified source size — the comparison under test sees only that
  // integer. The null quality marks no encode, so the delivery guard
  // disposes the equal rung as original-passthrough (generated tiers
  // must carry encode quality, which would fail manifest validation).
  const input = join(await staging(), 'tiny-source.webp');
  await writeFile(
    input,
    await sharp(fixture('photo-1254x1254.jpg'))
      .resize(256, 256)
      .webp({ quality: 1 })
      .toBuffer()
  );
  const expectedSha256 = await shaOf(input);
  const floor = await encodeVariant({
    budgetBytes: 5_000_000,
    deadlineMs: Date.now() + 60_000,
    expectedSha256,
    fileStem: 'tiny-floor-eq',
    format: 'webp',
    quality: 55,
    snapshotPath: input,
    stagingBudget: createStagingBudget(),
    stagingDir: await staging(),
    width: 256,
  });
  assert.equal(floor.status, 'ok');
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
    sourceBytes: floor.output.bytes,
    stagingBudget: createStagingBudget(),
    stagingDir: await staging(),
  });
  const rescued = ladder.tiers.find(
    (tier) => tier.requestedWidth === 384 && tier.format === 'webp'
  );
  assert.equal(rescued.bytes, floor.output.bytes);
  const decided = applyDeliveryGuard({
    source: {
      bytes: floor.output.bytes,
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
  assert.equal(routed.bytes, floor.output.bytes);
  assert.equal(routed.quality, null);
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
