import assert from 'node:assert/strict';
import { statfs } from 'node:fs/promises';
import test from 'node:test';
import { assertHostedSavingsCapacity } from './hosted-savings-bootstrap-capacity';

test('rejects observed 5.3 GiB, invalid and below-threshold capacity', async () => {
  for (const bytes of [
    Math.floor(5.3 * 1024 ** 3),
    20 * 1024 ** 3 - 1,
    Number.NaN,
  ]) {
    const inspect = async () => ({
      ...(await statfs('/tmp')),
      bavail: bytes,
      bsize: 1,
    });
    await assert.rejects(
      assertHostedSavingsCapacity('/tmp', inspect),
      /20 GiB free/
    );
  }
});

test('accepts minimum local headroom without starting services', async () => {
  const bytes = 20 * 1024 ** 3;
  const inspect = async () => ({
    ...(await statfs('/tmp')),
    bavail: bytes,
    bsize: 1,
  });
  assert.equal(await assertHostedSavingsCapacity('/tmp', inspect), bytes);
});
