import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runCacheInvalidationCron } from './run-cache-invalidation-cron.mjs';

function harness(initial = '') {
  let content = initial;
  const pendingWrites = new Map();
  return {
    read: () => Promise.resolve(content),
    write: (path, value) => {
      pendingWrites.set(path, value);
    },
    mkdir: () => undefined,
    move: (from) => {
      content = pendingWrites.get(from) ?? '';
      pendingWrites.delete(from);
    },
    get state() {
      return JSON.parse(content);
    },
  };
}

function createSupabaseStub(responder) {
  const queries = [];
  const createSupabaseClient = (url, key, options) => ({
    from: (table) => ({
      select: (columns) => ({
        or: (filter) => ({
          limit: (count) => {
            const call = { url, key, options, table, columns, filter, count };
            queries.push(call);
            return {
              abortSignal: (signal) => responder(call, signal),
            };
          },
        }),
      }),
    }),
  });
  return { createSupabaseClient, queries };
}

function createRunCounter(payload = { claimed: 0, deadLettersPresent: false }) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    run: () => {
      calls += 1;
      return Promise.resolve({ body: JSON.stringify(payload) });
    },
  };
}

const SUPABASE_ENV = {
  CACHE_INVALIDATION_STATE_FILE: '/tmp/state',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};
const SILENT_LOGGER = { log: () => undefined, warn: () => undefined };

describe('cache invalidation idle gate', () => {
  it('runs a cold-start heartbeat without precheck and records lastWebCronAt', async () => {
    const h = harness();
    const { createSupabaseClient, queries } = createSupabaseStub(() =>
      Promise.resolve({ data: [], error: null })
    );
    const counter = createRunCounter();

    const result = await runCacheInvalidationCron({
      env: SUPABASE_ENV,
      now: 10_000,
      run: counter.run,
      createSupabaseClient,
      read: h.read,
      write: h.write,
      makeDirectory: h.mkdir,
      move: h.move,
      logger: SILENT_LOGGER,
    });

    assert.equal(counter.calls, 1);
    assert.equal(queries.length, 0);
    assert.equal(result.skipped, false);
    assert.equal(h.state.lastWebCronAt, 10_000);
  });

  it('skips the web cron call when the outbox has zero actionable or dead-letter rows', async () => {
    const h = harness(
      JSON.stringify({
        nextAllowedAt: 130_000,
        intervalMs: 120_000,
        deadLettersPresent: true,
        lastWebCronAt: 10_000,
      })
    );
    const logs = [];
    const { createSupabaseClient, queries } = createSupabaseStub(
      (_call, signal) => {
        assert.equal(signal instanceof AbortSignal, true);
        return Promise.resolve({ data: [], error: null });
      }
    );
    const counter = createRunCounter();

    const result = await runCacheInvalidationCron({
      env: SUPABASE_ENV,
      now: 130_000,
      run: counter.run,
      createSupabaseClient,
      read: h.read,
      write: h.write,
      makeDirectory: h.mkdir,
      move: h.move,
      logger: { log: (line) => logs.push(line), warn: () => undefined },
    });

    assert.equal(counter.calls, 0);
    assert.equal(queries.length, 1);
    assert.equal(queries[0].table, 'cache_invalidation_outbox');
    assert.equal(queries[0].columns, 'target_id');
    assert.equal(queries[0].count, 1);
    assert.equal(
      queries[0].filter,
      'and(status.in.(pending,failed),next_attempt_at.lte.1970-01-01T00:02:15.000Z),and(status.eq.claimed,claimed_at.lt.1970-01-01T00:00:10.000Z),status.eq.dead_letter'
    );
    assert.deepEqual(result, {
      skipped: true,
      claimed: 0,
      intervalMs: 120_000,
      nextAllowedAt: 250_000,
    });
    assert.deepEqual(h.state, {
      nextAllowedAt: 250_000,
      intervalMs: 120_000,
      deadLettersPresent: false,
      lastWebCronAt: 10_000,
    });
    assert.deepEqual(logs, [
      '[drain-cache-invalidations] idle (0 actionable rows), skipped web cron',
    ]);
  });

  it('invokes the web cron when the precheck finds actionable or dead-letter rows', async () => {
    const h = harness(
      JSON.stringify({
        nextAllowedAt: 130_000,
        intervalMs: 120_000,
        deadLettersPresent: false,
        lastWebCronAt: 10_000,
      })
    );
    const { createSupabaseClient } = createSupabaseStub(() =>
      Promise.resolve({ data: [{ target_id: 'ogabassey' }], error: null })
    );
    const counter = createRunCounter({ claimed: 1, deadLettersPresent: false });

    const result = await runCacheInvalidationCron({
      env: SUPABASE_ENV,
      now: 130_000,
      run: counter.run,
      createSupabaseClient,
      read: h.read,
      write: h.write,
      makeDirectory: h.mkdir,
      move: h.move,
      logger: SILENT_LOGGER,
    });

    assert.equal(counter.calls, 1);
    assert.equal(result.skipped, false);
    assert.equal(result.claimed, 1);
    assert.equal(h.state.lastWebCronAt, 130_000);
  });

  it('runs an hourly heartbeat even when the outbox is idle', async () => {
    const h = harness(
      JSON.stringify({
        nextAllowedAt: 130_000,
        intervalMs: 120_000,
        deadLettersPresent: false,
        lastWebCronAt: 10_000,
      })
    );
    const { createSupabaseClient, queries } = createSupabaseStub(() =>
      Promise.resolve({ data: [], error: null })
    );
    const counter = createRunCounter();

    const result = await runCacheInvalidationCron({
      env: SUPABASE_ENV,
      now: 10_000 + 60 * 60_000,
      run: counter.run,
      createSupabaseClient,
      read: h.read,
      write: h.write,
      makeDirectory: h.mkdir,
      move: h.move,
      logger: SILENT_LOGGER,
    });

    assert.equal(counter.calls, 1);
    assert.equal(queries.length, 0);
    assert.equal(result.skipped, false);
    assert.equal(h.state.lastWebCronAt, 10_000 + 60 * 60_000);
  });

  it('fails open when the precheck query returns an error or times out', async () => {
    const h = harness(
      JSON.stringify({
        nextAllowedAt: 130_000,
        intervalMs: 120_000,
        deadLettersPresent: false,
        lastWebCronAt: 10_000,
      })
    );
    const warnings = [];
    const errorStub = createSupabaseStub(() =>
      Promise.resolve({ data: null, error: { message: 'connection refused' } })
    );
    const timeoutStub = createSupabaseStub(() =>
      Promise.reject(
        new DOMException(
          'The operation was aborted due to timeout',
          'TimeoutError'
        )
      )
    );
    const counter = createRunCounter();

    await runCacheInvalidationCron({
      env: {
        CACHE_INVALIDATION_STATE_FILE: '/tmp/state',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      },
      now: 130_000,
      run: counter.run,
      createSupabaseClient: errorStub.createSupabaseClient,
      read: h.read,
      write: h.write,
      makeDirectory: h.mkdir,
      move: h.move,
      logger: { log: () => undefined, warn: (line) => warnings.push(line) },
    });

    await runCacheInvalidationCron({
      env: SUPABASE_ENV,
      now: 250_000,
      run: counter.run,
      createSupabaseClient: timeoutStub.createSupabaseClient,
      read: h.read,
      write: h.write,
      makeDirectory: h.mkdir,
      move: h.move,
      logger: { log: () => undefined, warn: (line) => warnings.push(line) },
    });

    assert.equal(counter.calls, 2);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /precheck query failed, failing open/);
    assert.match(warnings[1], /precheck threw, failing open/);
  });

  it('does not advance lastWebCronAt when a heartbeat run fails', async () => {
    const h = harness(
      JSON.stringify({
        nextAllowedAt: 130_000,
        intervalMs: 120_000,
        deadLettersPresent: false,
        lastWebCronAt: 10_000,
      })
    );

    await assert.rejects(
      runCacheInvalidationCron({
        env: SUPABASE_ENV,
        now: 10_000 + 60 * 60_000,
        run: () => {
          throw new Error('vercel 502');
        },
        read: h.read,
        write: h.write,
        makeDirectory: h.mkdir,
        move: h.move,
        logger: SILENT_LOGGER,
      }),
      /vercel 502/
    );

    assert.equal(h.state.lastWebCronAt, 10_000);
  });
});
