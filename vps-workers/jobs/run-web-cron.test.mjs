import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildWebCronUrl,
  CACHE_INVALIDATION_DEAD_LETTER_CODE,
  runWebCron,
} from './run-web-cron.mjs';

const noop = () => undefined;
const noopLogger = {
  debug: noop,
  error: noop,
  info: noop,
  log: noop,
  trace: noop,
  warn: noop,
};

describe('web cron worker', () => {
  it('builds normalized URLs for allowlisted cron paths', () => {
    assert.equal(
      buildWebCronUrl({
        baseUrl: 'https://ogabassey.com',
        path: '/api/inventory/push-alerts',
      }),
      'https://ogabassey.com/api/inventory/push-alerts'
    );
  });

  it('allows the ordered cache invalidation endpoint', async () => {
    const calls = [];
    await runWebCron({
      path: '/api/cron/drain-cache-invalidations',
      env: {
        BACI_WEB_BASE_URL: 'https://ogabassey.com',
        CRON_SECRET: 'secret',
      },
      fetchFn: (url, init) => {
        calls.push({ url, init });
        return new Response('ok', { status: 200 });
      },
      logger: noopLogger,
    });

    assert.equal(
      calls[0].url,
      'https://ogabassey.com/api/cron/drain-cache-invalidations'
    );
    assert.equal(calls[0].init.method, 'GET');
  });

  it('fails the VPS invocation on the cache dead-letter alert response', async () => {
    await assert.rejects(
      () =>
        runWebCron({
          path: '/api/cron/drain-cache-invalidations',
          env: {
            BACI_WEB_BASE_URL: 'https://ogabassey.com',
            CRON_SECRET: 'secret',
          },
          fetchFn: () =>
            new Response(
              JSON.stringify({
                code: 'cache_invalidation_dead_letter',
                error: 'Cache invalidations require intervention',
              }),
              { status: 503 }
            ),
          logger: noopLogger,
        }),
      (error) =>
        error instanceof Error &&
        error.message.includes(`HTTP 503`) &&
        error.message.includes(CACHE_INVALIDATION_DEAD_LETTER_CODE)
    );
  });

  it('returns the known cache dead-letter response only with explicit opt-in', async () => {
    const fetchFn = () =>
      new Response(JSON.stringify({ code: 'cache_invalidation_dead_letter' }), {
        status: 503,
      });
    const result = await runWebCron({
      path: '/api/cron/drain-cache-invalidations',
      env: {
        BACI_WEB_BASE_URL: 'https://ogabassey.com',
        CRON_SECRET: 'secret',
      },
      fetchFn,
      allowCacheDeadLetter: true,
      logger: noopLogger,
    });
    assert.deepEqual(result, {
      cacheDeadLetter: true,
      status: 503,
      body: JSON.stringify({ code: CACHE_INVALIDATION_DEAD_LETTER_CODE }),
    });
    const queryResult = await runWebCron({
      path: '/api/cron/drain-cache-invalidations?source=adaptive',
      env: {
        BACI_WEB_BASE_URL: 'https://ogabassey.com',
        CRON_SECRET: 'secret',
      },
      fetchFn,
      allowCacheDeadLetter: true,
      logger: noopLogger,
    });
    assert.equal(queryResult.cacheDeadLetter, true);
    await assert.rejects(
      () =>
        runWebCron({
          path: '/api/cron/drain-cache-invalidations',
          env: {
            BACI_WEB_BASE_URL: 'https://ogabassey.com',
            CRON_SECRET: 'secret',
          },
          fetchFn: () =>
            new Response(
              JSON.stringify({
                code: `${CACHE_INVALIDATION_DEAD_LETTER_CODE}_near_match`,
              }),
              { status: 503 }
            ),
          allowCacheDeadLetter: true,
          logger: noopLogger,
        }),
      /HTTP 503:/
    );
    await assert.rejects(
      () =>
        runWebCron({
          path: '/api/cron/drain-cache-invalidations',
          env: {
            BACI_WEB_BASE_URL: 'https://ogabassey.com',
            CRON_SECRET: 'secret',
          },
          fetchFn,
          logger: noopLogger,
        }),
      (error) =>
        error instanceof Error &&
        error.message.includes('HTTP 503') &&
        error.message.includes(CACHE_INVALIDATION_DEAD_LETTER_CODE)
    );
  });

  it('allows the gateway paid-order reconcile drain endpoint', async () => {
    const calls = [];
    const result = await runWebCron({
      path: '/api/cron/reconcile-gateway-paid-orders',
      env: {
        BACI_WEB_BASE_URL: 'https://ogabassey.com',
        CRON_SECRET: 'secret',
      },
      fetchFn: (url, init) => {
        calls.push({ url, init });
        return new Response('ok', { status: 200 });
      },
      logger: noopLogger,
    });

    assert.deepEqual(result, { status: 200, body: 'ok' });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://ogabassey.com/api/cron/reconcile-gateway-paid-orders'
    );
    const { signal, ...initWithoutSignal } = calls[0].init;
    assert.deepEqual(initWithoutSignal, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer secret',
        'User-Agent': 'baci-vps-web-cron/1.0',
      },
    });
    assert.equal(signal instanceof AbortSignal, true);
  });

  it('allows the monthly VTU cashback summary cron endpoint', async () => {
    const calls = [];
    const result = await runWebCron({
      path: '/api/cron/vtu-cashback-summaries',
      env: {
        BACI_WEB_BASE_URL: 'https://ogabassey.com',
        CRON_SECRET: 'secret',
      },
      fetchFn: (url, init) => {
        calls.push({ url, init });
        return new Response('ok', { status: 200 });
      },
      logger: noopLogger,
    });

    assert.deepEqual(result, { status: 200, body: 'ok' });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://ogabassey.com/api/cron/vtu-cashback-summaries'
    );
    const { signal, ...initWithoutSignal } = calls[0].init;
    assert.deepEqual(initWithoutSignal, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer secret',
        'User-Agent': 'baci-vps-web-cron/1.0',
      },
    });
    assert.equal(signal instanceof AbortSignal, true);
  });

  it('allows the merchant sales summaries cron endpoint', async () => {
    const calls = [];
    const result = await runWebCron({
      path: '/api/cron/merchant-sales-summaries',
      env: {
        BACI_WEB_BASE_URL: 'https://ogabassey.com',
        CRON_SECRET: 'secret',
      },
      fetchFn: (url, init) => {
        calls.push({ url, init });
        return new Response('ok', { status: 200 });
      },
      logger: noopLogger,
    });

    assert.deepEqual(result, { status: 200, body: 'ok' });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://ogabassey.com/api/cron/merchant-sales-summaries'
    );
    const { signal, ...initWithoutSignal } = calls[0].init;
    assert.deepEqual(initWithoutSignal, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer secret',
        'User-Agent': 'baci-vps-web-cron/1.0',
      },
    });
    assert.equal(signal instanceof AbortSignal, true);
  });

  it('allows the storefront update nudge cron endpoint', async () => {
    const calls = [];
    const result = await runWebCron({
      path: '/api/cron/storefront-update-nudge',
      env: {
        BACI_WEB_BASE_URL: 'https://ogabassey.com',
        CRON_SECRET: 'secret',
      },
      fetchFn: (url, init) => {
        calls.push({ url, init });
        return new Response('ok', { status: 200 });
      },
      logger: noopLogger,
    });

    assert.deepEqual(result, { status: 200, body: 'ok' });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://ogabassey.com/api/cron/storefront-update-nudge'
    );
    const { signal, ...initWithoutSignal } = calls[0].init;
    assert.deepEqual(initWithoutSignal, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer secret',
        'User-Agent': 'baci-vps-web-cron/1.0',
      },
    });
    assert.equal(signal instanceof AbortSignal, true);
  });

  it('allows the Android live-build sync cron endpoint', async () => {
    const calls = [];
    const result = await runWebCron({
      path: '/api/cron/android-live-build-sync',
      env: {
        BACI_WEB_BASE_URL: 'https://ogabassey.com',
        CRON_SECRET: 'secret',
      },
      fetchFn: (url, init) => {
        calls.push({ url, init });
        return new Response('ok', { status: 200 });
      },
      logger: noopLogger,
    });

    assert.deepEqual(result, { status: 200, body: 'ok' });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://ogabassey.com/api/cron/android-live-build-sync'
    );
    assert.equal(calls[0].init.method, 'GET');
  });

  it('allows the processing VTU reconciliation cron endpoint', async () => {
    const calls = [];
    const result = await runWebCron({
      path: '/api/cron/reconcile-vtu-processing',
      env: {
        BACI_WEB_BASE_URL: 'https://ogabassey.com',
        CRON_SECRET: 'secret',
      },
      fetchFn: (url, init) => {
        calls.push({ url, init });
        return new Response('ok', { status: 200 });
      },
      logger: noopLogger,
    });

    assert.deepEqual(result, { status: 200, body: 'ok' });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://ogabassey.com/api/cron/reconcile-vtu-processing'
    );
    const { signal, ...initWithoutSignal } = calls[0].init;
    assert.deepEqual(initWithoutSignal, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer secret',
        'User-Agent': 'baci-vps-web-cron/1.0',
      },
    });
    assert.equal(signal instanceof AbortSignal, true);
  });

  it('allows the Petrock catalog sync cron endpoint', async () => {
    const result = await runWebCron({
      path: '/api/cron/sync-petrock-catalog',
      env: {
        BACI_WEB_BASE_URL: 'https://ogabassey.com',
        CRON_SECRET: 'secret',
      },
      fetchFn: () => new Response('ok', { status: 200 }),
      logger: noopLogger,
    });

    assert.deepEqual(result, { status: 200, body: 'ok' });
  });

  it('retains the Petrock reconciliation endpoint for safe deployment transitions', () => {
    assert.equal(
      buildWebCronUrl({
        baseUrl: 'https://ogabassey.com',
        path: '/api/cron/petrock-reconcile',
      }).toString(),
      'https://ogabassey.com/api/cron/petrock-reconcile'
    );
  });

  it('retains the quiz finalization endpoint for safe deployment transitions', () => {
    assert.equal(
      buildWebCronUrl({
        baseUrl: 'https://ogabassey.com',
        path: '/api/quiz/finalize',
      }).toString(),
      'https://ogabassey.com/api/quiz/finalize'
    );
  });

  it('allows the agentic commerce health cron endpoint', async () => {
    const calls = [];
    const result = await runWebCron({
      path: '/api/cron/agentic-commerce-health',
      env: {
        BACI_WEB_BASE_URL: 'https://ogabassey.com',
        CRON_SECRET: 'secret',
      },
      fetchFn: (url, init) => {
        calls.push({ url, init });
        return new Response('ok', { status: 200 });
      },
      logger: noopLogger,
    });

    assert.deepEqual(result, { status: 200, body: 'ok' });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://ogabassey.com/api/cron/agentic-commerce-health'
    );
    const { signal, ...initWithoutSignal } = calls[0].init;
    assert.deepEqual(initWithoutSignal, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer secret',
        'User-Agent': 'baci-vps-web-cron/1.0',
      },
    });
    assert.equal(signal instanceof AbortSignal, true);
  });

  it('allows the order notification outbox cron endpoint', async () => {
    const calls = [];
    const result = await runWebCron({
      path: '/api/cron/order-notifications?batchSize=5',
      env: {
        BACI_WEB_BASE_URL: 'https://ogabassey.com',
        CRON_SECRET: 'secret',
      },
      fetchFn: (url, init) => {
        calls.push({ url, init });
        return new Response('ok', { status: 200 });
      },
      logger: noopLogger,
    });

    assert.deepEqual(result, { status: 200, body: 'ok' });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://ogabassey.com/api/cron/order-notifications?batchSize=5'
    );
    assert.equal(calls[0].init.method, 'GET');
  });

  it('rejects unsupported paths', () => {
    assert.throws(
      () =>
        buildWebCronUrl({
          baseUrl: 'https://ogabassey.com',
          path: '/api/admin/users',
        }),
      /Unsupported web cron path/
    );
  });

  it('rejects absolute and protocol-relative cron paths before allowlisting', () => {
    for (const path of [
      'https://attacker.example/api/cron/order-notifications',
      '//attacker.example/api/cron/order-notifications',
    ]) {
      assert.throws(
        () =>
          buildWebCronUrl({
            baseUrl: 'https://ogabassey.com',
            path,
          }),
        /must be a root-relative path/
      );
    }
  });

  it('requires a safe base URL', () => {
    assert.throws(
      () =>
        buildWebCronUrl({
          baseUrl: 'ftp://ogabassey.com',
          path: '/api/ai-jobs/worker',
        }),
      /must use https/
    );
    assert.throws(
      () =>
        buildWebCronUrl({
          baseUrl: 'https://user:pass@ogabassey.com',
          path: '/api/ai-jobs/worker',
        }),
      /must not contain credentials/
    );
  });

  it('sends CRON_SECRET authorization to the web endpoint', async () => {
    const calls = [];
    const result = await runWebCron({
      path: '/api/ai-jobs/worker',
      env: {
        BACI_WEB_BASE_URL: 'https://ogabassey.com',
        CRON_SECRET: 'secret',
      },
      fetchFn: (url, init) => {
        calls.push({ url, init });
        return new Response('ok', { status: 200 });
      },
      logger: noopLogger,
    });

    assert.deepEqual(result, { status: 200, body: 'ok' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://ogabassey.com/api/ai-jobs/worker');
    const { signal, ...initWithoutSignal } = calls[0].init;
    assert.deepEqual(initWithoutSignal, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer secret',
        'User-Agent': 'baci-vps-web-cron/1.0',
      },
    });
    assert.equal(signal instanceof AbortSignal, true);
  });

  it('uses per-endpoint timeouts unless an env override is provided', async () => {
    const originalTimeout = AbortSignal.timeout;
    const timeoutCalls = [];
    AbortSignal.timeout = (timeoutMs) => {
      timeoutCalls.push(timeoutMs);
      return originalTimeout(60_000);
    };

    try {
      for (const [path, env] of [
        ['/api/ai-jobs/worker', {}],
        ['/api/inventory/push-alerts', {}],
        ['/api/cron/reconcile-vtu-processing', {}],
        ['/api/cron/agentic-commerce-health', {}],
        ['/api/ai-jobs/worker', { BACI_WEB_CRON_TIMEOUT_MS: '1234' }],
      ]) {
        await runWebCron({
          path,
          env: {
            BACI_WEB_BASE_URL: 'https://ogabassey.com',
            CRON_SECRET: 'secret',
            ...env,
          },
          fetchFn: () => new Response('ok', { status: 200 }),
          logger: noopLogger,
        });
      }
    } finally {
      AbortSignal.timeout = originalTimeout;
    }

    assert.deepEqual(timeoutCalls, [900_000, 600_000, 360_000, 300_000, 1234]);
  });

  it('supports POST cron endpoints with bearer authorization', async () => {
    const calls = [];
    const result = await runWebCron({
      path: '/api/cron/process-settlements',
      env: {
        BACI_WEB_BASE_URL: 'https://ogabassey.com',
        CRON_SECRET: 'secret',
      },
      fetchFn: (url, init) => {
        calls.push({ url, init });
        return new Response('ok', { status: 200 });
      },
      logger: noopLogger,
    });

    assert.deepEqual(result, { status: 200, body: 'ok' });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'https://ogabassey.com/api/cron/process-settlements'
    );
    const { signal, ...initWithoutSignal } = calls[0].init;
    assert.deepEqual(initWithoutSignal, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'User-Agent': 'baci-vps-web-cron/1.0',
      },
    });
    assert.equal(signal instanceof AbortSignal, true);
  });

  it('preserves a trusted cancellation-only query on the settlement endpoint', async () => {
    const calls = [];
    await runWebCron({
      path: '/api/cron/process-settlements?cancellationsOnly=true',
      env: {
        BACI_WEB_BASE_URL: 'https://ogabassey.com',
        CRON_SECRET: 'secret',
      },
      fetchFn: (url, init) => {
        calls.push({ url, init });
        return new Response('ok', { status: 200 });
      },
      logger: noopLogger,
    });

    assert.equal(
      calls[0].url,
      'https://ogabassey.com/api/cron/process-settlements?cancellationsOnly=true'
    );
    assert.equal(calls[0].init.method, 'POST');
  });

  it('surfaces non-2xx responses with a bounded body preview', async () => {
    await assert.rejects(
      () =>
        runWebCron({
          path: '/api/cron/publish-scheduled-posts',
          env: {
            BACI_WEB_BASE_URL: 'https://ogabassey.com',
            CRON_SECRET: 'secret',
          },
          fetchFn: () => new Response('unauthorized', { status: 401 }),
          logger: noopLogger,
        }),
      /HTTP 401: unauthorized/
    );
  });

  it('truncates large non-2xx response previews', async () => {
    await assert.rejects(
      () =>
        runWebCron({
          path: '/api/cron/publish-scheduled-posts',
          env: {
            BACI_WEB_BASE_URL: 'https://ogabassey.com',
            CRON_SECRET: 'secret',
          },
          fetchFn: () => new Response('x'.repeat(10_000), { status: 500 }),
          logger: noopLogger,
        }),
      (error) => {
        assert.equal(error instanceof Error, true);
        assert.match(error.message, /HTTP 500:/);
        assert.match(error.message, /\[truncated\]/);
        assert.equal(error.message.length < 700, true);
        return true;
      }
    );
  });

  it('wraps response body read failures', async () => {
    await assert.rejects(
      () =>
        runWebCron({
          path: '/api/inventory/push-alerts',
          env: {
            BACI_WEB_BASE_URL: 'https://ogabassey.com',
            CRON_SECRET: 'secret',
          },
          fetchFn: () => ({
            ok: true,
            status: 200,
            text() {
              throw new Error('body read failed');
            },
          }),
          logger: noopLogger,
        }),
      /request failed: body read failed/
    );
  });

  it('times out hanging web requests', async () => {
    await assert.rejects(
      () =>
        runWebCron({
          path: '/api/ai-jobs/worker',
          env: {
            BACI_WEB_BASE_URL: 'https://ogabassey.com',
            CRON_SECRET: 'secret',
            BACI_WEB_CRON_TIMEOUT_MS: '1',
          },
          fetchFn: async (_url, init) => {
            await new Promise((_resolve, reject) => {
              if (init.signal.aborted) {
                reject(new DOMException('timeout', 'TimeoutError'));
                return;
              }
              init.signal.addEventListener('abort', () => {
                reject(new DOMException('timeout', 'TimeoutError'));
              });
            });
          },
          logger: noopLogger,
        }),
      /timed out after 1ms/
    );
  });

  it('requires CRON_SECRET', async () => {
    await assert.rejects(
      () =>
        runWebCron({
          path: '/api/inventory/push-alerts',
          env: { BACI_WEB_BASE_URL: 'https://ogabassey.com' },
          fetchFn: () => new Response('ok', { status: 200 }),
          logger: noopLogger,
        }),
      /CRON_SECRET is required/
    );
  });
});
