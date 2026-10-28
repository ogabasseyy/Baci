import assert from 'node:assert/strict';
import test from 'node:test';
import { probeLiveCacheInvalidationWorkerRoute } from './probe-live-cache-invalidation-worker-route.mjs';

test('accepts only the exact authenticated runtime preflight receipt', async () => {
  const calls = [];
  const result = await probeLiveCacheInvalidationWorkerRoute({
    cronSecret: 'cron-secret', attempts: 1,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { status: 200, json: async () => ({ ready: true }) };
    },
  });
  assert.deepEqual(result, { attempts: 1, ready: true });
  assert.equal(calls[0].url, 'https://ogabassey.com/api/cron/drain-cache-invalidations?preflight=1');
  assert.equal(calls[0].options.headers.authorization, 'Bearer cron-secret');
  assert.equal(calls[0].options.redirect, 'error');
});

test('retries transient failure but rejects any nonexact success body', async () => {
  let calls = 0;
  const result = await probeLiveCacheInvalidationWorkerRoute({
    cronSecret: 'secret', attempts: 2, retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? { status: 503 }
        : { status: 200, json: async () => ({ ready: true, extra: 'unexpected' }) };
    },
  }).catch((error) => error);
  assert.equal(calls, 2);
  assert.match(result.message, /did not pass/);
  assert.doesNotMatch(result.message, /secret/);
});

test('rejects missing secret before any network request', async () => {
  let called = false;
  await assert.rejects(probeLiveCacheInvalidationWorkerRoute({
    cronSecret: '', fetchImpl: async () => { called = true; },
  }));
  assert.equal(called, false);
});
