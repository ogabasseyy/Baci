import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  loadWorkerEnv,
  runCacheInvalidationCron,
} from './run-cache-invalidation-cron.mjs';

function harness(initial = '') {
  let content = initial;
  const pendingWrites = new Map();
  let lastMove;
  return {
    read: async () => content,
    write: (path, value) => {
      pendingWrites.set(path, value);
    },
    mkdir: () => undefined,
    move: (from, to) => {
      content = pendingWrites.get(from) ?? '';
      pendingWrites.delete(from);
      lastMove = { from, to };
    },
    get lastMove() {
      return lastMove;
    },
    get state() {
      return JSON.parse(content);
    },
  };
}

describe('adaptive cache invalidation scheduler', () => {
  it('loads only the worker-local dotenv file for direct execution', () => {
    let options;
    loadWorkerEnv((received) => {
      options = received;
    });

    assert.deepEqual(options, {
      path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env'),
    });
  });

  it('keeps empty-sweep discovery at the two-minute polling bound', async () => {
    const h = harness();
    let calls = 0;
    const run = () => {
      calls += 1;
      return { body: JSON.stringify({ claimed: 0 }) };
    };
    const first = await runCacheInvalidationCron({
      env: { CACHE_INVALIDATION_STATE_FILE: '/tmp/state' },
      now: 1_000,
      run,
      read: h.read,
      write: h.write,
      makeDirectory: h.mkdir,
      move: h.move,
    });
    const second = await runCacheInvalidationCron({
      env: { CACHE_INVALIDATION_STATE_FILE: '/tmp/state' },
      now: first.nextAllowedAt - 1,
      run,
      read: h.read,
      write: h.write,
      makeDirectory: h.mkdir,
      move: h.move,
    });
    assert.equal(calls, 2);
    assert.equal(second.intervalMs, 120_000);
    assert.equal(h.state.intervalMs, 120_000);
    assert.match(h.lastMove.from, /\/tmp\/state\.\d+\.tmp$/);
    assert.equal(h.lastMove.to, '/tmp/state');
  });

  it('resets to the minimum interval when work is claimed', async () => {
    const h = harness(
      JSON.stringify({ nextAllowedAt: 0, intervalMs: 1_800_000 })
    );
    const result = await runCacheInvalidationCron({
      env: { CACHE_INVALIDATION_STATE_FILE: '/tmp/state' },
      now: 2_000_000,
      run: async () => ({ body: JSON.stringify({ claimed: 2 }) }),
      read: h.read,
      write: h.write,
      makeDirectory: h.mkdir,
      move: h.move,
    });
    assert.equal(result.intervalMs, 120_000);
  });

  it('emits one structured terminal signal while retaining two-minute discovery', async () => {
    const h = harness();
    const warnings = [];
    const result = await runCacheInvalidationCron({
      env: { CACHE_INVALIDATION_STATE_FILE: '/tmp/state' },
      now: 5_000,
      run: (options) => {
        assert.equal(options.allowCacheDeadLetter, true);
        return {
          status: 503,
          cacheDeadLetter: true,
          body: JSON.stringify({ code: 'cache_invalidation_dead_letter' }),
        };
      },
      read: h.read,
      write: h.write,
      makeDirectory: h.mkdir,
      move: h.move,
      logger: { warn: (line) => warnings.push(line) },
    });
    assert.equal(result.deadLetter, true);
    assert.equal(result.intervalMs, 120_000);
    assert.deepEqual(h.state, {
      nextAllowedAt: 125_000,
      intervalMs: 120_000,
      deadLettersPresent: true,
    });
    assert.deepEqual(JSON.parse(warnings[0]), {
      event: 'cache_invalidation_dead_letter',
      intervalMs: 120_000,
      nextAllowedAt: 125_000,
    });
    assert.equal(warnings.length, 1);
  });

  it('keeps the fast cadence and claimed count when work and a new dead letter coexist', async () => {
    const h = harness();
    const warnings = [];
    const result = await runCacheInvalidationCron({
      env: { CACHE_INVALIDATION_STATE_FILE: '/tmp/state' },
      now: 5_000,
      run: async () => ({
        body: JSON.stringify({ claimed: 3, deadLettersPresent: true }),
      }),
      read: h.read,
      write: h.write,
      makeDirectory: h.mkdir,
      move: h.move,
      logger: { warn: (line) => warnings.push(line) },
    });
    assert.equal(result.claimed, 3);
    assert.equal(result.intervalMs, 120_000);
    assert.equal(result.deadLetter, true);
    assert.equal(JSON.parse(warnings[0]).intervalMs, 120_000);
    assert.equal(h.state.deadLettersPresent, true);
  });

  it('does not re-alert a known dead letter after a transient drain failure', async () => {
    const h = harness();
    const warnings = [];
    const options = {
      env: { CACHE_INVALIDATION_STATE_FILE: '/tmp/state' },
      read: h.read,
      write: h.write,
      makeDirectory: h.mkdir,
      move: h.move,
      logger: { warn: (line) => warnings.push(line) },
    };
    const deadLetterResult = {
      body: JSON.stringify({ claimed: 0, deadLettersPresent: true }),
    };

    await runCacheInvalidationCron({
      ...options,
      now: 5_000,
      run: async () => deadLetterResult,
    });
    await assert.rejects(
      runCacheInvalidationCron({
        ...options,
        now: 125_000,
        run: () => {
          throw new Error('temporary Vercel failure');
        },
      }),
      /temporary Vercel failure/
    );
    const recovered = await runCacheInvalidationCron({
      ...options,
      now: 245_000,
      run: async () => deadLetterResult,
    });

    assert.equal(h.state.deadLettersPresent, true);
    assert.equal(recovered.deadLetter, undefined);
    assert.equal(warnings.length, 1);
  });
});
