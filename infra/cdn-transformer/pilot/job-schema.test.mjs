import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parsePilotJob,
  pilotJobKey,
  readInventoryJobs,
  validateInventory,
} from './job-schema.mjs';

const MERCHANT_A = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const MERCHANT_B = 'de968340-de02-4aa8-95f9-9d5f7d2b1f20';
const SHA = 'd9ffc58df5cc06104ae0eb604f84606549e8e6b5d06a35bff668c1f2e3511b98';

function validJob(overrides = {}) {
  return {
    assetId: 'logo-1790756460727',
    expectedSha256: SHA,
    merchantId: MERCHANT_A,
    role: 'logo',
    schemaVersion: 1,
    sourcePath: 'snapshots/logo-1790756460727.png',
    ...overrides,
  };
}

test('accepts a valid job', () => {
  const result = parsePilotJob(validJob());
  assert.equal(result.ok, true);
  assert.equal(
    pilotJobKey(result.job),
    `${MERCHANT_A}/logo-1790756460727/logo`
  );
});

test('rejects unknown schema versions and roles', () => {
  assert.equal(parsePilotJob(validJob({ schemaVersion: 2 })).ok, false);
  assert.equal(parsePilotJob(validJob({ role: 'banner' })).ok, false);
});

test('rejects malformed merchant ids and hashes', () => {
  assert.equal(parsePilotJob(validJob({ merchantId: 'not-a-uuid' })).ok, false);
  assert.equal(
    parsePilotJob(validJob({ expectedSha256: 'xyz' })).ok,
    false
  );
  assert.equal(
    parsePilotJob(validJob({ expectedSha256: SHA.toUpperCase() })).ok,
    false
  );
});

test('rejects malformed asset ids', () => {
  for (const assetId of ['', '../x', 'a/b', 'a b', 'x'.repeat(129)]) {
    assert.equal(parsePilotJob(validJob({ assetId })).ok, false, assetId);
  }
});

test('rejects absolute paths, traversal, and encoded separators', () => {
  const bad = [
    '/etc/passwd',
    '../escape.png',
    'a/../../escape.png',
    'a//b.png',
    './a.png',
    'a/./b.png',
    'a/../b.png',
    'a\\b.png',
    'a%2fb.png',
    'a%2Fb.png',
    'a%5cb.png',
    'a%00.png',
    // Nested encodings: every decode layer is validated, so double,
    // triple, encoded dots, and mixed layers must all fail.
    'a%252fb.png',
    'a%25252fb.png',
    '%2e%2e%2fescape.png',
    '..%2fescape.png',
    'a\x00b.png',
    'a\nb.png',
    '',
    'x'.repeat(257),
  ];
  for (const sourcePath of bad) {
    const result = parsePilotJob(validJob({ sourcePath }));
    assert.equal(result.ok, false, JSON.stringify(sourcePath));
  }
  // A bare percent that decodes to nothing stays valid.
  assert.equal(parsePilotJob(validJob({ sourcePath: '100%.png' })).ok, true);
});

test('rejects unknown fields', () => {
  const result = parsePilotJob(validJob({ extra: true }));
  assert.equal(result.ok, false);
});

test('validateInventory accepts distinct jobs up to the cap', () => {
  const jobs = Array.from({ length: 20 }, (_, index) =>
    validJob({
      assetId: `asset-${index}`,
      sourcePath: `snapshots/asset-${index}.png`,
    })
  );
  const result = validateInventory(jobs);
  assert.equal(result.ok, true);
  assert.equal(result.jobs.length, 20);
});

test('validateInventory allows identical bytes under different asset ids', () => {
  const jobs = [
    validJob({ assetId: 'asset-a', sourcePath: 'snapshots/a.png' }),
    validJob({
      assetId: 'asset-b',
      merchantId: MERCHANT_B,
      sourcePath: 'snapshots/b.png',
    }),
  ];
  const result = validateInventory(jobs);
  assert.equal(result.ok, true);
});

test('validateInventory rejects over-cap inventories', () => {
  const jobs = Array.from({ length: 21 }, (_, index) =>
    validJob({
      assetId: `asset-${index}`,
      sourcePath: `snapshots/asset-${index}.png`,
    })
  );
  const result = validateInventory(jobs);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /at most 20/);
});

test('validateInventory rejects duplicate and conflicting job keys', () => {
  const exact = validateInventory([validJob(), validJob()]);
  assert.equal(exact.ok, false);
  assert.match(exact.errors.join('\n'), /duplicate/i);

  const conflicting = validateInventory([
    validJob(),
    validJob({ sourcePath: 'snapshots/other.png' }),
  ]);
  assert.equal(conflicting.ok, false);
  assert.match(conflicting.errors.join('\n'), /conflict/i);
});

test('readInventoryJobs maps acquisition records to validated jobs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pilot-inv-'));
  const path = join(dir, 'inventory.json');
  await writeFile(
    path,
    JSON.stringify([{ ...validJob(), expectedSha256: undefined, sha256: SHA }])
  );
  const jobs = await readInventoryJobs(path);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].expectedSha256, SHA);
  await assert.rejects(() => readInventoryJobs(join(dir, 'missing.json')), /cannot read/);
  await writeFile(path, '{nope');
  await assert.rejects(() => readInventoryJobs(path), /not valid JSON/);
  await writeFile(path, '{}');
  await assert.rejects(() => readInventoryJobs(path), /not an array/);
});

test('validateInventory rejects non-array input and invalid members', () => {
  assert.equal(validateInventory({}).ok, false);
  const result = validateInventory([
    validJob(),
    validJob({ role: 'banner' }),
  ]);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /job 1/);
});

test('validateInventoryUniqueness rejects duplicate slots and assets', async () => {
  const { validateInventoryUniqueness } = await import('./job-schema.mjs');
  const record = (overrides = {}) => ({
    assetId: 'logo-a',
    merchantId: MERCHANT_A,
    slot: 'header-logo',
    ...overrides,
  });
  assert.equal(
    validateInventoryUniqueness([record(), record({ slot: 'product-card', assetId: 'card-a' })]).ok,
    true
  );
  // Same merchant + slot, different asset: route rejects the slot collision.
  const dupSlot = validateInventoryUniqueness([
    record(),
    record({ assetId: 'logo-b' }),
  ]);
  assert.equal(dupSlot.ok, false);
  assert.match(dupSlot.errors.join('\n'), /duplicate slot/);
  // Same merchant + asset, different slot and role: route rejects the asset
  // collision even though the job key (merchant/asset/role) differs.
  const dupAsset = validateInventoryUniqueness([
    record(),
    record({ slot: 'product-card' }),
  ]);
  assert.equal(dupAsset.ok, false);
  assert.match(dupAsset.errors.join('\n'), /duplicate asset/);
  // Different merchants may reuse slots and asset ids.
  assert.equal(
    validateInventoryUniqueness([record(), record({ merchantId: MERCHANT_B })])
      .ok,
    true
  );
  // Slot-less records never collide as "merchant/undefined", but asset
  // uniqueness still applies to every record.
  const noSlots = validateInventoryUniqueness([
    record({ slot: undefined, assetId: 'logo-a' }),
    record({ slot: '', assetId: 'logo-b' }),
  ]);
  assert.equal(noSlots.ok, true);
  const dupAssetNoSlots = validateInventoryUniqueness([
    record({ slot: undefined, assetId: 'logo-a' }),
    record({ slot: '', assetId: 'logo-a' }),
  ]);
  assert.equal(dupAssetNoSlots.ok, false);
  assert.match(dupAssetNoSlots.errors.join('\n'), /duplicate asset/);
});

test('readInventoryJobs refuses route-rejected duplicates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pilot-dup-'));
  const path = join(dir, 'inventory.json');
  const sha = SHA;
  const record = (overrides = {}) => ({
    assetId: 'logo-a',
    merchantId: MERCHANT_A,
    role: 'logo',
    schemaVersion: 1,
    sha256: sha,
    slot: 'header-logo',
    sourcePath: 'snapshots/logo-a.png',
    ...overrides,
  });
  await writeFile(
    path,
    JSON.stringify([record(), record({ assetId: 'logo-b' })])
  );
  await assert.rejects(() => readInventoryJobs(path), /duplicate slot/);
});
