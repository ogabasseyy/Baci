import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  runWorkerOp,
  takeFailedWorkerOps,
  takePeakWorkerRssBytes,
} from './worker-pool.mjs';

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

test('rejected inputs still contribute their self-reported peak', async () => {
  takePeakWorkerRssBytes();
  takeFailedWorkerOps();
  await assert.rejects(
    runWorkerOp({ input: fixture('garbage-not-an-image.bin'), op: 'metadata' })
  );
  // The error envelope carries the worker's measured peak, so the
  // failure is accounted and the job's combined sum stays complete.
  assert.ok(takePeakWorkerRssBytes() > 0);
  assert.equal(takeFailedWorkerOps(), 0);
});

test('ops without an envelope count failed and contribute no peak', async () => {
  takePeakWorkerRssBytes();
  takeFailedWorkerOps();
  // Protocol misuse exits non-zero with no envelope on stdout.
  await assert.rejects(
    runWorkerOp({ input: fixture('tiny-48x48.png'), op: 'bogus' })
  );
  assert.equal(takePeakWorkerRssBytes(), 0);
  assert.equal(takeFailedWorkerOps(), 1);
});
