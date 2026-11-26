import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { startBuildWorkerLoop } from './build-worker-loop.ts';

test('worker schedules one tick at a time, cycles cursor, and waits on shutdown', async () => {
  let tick = () => {};
  let release = () => {};
  let cancelled = false;
  const first = randomUUID();
  const seen: Array<string | null> = [];
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stop = startBuildWorkerLoop({
    runOnce: async (cursor) => {
      seen.push(cursor);
      if (seen.length === 1) await gate;
      return { cursor: seen.length === 1 ? first : null };
    },
    schedule: (callback) => {
      tick = callback;
      return () => {
        cancelled = true;
      };
    },
  });
  tick();
  tick();
  assert.deepEqual(seen, [null]);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  tick();
  await new Promise((resolve) => setImmediate(resolve));
  tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, [null, first, null]);
  await stop();
  assert.equal(cancelled, true);
  tick();
  assert.equal(seen.length, 3);
});

test('shutdown waits for a running job and does not admit another', async () => {
  let tick = () => {};
  let release = () => {};
  let finished = false;
  let calls = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stop = startBuildWorkerLoop({
    runOnce: async () => {
      calls++;
      await gate;
      return { cursor: null };
    },
    schedule: (callback) => {
      tick = callback;
      return () => {};
    },
  });
  tick();
  const closing = stop().then(() => {
    finished = true;
  });
  tick();
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(calls, 1);
  release();
  await closing;
  assert.equal(finished, true);
});
