import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertMinFreeBytes,
  createStagingBudget,
  getAvailableBytes,
  removeOwnedStaging,
} from './disk-guards.mjs';

test('reports available bytes and enforces the free-space floor', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pilot-disk-'));
  const available = await getAvailableBytes(dir);
  assert.ok(available > 0);
  await assertMinFreeBytes(dir, 1);
  await assert.rejects(
    () => assertMinFreeBytes(dir, Number.MAX_SAFE_INTEGER),
    /free space/
  );
  await assert.rejects(() => getAvailableBytes(join(dir, 'missing')), /accessible/);
});

test('staging budget charges bytes up to the cap', () => {
  const budget = createStagingBudget(100);
  budget.charge(60);
  assert.equal(budget.used, 60);
  budget.charge(40);
  assert.equal(budget.used, 100);
  assert.throws(() => budget.charge(1), /staging cap/);
  assert.throws(() => budget.charge(-1), /negative/);
});

test('removeOwnedStaging removes only owned staging directories', async () => {
  const base = await mkdtemp(join(tmpdir(), 'pilot-staging-'));
  const owned = join(base, 'staging-abc123');
  await mkdir(owned, { recursive: true });
  await writeFile(join(owned, 'tier-384.avif'), Buffer.alloc(16));
  await removeOwnedStaging(base, owned);
  await assert.rejects(() => removeOwnedStaging(base, owned), /missing/);

  const outside = await mkdtemp(join(tmpdir(), 'pilot-outside-'));
  const foreign = join(outside, 'staging-xyz');
  await mkdir(foreign, { recursive: true });
  await assert.rejects(() => removeOwnedStaging(base, foreign), /escapes/);

  const impostor = join(base, 'not-staging');
  await mkdir(impostor, { recursive: true });
  await assert.rejects(() => removeOwnedStaging(base, impostor), /owned/);

  const nested = join(base, 'staging-nested', 'inner');
  await mkdir(nested, { recursive: true });
  await assert.rejects(() => removeOwnedStaging(base, nested), /owned/);
});
