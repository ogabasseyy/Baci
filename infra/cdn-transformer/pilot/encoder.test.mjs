import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStagingBudget } from './disk-guards.mjs';
import {
  encodeRoleLadder,
  encodeVariant,
  enqueuePilotOp,
  probeImageFile,
  runWorkerOp,
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

test('probeImageFile reports oriented geometry and rejects animation', async () => {
  const exif = await probeImageFile(fixture('exif-rotated-600x800.jpg'));
  assert.equal(exif.orientedWidth, 800);
  assert.equal(exif.orientedHeight, 600);
  assert.equal(
    await errorCode(probeImageFile(fixture('anim-2frame.webp'))),
    'animated-input'
  );
  assert.equal(
    await errorCode(probeImageFile(fixture('vector-image.svg'))),
    'unsupported-format'
  );
});

test('encodeVariant encodes within budget and flags over-budget output', async () => {
  const dir = await staging();
  const input = fixture('photo-1254x1254.jpg');
  const ok = await encodeVariant({
    budgetBytes: 500_000,
    deadlineMs: Date.now() + 60_000,
    expectedSha256: await shaOf(input),
    fileStem: 'photo',
    format: 'webp',
    quality: 70,
    snapshotPath: input,
    stagingBudget: createStagingBudget(),
    stagingDir: dir,
    width: 384,
  });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.output.width, 384);
  assert.equal(ok.output.height, 384);

  // Over-budget output is removed and rejected BEFORE charging: no
  // phantom bytes linger in the budget and no file remains on disk.
  const overDir = await staging();
  const overBudget = createStagingBudget();
  const over = await encodeVariant({
    budgetBytes: 100,
    deadlineMs: Date.now() + 60_000,
    expectedSha256: await shaOf(input),
    fileStem: 'photo-small',
    format: 'webp',
    quality: 70,
    snapshotPath: input,
    stagingBudget: overBudget,
    stagingDir: overDir,
    width: 384,
  });
  assert.equal(over.status, 'over-budget');
  assert.ok(over.bytes > 100);
  assert.equal(overBudget.used, 0);
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(overDir), []);
});

test('encodeVariant refuses before writing when the tier cannot fit the staging cap', async () => {
  const dir = await staging();
  const input = fixture('photo-1254x1254.jpg');
  // 100 bytes of headroom with a 500KB tier ceiling: the attempt must be
  // refused without invoking the worker (no output file appears).
  const budget = createStagingBudget(100);
  const refused = await encodeVariant({
    budgetBytes: 500_000,
    deadlineMs: Date.now() + 60_000,
    expectedSha256: await shaOf(input),
    fileStem: 'photo-refused',
    format: 'webp',
    quality: 70,
    snapshotPath: input,
    stagingBudget: budget,
    stagingDir: dir,
    width: 384,
  });
  assert.equal(refused.status, 'over-budget');
  assert.equal(refused.bytes, 500_000);
  assert.equal(budget.used, 0);
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(dir), []);
});

test('encode preserves alpha, converts color, applies EXIF, never upscales', async () => {
  const dir = await staging();
  const budget = createStagingBudget();
  const deadlineMs = Date.now() + 120_000;

  const alphaInput = fixture('alpha-512x512.png');
  const alpha = await encodeVariant({
    budgetBytes: 500_000,
    deadlineMs,
    expectedSha256: await shaOf(alphaInput),
    fileStem: 'alpha',
    format: 'webp',
    quality: 70,
    snapshotPath: alphaInput,
    stagingBudget: budget,
    stagingDir: dir,
    width: 256,
  });
  assert.equal(alpha.output.hasAlpha, true);

  const cmykInput = fixture('cmyk-400x400.jpg');
  const cmyk = await encodeVariant({
    budgetBytes: 500_000,
    deadlineMs,
    expectedSha256: await shaOf(cmykInput),
    fileStem: 'cmyk',
    format: 'avif',
    quality: 70,
    snapshotPath: cmykInput,
    stagingBudget: budget,
    stagingDir: dir,
    width: 384,
  });
  assert.equal(cmyk.output.space, 'srgb');

  const exifInput = fixture('exif-rotated-600x800.jpg');
  const exif = await encodeVariant({
    budgetBytes: 500_000,
    deadlineMs,
    expectedSha256: await shaOf(exifInput),
    fileStem: 'exif',
    format: 'webp',
    quality: 70,
    snapshotPath: exifInput,
    stagingBudget: budget,
    stagingDir: dir,
    width: 384,
  });
  assert.equal(exif.output.width, 384);
  assert.equal(exif.output.height, 288);

  const tinyInput = fixture('tiny-48x48.png');
  const tiny = await encodeVariant({
    budgetBytes: 500_000,
    deadlineMs,
    expectedSha256: await shaOf(tinyInput),
    fileStem: 'tiny',
    format: 'webp',
    quality: 70,
    snapshotPath: tinyInput,
    stagingBudget: budget,
    stagingDir: dir,
    width: 384,
  });
  assert.equal(tiny.output.width, 48);
  assert.equal(tiny.output.height, 48);
});

test('encode rejects mutated sources and corrupt input', async () => {
  const dir = await staging();
  const input = fixture('photo-1254x1254.jpg');
  assert.equal(
    await errorCode(
      encodeVariant({
        budgetBytes: 500_000,
        deadlineMs: Date.now() + 60_000,
        expectedSha256: '0'.repeat(64),
        fileStem: 'mut',
        format: 'webp',
        quality: 70,
        snapshotPath: input,
        stagingBudget: createStagingBudget(),
        stagingDir: dir,
        width: 384,
      })
    ),
    'source-mutated'
  );
  const corrupt = fixture('corrupt-truncated.jpg');
  assert.equal(
    await errorCode(
      encodeVariant({
        budgetBytes: 500_000,
        deadlineMs: Date.now() + 60_000,
        expectedSha256: await shaOf(corrupt),
        fileStem: 'corrupt',
        format: 'webp',
        quality: 70,
        snapshotPath: corrupt,
        stagingBudget: createStagingBudget(),
        stagingDir: dir,
        width: 384,
      })
    ),
    'encode-failed'
  );
});

test('operations time out, honor the absolute deadline, and support cancel', async () => {
  const input = fixture('photo-1254x1254.jpg');
  assert.equal(
    await errorCode(
      runWorkerOp({ input, op: 'metadata' }, { timeoutMs: 1 })
    ),
    'op-timeout'
  );
  // The slot is released after a kill: a follow-up op succeeds.
  const after = await runWorkerOp({ input, op: 'metadata' });
  assert.equal(after.ok, true);

  assert.equal(
    await errorCode(
      runWorkerOp({ input, op: 'metadata' }, { deadlineMs: Date.now() - 1 })
    ),
    'job-deadline'
  );

  const controller = new AbortController();
  controller.abort();
  assert.equal(
    await errorCode(
      runWorkerOp({ input, op: 'metadata' }, { signal: controller.signal })
    ),
    'op-cancelled'
  );
});

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
