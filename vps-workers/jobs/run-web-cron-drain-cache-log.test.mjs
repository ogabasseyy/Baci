import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runWebCron } from './run-web-cron.mjs';

describe('web cron drain-cache-invalidations idle log suppression', () => {
  it('suppresses routine stdout log on idle HTTP 200 JSON responses', async () => {
    const logs = [];
    const result = await runWebCron({
      path: '/api/cron/drain-cache-invalidations',
      env: {
        BACI_WEB_BASE_URL: 'https://ogabassey.com',
        CRON_SECRET: 'secret',
      },
      fetchFn: () =>
        new Response(
          JSON.stringify({
            claimed: 0,
            completed: 0,
            failed: 0,
            deadLettersPresent: false,
          }),
          { status: 200 }
        ),
      logger: { log: (line) => logs.push(line) },
    });

    assert.equal(result.status, 200);
    assert.deepEqual(logs, []);
  });

  it('logs completion when work is claimed or dead letters are present', async () => {
    const logs = [];
    const env = {
      BACI_WEB_BASE_URL: 'https://ogabassey.com',
      CRON_SECRET: 'secret',
    };

    await runWebCron({
      path: '/api/cron/drain-cache-invalidations',
      env,
      fetchFn: () =>
        new Response(
          JSON.stringify({
            claimed: 2,
            completed: 2,
            failed: 0,
            deadLettersPresent: false,
          }),
          { status: 200 }
        ),
      logger: { log: (line) => logs.push(line) },
    });

    await runWebCron({
      path: '/api/cron/drain-cache-invalidations',
      env,
      fetchFn: () =>
        new Response(
          JSON.stringify({
            claimed: 0,
            completed: 0,
            failed: 0,
            deadLettersPresent: true,
          }),
          { status: 200 }
        ),
      logger: { log: (line) => logs.push(line) },
    });

    await runWebCron({
      path: '/api/cron/reconcile-gateway-paid-orders',
      env,
      fetchFn: () =>
        new Response(JSON.stringify({ checked: 0 }), { status: 200 }),
      logger: { log: (line) => logs.push(line) },
    });

    assert.deepEqual(logs, [
      '[run-web-cron] /api/cron/drain-cache-invalidations completed with HTTP 200',
      '[run-web-cron] /api/cron/drain-cache-invalidations completed with HTTP 200',
      '[run-web-cron] /api/cron/reconcile-gateway-paid-orders completed with HTTP 200',
    ]);
  });
});
