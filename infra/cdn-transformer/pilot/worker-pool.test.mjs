import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runWorkerOp, takePeakWorkerRssBytes } from './worker-pool.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(here, 'fixtures', name);

test('completed ops accumulate worker RSS until taken', async () => {
  takePeakWorkerRssBytes();
  const result = await runWorkerOp({
    input: fixture('tiny-48x48.png'),
    op: 'metadata',
  });
  assert.equal(result.ok, true);
  const peak = takePeakWorkerRssBytes();
  assert.ok(
    Number.isInteger(peak) && peak > 0,
    `expected a positive worker peak, got ${peak}`
  );
});

test('take resets the accumulator for the next job', async () => {
  takePeakWorkerRssBytes();
  await runWorkerOp({ input: fixture('tiny-48x48.png'), op: 'metadata' });
  assert.ok(takePeakWorkerRssBytes() > 0);
  assert.equal(takePeakWorkerRssBytes(), 0);
});

test('failed ops contribute no peak', async () => {
  takePeakWorkerRssBytes();
  await assert.rejects(
    runWorkerOp({ input: fixture('garbage-not-an-image.bin'), op: 'metadata' })
  );
  assert.equal(takePeakWorkerRssBytes(), 0);
});
